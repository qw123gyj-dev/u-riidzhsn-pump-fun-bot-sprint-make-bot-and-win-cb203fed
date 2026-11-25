// First-Light Runner: a launch sniper with a rug filter and a runner's exit,
// for agent-fun/replay/v2 (pump.fun bonding curves).
//
// Idea
// ----
// A pump.fun coin's fate is mostly decided in its first three slots. The
// launches that pay are the quiet ones: the creator bought in (but not a
// fortune), exactly two independent wallets have bought alongside, nobody has
// sold yet, and the price has not already run away. A launch crowded by three
// or more buyers in its first slots is a pile-on that dumps on the late money;
// a launch with zero or one buyer is dead on arrival. So this bot buys only
// the two-buyer launches, once each, in a single order, and gets out fast:
// half the position banks +15%, the rest rides to +60% (or a trailing stop
// once +50% up) and stops out at cost after the first take-profit, with a
// hard -8% stop and a 30-slot time limit underneath everything. A coin that
// fails any filter, or that the bot already exited, is never touched again.
//
// Why this shape: on the dev window the two-buyer cohort is the only entry
// filter that survives the 2-slot fill latency. Buying after a move (a
// reserve breakout, a run-up) looks great at zero latency and loses money
// once the fill lands two slots later, because the spike that triggered the
// entry is already gone. Buying at launch, before the move, pays the latency
// only on the way in, when the price has barely moved yet. The exits are
// fast because a coin that does not pump in its first seconds almost never
// pumps later, and every extra slot held is a slot bleeding to sellers.
//
// Fees, priced in: the curve takes 95 bps protocol + 30 bps creator on every
// fill, and every order pays 105,000 lamports of tx fees whether it fills or
// not. Orders are never split into pieces (each piece is another 105,000
// lamports for the same trade), never added to (a second buy is a second tx
// fee at a worse price), and the smallest buy is 0.005 SOL, so a round trip's
// fixed fees stay a small share of the stake. The 1%-of-real-reserve cap
// means a young curve only lets us buy a little; the stake is a target, and
// a coin whose cap never reaches the minimum is simply skipped.
//
// Everything here is a pure function of the batches the harness sends: no
// clock, no environment, no randomness, iteration only over insertion-ordered
// maps fed by the batch stream, so the two graded executions produce
// byte-identical action logs.

import type { Batch, BotState, OrderInput, Pubkey } from './vendor/makefun-bot.ts';

export interface Params {
  /** Youngest age (slots since create) at which a coin may be bought. */
  minAge: number;
  /** Oldest age at which a first buy may still be decided. */
  maxAge: number;
  /** Lamports to aim for per coin in total (each reply is still capped at 1% of real SOL). */
  stakeLamports: number;
  /** Smallest single buy worth paying the tx fee for. */
  minBuyLamports: number;
  /** Real SOL reserve window at decision time (lamports). 1 SOL minimum is deliberate: the harness caps
   * each buy at 1% of the real reserve, so a 1 SOL reserve guarantees every buy is at least 0.01 SOL —
   * exactly the size a round trip must reach to count toward the 20-coin guardrail. */
  minRealSol: number;
  maxRealSol: number;
  /** Creator's own buys in the create slot: lamports window. */
  minDevBuy: number;
  maxDevBuy: number;
  /** Trades seen and distinct (non-creator) buyers seen before entry. */
  minTrades: number;
  minBuyers: number;
  /** Distinct non-creator buyers before entry, at most: a launch bundled by many wallets is a dump in waiting. */
  maxBuyers: number;
  /** Lamports sold by others / lamports bought, as bps, at most. */
  maxSellRatioBps: number;
  /** Largest single non-creator sell seen, as bps of the real SOL reserve before it, at most. */
  maxBigSellBps: number;
  /** Price now over the create price, as bps: window. */
  minRunupBps: number;
  maxRunupBps: number;
  /** Creator sold before entry: skip the coin. */
  skipDevSold: boolean;
  /** Slippage allowed on buys (bps): a buy whose price jumps more than this in the latency is refused.
   * Wide open here on purpose: the coins whose price jumps in the 2-slot latency are the ones still
   * pumping, and refusing them throws away the winners. */
  buySlippageBps: number;
  /** First take-profit: sell tp1PartBps of the position once it is worth tp1Bps over its cost. */
  tp1Bps: number;
  tp1PartBps: number;
  /** After the first take-profit, the rest stops out at this much under its cost (bps; negative = above). */
  slAfterTp1Bps: number;
  /** Exit when the position is worth this much over its cost (bps). */
  tpBps: number;
  /** Exit when it is worth this much under its cost (bps). */
  slBps: number;
  /** Trailing stop: once up at least trailArmBps, exit on a fall of trailBps from the best value. */
  trailArmBps: number;
  trailBps: number;
  /** Exit after holding this many slots. */
  maxHold: number;
  /** Exit when the creator sells while held. */
  exitOnDevSell: boolean;
}

export const DEFAULT_PARAMS: Params = {
  minAge: 0,
  maxAge: 3,
  stakeLamports: 200_000_000,
  minBuyLamports: 5_000_000,
  minRealSol: 1_000_000_000,
  maxRealSol: 30_000_000_000,
  minDevBuy: 0,
  maxDevBuy: 1_000_000_000,
  minTrades: 0,
  minBuyers: 2,
  maxBuyers: 2,
  maxSellRatioBps: 10_000,
  maxBigSellBps: 10_000,
  minRunupBps: 0,
  maxRunupBps: 1_000_000,
  skipDevSold: true,
  buySlippageBps: 10_000,
  tp1Bps: 2500,
  tp1PartBps: 5000,
  slAfterTp1Bps: 0,
  tpBps: 6000,
  slBps: 800,
  trailArmBps: 5000,
  trailBps: 2000,
  maxHold: 30,
  exitOnDevSell: true,
};

const BPS = 10_000n;
/** Curve fee on every fill: 95 bps protocol + 30 bps creator. */
const FEE_BPS = 125n;

/** What selling `tokens` against (vq, vt) would pay after curve fees (lamports). */
function sellValue(tokens: bigint, vq: bigint, vt: bigint): bigint {
  if (tokens <= 0n || vt <= 0n || vq <= 0n) return 0n;
  const q = (tokens * vq) / (vt + tokens);
  return q - (q * FEE_BPS + BPS - 1n) / BPS;
}

interface Tick {
  slot: number;
  isBuy: boolean;
  sol: bigint;
  user: Pubkey;
}

interface Coin {
  mint: Pubkey;
  createSlot: number;
  creator: Pubkey;
  /** Create-time reserves: the price run-up is measured against them. */
  vq0: bigint;
  vt0: bigint;
  devBuy: bigint;
  trades: number;
  buyers: Set<Pubkey>;
  bought: bigint;
  soldByOthers: bigint;
  bigSellBps: bigint;
  devSold: boolean;
  lastTradeSlot: number;
  /** Trades of the last few slots, for the flow check (older ones dropped). */
  recent: Tick[];
  buysSent: number;
  /** Lamports sent in buys (filled or still in flight) for this entry. */
  spentSent: bigint;
  /** Decision price (vq/vt pair) of the last buy sent. */
  lastBuyVq: bigint;
  lastBuyVt: bigint;
  lastBuySlot: number;
  /** Never buy it again (exited, filtered out for good, or completed). */
  done: boolean;
  complete: boolean;
}

interface Held {
  openedSlot: number;
  /** Tx fees paid on this position's fills (lamports). */
  txPaid: bigint;
  /** Best liquidation value seen (lamports). */
  best: bigint;
  devSoldAtOpen: boolean;
  tookTp1: boolean;
  /** A sell is in flight: do not send another. */
  exiting: boolean;
}

export interface StrategyStats {
  buys: number;
  sells: number;
  tp1s: number;
  sellRejected: number;
  sellFailed: number;
  buyRejected: number;
  buyFailed: number;
}

export function createStrategy(p: Params = DEFAULT_PARAMS): {
  onBatch(state: BotState, batch: Batch): OrderInput[];
  stats: StrategyStats;
} {
  const P = p;
  const coins = new Map<Pubkey, Coin>();
  const held = new Map<Pubkey, Held>();
  const stats: StrategyStats = { buys: 0, sells: 0, tp1s: 0, sellRejected: 0, sellFailed: 0, buyRejected: 0, buyFailed: 0 };
  /** Buys sent and not yet resolved, by the client_id we assigned: { mint, amount }. */
  const buyLedger = new Map<string, { mint: Pubkey; amount: bigint }>();

  const coinOf = (mint: Pubkey): Coin => {
    let c = coins.get(mint);
    if (c === undefined) {
      c = {
        mint,
        createSlot: -1,
        creator: '',
        vq0: 0n,
        vt0: 1n,
        devBuy: 0n,
        trades: 0,
        buyers: new Set(),
        bought: 0n,
        soldByOthers: 0n,
        bigSellBps: 0n,
        devSold: false,
        lastTradeSlot: -1,
        recent: [],
        buysSent: 0,
        spentSent: 0n,
        lastBuyVq: 0n,
        lastBuyVt: 1n,
        lastBuySlot: 0,
        done: false,
        complete: false,
      };
      coins.set(mint, c);
    }
    return c;
  };

  /** Read the batch's events into the per-coin books. */
  const readEvents = (batch: Batch): void => {
    for (const e of batch.events) {
      if (e.event === 'CreateEvent') {
        const c = coinOf(e.mint);
        c.createSlot = e.slot;
        c.creator = e.creator;
        c.vq0 = BigInt(e.virtual_quote_reserves);
        c.vt0 = BigInt(e.virtual_token_reserves);
        c.lastTradeSlot = e.slot;
      } else if (e.event === 'TradeEvent') {
        const c = coinOf(e.mint);
        const sol = BigInt(e.sol_amount);
        c.trades += 1;
        c.lastTradeSlot = e.slot;
        c.recent.push({ slot: e.slot, isBuy: e.is_buy, sol, user: e.user });
        const isDev = e.user === c.creator;
        if (e.is_buy) {
          c.bought += sol;
          if (isDev && e.slot === c.createSlot) c.devBuy += sol;
          else if (!isDev) c.buyers.add(e.user);
        } else if (isDev) {
          c.devSold = true;
        } else {
          c.soldByOthers += sol;
          const rqBefore = BigInt(e.real_quote_reserves) + sol;
          if (rqBefore > 0n) {
            const bps = (sol * BPS) / rqBefore;
            if (bps > c.bigSellBps) c.bigSellBps = bps;
          }
        }
      } else {
        const c = coinOf(e.mint);
        c.complete = true;
        c.done = true;
      }
    }
  };

  return {
    stats,
    onBatch(state: BotState, batch: Batch): OrderInput[] {
      readEvents(batch);
      const now = batch.slot;
      const cap = state.hello.caps.max_orders_per_batch;
      const tx = state.txFeeLamports();
      const orders: OrderInput[] = [];
      const marks = new Map<Pubkey, { vq: bigint; vt: bigint }>();
      for (const m of batch.marks) {
        marks.set(m.mint, { vq: BigInt(m.virtual_quote_reserves), vt: BigInt(m.virtual_token_reserves) });
      }
      const pendingByMint = new Map<Pubkey, { buy: boolean; sell: boolean }>();
      for (const po of state.pending.values()) {
        const e = pendingByMint.get(po.order.mint) ?? { buy: false, sell: false };
        if (po.order.side === 'buy') e.buy = true;
        else e.sell = true;
        pendingByMint.set(po.order.mint, e);
      }

      // Fills: reconcile the buy ledger, track tx fees per position, and drop
      // held records the harness closed. A sell that was rejected or failed
      // must clear `exiting`, or the position could never be sold again and
      // would hold its slot for the rest of the run.
      for (const f of batch.fills) {
        if (f.client_id.startsWith('_')) {
          held.delete(f.mint);
          continue;
        }
        const h = held.get(f.mint);
        if (h !== undefined && f.status !== 'rejected') h.txPaid += BigInt(f.tx_fee_lamports);
        if (f.side === 'buy') {
          const sent = buyLedger.get(f.client_id);
          if (sent !== undefined) {
            buyLedger.delete(f.client_id);
            if (f.status === 'filled') {
              if (h === undefined) {
                const c = coins.get(f.mint);
                held.set(f.mint, {
                  openedSlot: f.slot,
                  txPaid: BigInt(f.tx_fee_lamports),
                  best: 0n,
                  devSoldAtOpen: c?.devSold ?? false,
                  tookTp1: false,
                  exiting: false,
                });
              }
            } else {
              // Rejected or failed: the lamports were never spent, so they
              // stop counting toward this coin's stake.
              const c = coins.get(f.mint);
              if (c !== undefined) c.spentSent -= sent.amount;
              if (f.status === 'rejected') stats.buyRejected++;
              else stats.buyFailed++;
            }
          }
        } else if (f.side === 'sell' && h !== undefined) {
          if (f.status === 'rejected') {
            h.exiting = false;
            stats.sellRejected++;
          } else if (f.status === 'failed') {
            h.exiting = false;
            stats.sellFailed++;
          }
        }
      }
      for (const mint of [...held.keys()]) {
        if (!state.positions.has(mint) && !(pendingByMint.get(mint)?.buy ?? false)) held.delete(mint);
      }

      // ---- Exits first: every open position is re-priced every batch. ----
      for (const [mint, pos] of state.positions) {
        if (orders.length >= cap) break;
        const h = held.get(mint);
        if (h === undefined) {
          held.set(mint, { openedSlot: now, txPaid: tx, best: 0n, devSoldAtOpen: coins.get(mint)?.devSold ?? false, tookTp1: false, exiting: false });
          continue;
        }
        if (h.exiting || pendingByMint.get(mint)?.sell) continue;
        const curve = state.curves.get(mint);
        if (curve === undefined || curve.complete) continue;
        const mk = marks.get(mint);
        const vq = mk ? mk.vq : curve.virtual_quote_reserves;
        const vt = mk ? mk.vt : curve.virtual_token_reserves;
        const value = sellValue(pos.token_amount, vq, vt) - tx;
        const basis = pos.cost_lamports + h.txPaid;
        if (basis <= 0n) continue;
        if (value > h.best) h.best = value;
        const c = coins.get(mint);
        // First take-profit: bank half at +tp1Bps, let the rest run.
        if (!h.tookTp1 && value * BPS >= basis * (BPS + BigInt(P.tp1Bps))) {
          const part = (pos.token_amount * BigInt(P.tp1PartBps)) / BPS;
          if (part > 0n && part < pos.token_amount) {
            const id = state.clientId();
            orders.push({ side: 'sell', client_id: id, mint, token_amount: part, max_slippage_bps: 10_000 });
            h.tookTp1 = true;
            h.best = 0n;
            // No `exiting` here: only half the position is leaving, and the
            // rest must stay sellable. The pending-sell check above stops a
            // second sell while this one is in flight.
            stats.tp1s++;
            stats.sells++;
            continue;
          }
        }
        let exit = false;
        if (value * BPS >= basis * (BPS + BigInt(P.tpBps))) exit = true;
        const sl = h.tookTp1 ? BigInt(P.slAfterTp1Bps) : BigInt(P.slBps);
        if (value * BPS <= basis * (BPS - sl)) exit = true;
        if (h.best * BPS >= basis * (BPS + BigInt(P.trailArmBps)) && value * BPS <= h.best * (BPS - BigInt(P.trailBps))) exit = true;
        if (now - h.openedSlot >= P.maxHold) exit = true;
        if (c !== undefined && P.exitOnDevSell && c.devSold && !h.devSoldAtOpen) exit = true;
        if (!exit) continue;
        h.exiting = true;
        const id = state.clientId();
        orders.push({ side: 'sell', client_id: id, mint, token_amount: pos.token_amount, max_slippage_bps: 10_000 });
        stats.sells++;
        if (c !== undefined) c.done = true;
      }

      // ---- Entries: one single buy per launch that passes the filter. ----
      let free = state.freeCashLamports();
      let open = state.committedPositionCount();
      for (const c of coins.values()) {
        if (orders.length >= cap) break;
        if (c.done || c.complete) continue;
        if (c.buysSent > 0) continue;
        const age = now - c.createSlot;
        if (c.createSlot < 0 || age < P.minAge || age > P.maxAge) {
          if (c.createSlot >= 0 && age > P.maxAge) c.done = true;
          continue;
        }
        if (open >= state.hello.caps.max_open_positions) continue;
        const curve = state.curves.get(c.mint);
        if (curve === undefined || curve.complete) continue;
        if (c.devSold && P.skipDevSold) {
          c.done = true;
          continue;
        }
        // The rug filter: the creator's launch buy, the buyer count, the
        // sell pressure so far, and the run-up against the create price.
        const rq = curve.real_quote_reserves;
        if (rq < BigInt(P.minRealSol) || rq > BigInt(P.maxRealSol)) continue;
        if (c.devBuy < BigInt(P.minDevBuy) || c.devBuy > BigInt(P.maxDevBuy)) continue;
        if (c.trades < P.minTrades || c.buyers.size < P.minBuyers || c.buyers.size > P.maxBuyers) continue;
        if (c.bought > 0n && c.soldByOthers * BPS > c.bought * BigInt(P.maxSellRatioBps)) continue;
        if (c.bigSellBps > BigInt(P.maxBigSellBps)) continue;
        if (c.vq0 === 0n) continue;
        const runup = (curve.virtual_quote_reserves * c.vt0 * BPS) / (curve.virtual_token_reserves * c.vq0);
        if (runup < BigInt(P.minRunupBps) || runup > BigInt(P.maxRunupBps)) continue;
        const room = BigInt(P.stakeLamports) - c.spentSent;
        if (room < BigInt(P.minBuyLamports)) {
          c.done = true;
          continue;
        }
        const maxBuy = state.maxBuyLamports(c.mint);
        const amount = room < maxBuy ? room : maxBuy;
        if (amount < BigInt(P.minBuyLamports)) continue;
        if (free < amount + tx) continue;
        const id = state.clientId();
        orders.push({ side: 'buy', client_id: id, mint: c.mint, quote_lamports: amount, max_slippage_bps: P.buySlippageBps });
        buyLedger.set(id, { mint: c.mint, amount });
        stats.buys++;
        free -= amount + tx;
        c.buysSent++;
        c.spentSent += amount;
        c.lastBuyVq = curve.virtual_quote_reserves;
        c.lastBuyVt = curve.virtual_token_reserves;
        c.lastBuySlot = now;
        open++;
        if (c.spentSent >= BigInt(P.stakeLamports)) c.done = true;
      }
      return orders;
    },
  };
}
