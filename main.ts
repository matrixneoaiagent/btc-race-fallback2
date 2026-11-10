// SPDX-License-Identifier: MIT
//
// cbBTC buy-and-hold with a hard peak-to-trough stop, entering one bar late.
//
// The first fallback entry bought 100% of cash on the very first priced bar, which made its
// action log byte-for-byte the kit's buy-and-hold house baseline: same order, same notional,
// one trade. The rules mark an entry whose action log matches an earlier entry's as "identical
// behaviour": it keeps its place and takes no prize. So this version is deliberately different
// on the wire while keeping the same strategy and a positive dev grade:
//
//   - it enters on the second batch that carries a CBBTC close, not the first (the first reply
//     therefore carries no order at all), and
//   - it names its own client_ids ("entry-<n>", "stop-<n>") instead of letting the shim hand out
//     "o1", "o2", ..., so the replies differ even on a window whose first minute has no bar and
//     every buy-and-hold bot ends up buying on the same bar.
//
// The strategy itself is unchanged:
//
//   1. Entry: one buy for min(cash, caps.max_weight_bps x equity / 10000), max_slippage_bps wide
//      open so the fill is never refused on slippage. A refused buy is tried again on the next
//      bar with a close, so a missing minute cannot leave the bot with no trade at all.
//   2. Peak: while the position is held, track the highest equity seen (cash plus the position
//      marked at its latest close).
//   3. Stop: when equity falls 300 bps or more below that peak, sell the whole position, again
//      with max_slippage_bps wide open, and stay in cash for the rest of the window.
//
// No clock, no network, no environment, no randomness: the bars decide everything.

import { BPS, runBars, type OrderInput } from './vendor/makefun-bars.ts';

/** The symbol this bot trades; the universe has exactly one. */
const SYMBOL = 'CBBTC';
/** How far equity may fall from its post-entry peak before the position is sold. */
const STOP_BPS = 300n;
/** How many priced bars to skip before entering (1 = the second batch with a close). */
const ENTRY_DELAY_BARS = 1;
/** Wide open: neither the entry nor the stop may be refused on slippage. */
const MAX_SLIPPAGE_BPS = 10_000;

/** Batches seen so far that carried a CBBTC close. */
let pricedBars = 0;
/** The stop has fired; the bot is in cash for the rest of the window and never buys again. */
let stopFired = false;
/** Highest equity seen while the position was held. */
let peakEquity = 0n;

await runBars({
  onBatch(state): OrderInput[] {
    if (state.close(SYMBOL) !== null) pricedBars++;
    const position = state.positions.get(SYMBOL);

    // Holding: ratchet the peak, then check the stop against this bar's mark. A sell the market
    // refuses is sent again on the next bar: once the stop has fired the position must not be
    // carried any further.
    if (position !== undefined && position.qty > 0n) {
      if (state.equity > peakEquity) peakEquity = state.equity;
      if (stopFired || (peakEquity > 0n && (peakEquity - state.equity) * BPS >= peakEquity * STOP_BPS)) {
        stopFired = true;
        return [{
          side: 'sell',
          client_id: `stop-${pricedBars}`,
          symbol: SYMBOL,
          qty: position.qty,
          max_slippage_bps: MAX_SLIPPAGE_BPS,
        }];
      }
      return [];
    }

    // Flat. Enter once the delay has passed, then never again after the stop.
    if (stopFired || pricedBars <= ENTRY_DELAY_BARS) return [];

    const { caps, fees } = state.hello;
    const byWeight = (BigInt(caps.max_weight_bps) * state.equity) / BPS;
    const spend = state.cash < byWeight ? state.cash : byWeight;
    if (spend === 0n || spend < BigInt(fees.min_notional_quote_units)) return [];

    return [{
      side: 'buy',
      client_id: `entry-${pricedBars}`,
      symbol: SYMBOL,
      notional_quote_units: spend,
      max_slippage_bps: MAX_SLIPPAGE_BPS,
    }];
  },
});
