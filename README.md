[![make.fun](https://make.fun/badge/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed.svg)](https://make.fun/bounty/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed)
[![rank](https://make.fun/badge/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed/qw123gyj-dev/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed/rank.svg)](https://make.fun/bounty/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed)
[![reward](https://make.fun/badge/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed/qw123gyj-dev/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed/reward.svg)](https://make.fun/bounty/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed)

# First-Light Runner — Pump.fun Bot Sprint

A pump.fun bonding-curve bot for the `agent-fun/replay/v2` harness.
Strategy: **First-Light Runner** — a launch sniper with a rug filter and a
runner's exit. It buys a launch in its first three slots only when the
creator bought in (but not a fortune), exactly two independent wallets bought
alongside, and nobody has sold yet; it banks half at +25%, lets the rest run
to +60% (or a trailing stop), with a hard −8% stop and a 30-slot time limit.

## How to run

```sh
node main.ts
```

Node 22.18+ (the entry is TypeScript run as-is, stdlib only, no network).
The bot speaks the `agent-fun/replay/v2` protocol over stdin/stdout:
`hello` → one reply per `batch` (echoing `seq`) → `done`.

## Files

- `main.ts` — entry point: creates one `First-Light Runner` strategy and
  hands it to the SDK's `runBot`.
- `strategy.ts` — the whole strategy (entry filter, position ledger, exits).
- `vendor/makefun-bot.ts` — the kit SDK, vendored byte-identical.
- `STRATEGY.md` — the rules with hard numbers and the dev-window results.

## Dev-window results (grade-local, 24h dev window)

- **Net PnL +0.0567 SOL** (return +0.57%), 157 fills over 75 coins,
  75 round trips, 16.0% win rate, max drawdown 0.94%.
- **Guardrails met**: 75 coins hold a round trip of at least 0.01 SOL
  (20 required), drawdown 0.94% (50% limit).
- Kit baselines on the same window: sniper −0.468 SOL, reversion −3.887 SOL,
  momentum −9.460 SOL (drawdown guardrail failed), equal-weight −0.019 SOL
  (guardrail failed), hold-cash 0.000 SOL (guardrail failed).
- Deterministic: an L1 regrade reproduced the action log byte for byte.

See `STRATEGY.md` for the full numbers, the stress spread, and the honest
caveats (profit is concentrated in a few mooner coins; the 6-hour final
window's coin count is the main risk).
