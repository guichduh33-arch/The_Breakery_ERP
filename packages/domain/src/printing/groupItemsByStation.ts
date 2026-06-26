// packages/domain/src/printing/groupItemsByStation.ts
//
// Session 34 — pure grouping for station ticket printing (IO-free).
// Given cart items and a product→station map, bucket the items by their prep
// station so the caller can print one prep ticket per station. Items whose
// station is 'none', unmapped, or that are cancelled produce NO prep ticket.

import type { CartItem } from '../types/cart.js';
import type { DispatchStation } from '../kitchen/types.js';
import type { PrepStation } from './types.js';

const PREP_STATIONS: readonly PrepStation[] = ['barista', 'kitchen', 'display'];

function isPrepStation(value: DispatchStation | undefined | null): value is PrepStation {
  return value != null && (PREP_STATIONS as readonly string[]).includes(value);
}

/**
 * Group cart items by their prep station(s).
 *
 * @param items                 cart lines to route
 * @param stationsByProductId   map product_id → dispatch_station[] ; a product
 *                              routed to multiple stations appears in EVERY bucket.
 *                              Empty array / missing / 'none' entries → skipped.
 * @returns a partial record keyed by prep station ; stations with no item are absent.
 *
 * Rules:
 *  - cancelled lines (`is_cancelled`) are skipped (never printed).
 *  - a product with no mapping, or whose station list is empty, is skipped.
 *  - 'none' entries inside the list are silently ignored via `isPrepStation`.
 *  - order within each bucket preserves input order (FIFO for the ticket).
 */
export function groupItemsByStation(
  items: readonly CartItem[],
  stationsByProductId: Readonly<Record<string, DispatchStation[]>>,
): Partial<Record<PrepStation, CartItem[]>> {
  const grouped: Partial<Record<PrepStation, CartItem[]>> = {};
  for (const item of items) {
    if (item.is_cancelled) continue;
    const stations = stationsByProductId[item.product_id] ?? [];
    for (const station of stations) {
      if (!isPrepStation(station)) continue;
      (grouped[station] ??= []).push(item);
    }
  }
  return grouped;
}
