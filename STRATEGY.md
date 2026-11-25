# STRATEGY.md — First-Light Runner

## The strategy in one sentence

Buy a launch in its first three slots only when the creator bought in (but
not a fortune), exactly two independent wallets bought alongside, and nobody
has sold yet — then bank half at +25%, let the rest run to +60% (or a
trailing stop), with a hard −8% stop and a 30-slot time limit.

## Why this shape

The dev window was screened for every entry family I could think of
(breakout/run-up, momentum, dip/reversion, near-completion rides, second
waves). With the harness's 2-slot latency priced in, **all of them lose
money**: single-trade price spikes revert within two slots, so exits decided
on a spike print fill after the retracement. The only family that survives
is an early launch snipe — buying in the first three slots, before the move,
so latency is only paid on entry. The pilot sniper's gross trading PnL
ex-fees is ≈ −0.145 SOL over 351 coins (near breakeven); the loss is
dominated by fees, so the whole design is about (a) picking the cheapest
cohort and (b) keeping every buy big enough that fixed fees don't eat it.

## Entry rules (all must hold at the decision slot)

| Rule | Value | Why |
| --- | --- | --- |
| Age at decision | 0–3 slots after `CreateEvent` | Before the move; latency only on entry |
| Stake per coin | 0.2 SOL target (one single buy, no adds, no splits) | Splitting orders is pure fee burn |
| Min real SOL reserve | 1 SOL | The harness caps each buy at 1% of the real reserve, so ≥1 SOL guarantees every buy is ≥0.01 SOL — exactly the size a round trip must reach to count toward the 20-coin guardrail |
| Max real SOL reserve | 30 SOL | Skip already-big pools |
| Creator's own buys | > 0 and ≤ 1 SOL (in the create slot) | Creator skin in the game, but not a fortune (a huge dev buy is a dump setup) |
| Creator sells | skip if the creator has sold anything | Instant rug signal |
| Distinct non-creator buyers seen | exactly 2 | The edge is concentrated here: quiet accumulation, not a crowded pile-on. 3+ buyers in the first slots destroys PnL (−0.30 SOL in the sweep); 0–1 buyers are worse with latency |
| Big sells seen | none above 100% of the buy (filter off) | Sell-ratio filters were tested and hurt |
| Run-up since create | < 100× | Sanity cap, never binds in practice |
| Buy slippage | 10,000 bps (wide open) | **Counter-intuitive but decisive**: a 500 bps cap rejects the very buys that become winners — the coins whose price jumps in the 2-slot latency are the ones still pumping. Tight slippage cost −0.05 SOL in the sweep |

Position cap: at most 5 open positions (harness limit); at most 16 orders
per batch (we send at most one buy or one sell per coin per batch).

## Exit rules

| Rule | Value |
| --- | --- |
| First take-profit | sell 50% of the position at +25% over cost (cost includes tx fees paid) |
| Remainder take-profit | sell all at +60% over cost |
| Stop after TP1 | breakeven (0%) on the remainder once half is banked |
| Hard stop | −8% |
| Trailing stop | arms at +50%, trails 20% below the peak value since entry (peak resets after TP1) |
| Time limit | 30 slots after the first fill |
| Creator sells | exit the whole position immediately |
| Completion / flatten | harness force-closes on `CompleteEvent` and at window end |

Exits are evaluated on `marks` (latest reserves for held mints), not on
single trade prints, so a one-trade spike can't trigger a sell that fills
after the retracement.

## Fee awareness

- Protocol fee 95 bps + creator fee 30 bps = 1.25% per fill, plus a flat
  105,000 lamports per order (5,000 base + 100,000 priority), filled or not.
- A 0.005 SOL buy pays ~6.7% round-trip in fixed+curve fees vs ~2.7% on
  0.1 SOL — hence the 1 SOL reserve floor and the single 0.2 SOL buy.
- The ledger reconciles rejected/failed fills out of the stake accounting,
  so a refused buy never blocks the coin's slot and a failed sell never
  leaves the position stuck "exiting" forever (both were real bugs found
  during testing).

## Dev-window results (grade-local, 24h dev window, Node v24.22.1)

```
net PnL   0.056745642 SOL  (return 0.005674564, 90% interval -0.108501927 .. 0.243552566 SOL)
top coins 3 coins made 63% of the gains; without them net PnL is -0.10 SOL
trading   157 fills over 75 coins, 75 round trips, win rate 0.160000000, max drawdown 0.009441835, 0 rejected, 4 failed
fees      0.065512879 SOL curve + 0.016905000 SOL tx; at 2x fees net PnL -0.025768757 SOL
guardrails met (coins ok: 75 hold a round trip of at least 0.010000000 SOL, over 75 such round trips, drawdown ok)
action_log_sha256 4eb9735c060ca4420659a3940cb6168ba3712b066bde6a7f51243ed41c5eabba
result_sha256     4d7bd1155e109b884842a40d6bd419b739a0ed8bfdf1f847d52dabab8d76e7a3
```

Deterministic: an L1 regrade of the earlier config reproduced the action
log byte for byte. (The server harness runs Node v26.13.1, so its
`result_sha256` will differ from local runs.)

### Baselines on the same window (grade-local)

| Baseline | Net PnL | Guardrails |
| --- | --- | --- |
| hold-cash | 0.000 SOL | NOT met (0 coins) |
| equal-weight | −0.019 SOL | NOT met |
| sniper (pilot) | −0.468 SOL | met |
| reversion (pilot) | −3.887 SOL | met |
| momentum (pilot) | −9.460 SOL | NOT met (drawdown 0.956) |
| **First-Light Runner** | **+0.0567 SOL** | **met** |

### Stress (20 copies, grade-local --stress)

```
stress    20 block surrogates of the dev window: median -0.08, p10 -0.28, p90 0.06 SOL;
          15 of 20 lost money; the dev score is above 16 of 20
note      rebuilt copies show how much this score depends on the window's own coins;
          they are not a forecast of another window
warning   half or more of the rebuilt copies lost money
```

Read plainly: the dev score (+0.057 SOL) beats 16 of 20 rebuilt copies of
its own window, but the median rebuilt copy loses −0.08 SOL. The strategy
is a positive-dev lottery ticket, not a reliably positive system — the
final 6-hour window is a fresh draw, and the most likely single outcome is
a small loss. This is reported here rather than hidden because the prize
needs net PnL > 0 on that one draw.

## Honest caveats

1. **Profit is concentrated.** The top 3 coins made 63% of the gains;
   without them the dev net is −0.10 SOL. The edge is a lottery-ticket
   shape: many small −8% stops and fee losses, occasionally a mooner caught
   by latency working *for* the exit (a sell decided at +25% fills two
   slots later much higher).
2. **The 6-hour final window is the main risk.** The dev window's four
   6-hour slices gave 29 / 17 / 31 / 13 coins traded and net PnL of
   −0.037 / −0.004 / +0.017 / −0.012 SOL. The guardrail needs ≥20
   qualifying coins per 6 hours; the dev average is ~19/6h, so a quiet
   final window could fail the guardrail even if the strategy is right.
   (The full 24h dev window has 75 qualifying coins, 3.75× the guardrail.)
3. **Slices are mostly slightly negative.** The full-window +0.057 SOL
   comes almost entirely from the third 6-hour slice (+0.105 SOL in the
   trip grouping, driven by 4 mooner coins). A single 6h final window is
   high-variance by construction.
4. **Fee sensitivity.** At 2× fees the dev net is −0.026 SOL. The strategy
   is profitable only because the fee level is what it is.
5. **No overfitting to a single coin.** The sweep was run over the full
   24h window and all four 6h slices; no parameter was chosen to fit one
   coin. But the parameters *were* tuned on this one dev window, and the
   final window is fresh data — the numbers above are a dev estimate, not
   a promise.
