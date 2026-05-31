// packages/domain/src/printing/groupItemsByStation.ts
//
// Session 34 — pure grouping for station ticket printing (IO-free).
// Given cart items and a product→station map, bucket the items by their prep
// station so the caller can print one prep ticket per station. Items whose
// station is 'none', unmapped, or that are cancelled produce NO prep ticket.

import type { CartItem } from '../types/cart.js';
import type { DispatchStation } from '../kitchen/types.js';
import type { PrepStation } from './types.js';

const PREP_STATIONS: readonly PrepStation[] = ['barista', 'kitchen', 'bakery'];

function isPrepStation(value: DispatchStation | undefined | null): value is PrepStation {
  return value != null && (PREP_STATIONS as readonly string[]).includes(value);
}

/**
 * Group cart items by their prep station.
 *
 * @param items              cart lines to route
 * @param stationByProductId map product_id → dispatch_station ('none'/missing → skipped)
 * @returns a partial record keyed by prep station ; stations with no item are absent.
 *
 * Rules:
 *  - cancelled lines (`is_cancelled`) are skipped (never printed).
 *  - a product with no mapping, or mapped to 'none', is skipped.
 *  - order within each bucket preserves input order (FIFO for the ticket).
 */
export function groupItemsByStation(
  items: readonly CartItem[],
  stationByProductId: Readonly<Record<string, DispatchStation>>,
): Partial<Record<PrepStation, CartItem[]>> {
  const grouped: Partial<Record<PrepStation, CartItem[]>> = {};

  for (const item of items) {
    if (item.is_cancelled) continue;
    const station = stationByProductId[item.product_id];
    if (!isPrepStation(station)) continue;
    (grouped[station] ??= []).push(item);
  }

  return grouped;
}
