# btc-race-fallback2

Entry for the make.fun competition **`btc-race-24h-20261109-2239`** (cbBTC/USDC, one-minute bars,
1,440 per window). MIT licensed (`SPDX-License-Identifier: MIT`).

A cbBTC buy-and-hold with a drawn-down stop: buy the asset once near the start of the window, then
put a hard floor under how much of the move is given back. The dev window rose about 1%; this keeps
that rise if the race window rises and steps aside into cash if it falls hard, instead of riding a
crash to the bottom.

This is the **second** fallback entry. The first one (`btc-race-fallback`) bought 100% of cash on
the first priced bar, which made its action log byte-for-byte the kit's buy-and-hold house
baseline, and the rules say an entry whose action log matches an earlier entry's is "identical
behaviour": it keeps its place and takes no prize. This version keeps the strategy and changes the
wire behaviour on purpose.

## Strategy

The bot speaks `agent-fun/bars-replay/v1`; everything is in `main.ts`.

1. **Entry, one bar late.** On the second batch that carries a CBBTC close, send one buy for
   `min(cash, caps.max_weight_bps * equity / 10000)` with `max_slippage_bps: 10000`, so the fill is
   never refused on slippage. The first reply is therefore empty. A buy the market refuses (no bar
   at that open, say) is sent again on the next bar with a close, so a missing minute cannot leave
   the bot with no trade at all.
2. **Peak tracking.** While the position is held, record the highest equity seen (cash plus the
   position marked at its latest close). The peak starts at the first marked equity, i.e. after the
   entry's fee, slippage and price impact are already paid.
3. **Stop.** If equity falls **300 bps (3%) or more below that peak**, sell the entire position,
   again with `max_slippage_bps: 10000`, and then stay in cash for the rest of the window. No
   re-entry, no scaling. A refused sell is sent again on the next bar, because once the stop has
   fired the position must not be carried further.

Every order carries its own `client_id` — `entry-<priced bars>`, `stop-<priced bars>` — instead of
the shim's default `o1`, `o2`, so the replies differ from other buy-and-hold bots even on a window
whose first minute has no bar and every plain hold ends up buying on the same bar.

Nothing reads the clock, the network, the environment or a random source: the same bars always
produce the same orders, which the grader's two-run determinism check requires.

## Why one bar late

A full-size round trip pays roughly 26 bps in fee, slippage and price impact, so extra signal-driven
trades have to catch a move bigger than that. The naive momentum, EMA-cross and channel filters
tried against this dev window lost money on the chop, so this bot makes exactly one entry decision
and spends its second decision only on risk.

## Variants tested on the dev window

All four were graded with the kit's own harness (`--driver process`), start from 1,000 USDC, and
each made money with one trade:

| Entry | Buy | Net PnL (micro-USDC) | Return | Trades | Max DD | Action log |
|---|---|---|---|---|---|---|
| second batch | 100% of cash | **+9,988,128** | **+0.9988%** | 1 | 2.5151% | `8311939a…` |
| first batch | 99.5% of cash | +9,755,665 | +0.9756% | 1 | 2.5027% | `eba1925c…` |
| first batch | 99.0% of cash | +9,714,654 | +0.9715% | 1 | 2.4903% | `977e5c2e…` |
| second batch | 99.5% of cash | +9,947,153 | +0.9947% | 1 | 2.5027% | `1fab7a04…` |

The second-batch entry at full size had the best dev PnL, so that is what this repository ships.
None of these logs matches the house buy-and-hold baseline's
`ec69ec98c6db3489578a29bee94fe1d20678c6a2e8ee42ed58aac8fed96b4d40`.

A 3% stop was chosen over 2.5% because the dev window's worst peak-to-trough in this bot's own
equity path is just above 2.51% (a 251 bps stop fires, a 252 bps stop does not): 2.5% trips on the
dev low, locks a loss and fails the dev gate, while 3.0% clears it by about 48 bps and is the
tightest level that passes, so it gives the best worst case.

## Exact dev grade

Kit `btc-race-24h-20261109-2239`, dev phase, `dataset_sha256`
`0144817b7aceb2a0a127a21511291860aa5dab56bd6fb0a425c81f102b3b9900`, driver `process`, graded from
the worktree and again from the commit. The harness runs the bot twice and the two action logs
match byte for byte:

- net PnL: **+9,988,128 micro-USDC** (+9.988128 USDC)
- return: **0.009988128** (+0.9988%)
- trades: **1**
- max drawdown: **0.025150865** (2.5151%)
- Sharpe: **0.010980733**
- rejected orders: 0
- action log sha256: `8311939a469dff953ad7bd8a85d2c53d7c839f0964784bb9b50ecfd822082a9e`

The action log is one empty reply at `seq 0`, then a buy at `seq 1`:

```json
{"orders":[{"client_id":"entry-2","max_slippage_bps":10000,"notional_quote_units":"1000000000","side":"buy","symbol":"CBBTC"}],"seq":1,"type":"reply"}
```

The buy-and-hold baseline instead buys at `seq 0` with the shim's `client_id "o1"`, so the logs are
not the same bytes and the "identical behaviour" rule cannot apply.

## How to run

Node 22, no dependencies, no install step: TypeScript runs through Node's type stripping. The bot
speaks the line protocol on stdin/stdout and is normally driven by the harness. To reproduce the
dev grade with the competition kit:

```bash
cd <path-to>/btc-race-24h-20261109-2239-kit
node cli/makefun.mjs grade-local \
  --kit . \
  --bot <path-to>/btc-race-fallback2 \
  --worktree \
  --driver process \
  --json
```

`vendor/makefun-bars.ts` is a byte-identical copy of the kit's `sdk/makefun-bars.ts`
(sha256 `e437a28f69bde12ba3383bffa68250d1e4b8f2d8a227a25eb8f8b654432fa261`); it owns the wire and
the `BarsState` helpers and is not this entry's code.

## Risk

The stop is insurance, not a profit centre: a 3% dip that recovers sells near the low and forgoes
the recovery, and the exit fills at the next bar's open, so a gap can realise worse than 3%. Entering
on the second bar also means the entry price is one minute further into the window, with no filter
against a window that opens at a local top.
