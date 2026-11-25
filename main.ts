// First-Light Runner: a launch sniper with a rug filter and a runner's exit,
// for agent-fun/replay/v2 (pump.fun bonding curves).
//
// Buys a launch in its first three slots only when the creator bought in
// (but not a fortune), exactly two independent wallets bought alongside, and
// nobody has sold yet; banks half at +15%, lets the rest run to +60% (or a
// trailing stop), with a hard -8% stop and a 30-slot time limit. See
// STRATEGY.md for the full rules and the dev-window numbers.
//
// Run by the grader as `node main.ts` (Node 22.18+ runs TypeScript as-is;
// stdlib only, no network, no secrets, no clock, no randomness).

import { runBot } from './vendor/makefun-bot.ts';
import { createStrategy, DEFAULT_PARAMS } from './strategy.ts';

// One strategy instance for the whole run: its per-coin books live in the
// closure and must survive across batches (creating it per batch would
// forget every coin and every position).
const strategy = createStrategy(DEFAULT_PARAMS);

await runBot({
  onBatch(state, batch) {
    return strategy.onBatch(state, batch);
  },
});
