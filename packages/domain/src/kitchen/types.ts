// packages/domain/src/kitchen/types.ts
//
// Kitchen / KDS domain types — session 2.
// Spec ref: docs/superpowers/specs/2026-05-05-session-2-modifiers-kds-spec.md
// §1 (K2 — 3 statuses), §3.2 (categories.dispatch_station), §4.7

/**
 * Lifecycle of a sent order_item on the KDS:
 *   pending  → preparing → ready → served
 * `served` is terminal (session 4).
 */
export type KitchenStatus = 'pending' | 'preparing' | 'ready' | 'served';

/**
 * Where an order_item is routed once "Send to Kitchen" is hit.
 * Copied from `categories.dispatch_station` at send time (spec §3.5).
 * `'none'` means the category has no KDS routing — the item never appears
 * on any KDS screen (e.g. cold drinks ringed up directly).
 */
export type DispatchStation = 'kitchen' | 'barista' | 'bakery' | 'none';

export const KITCHEN_STATUSES: readonly KitchenStatus[] = [
  'pending',
  'preparing',
  'ready',
  'served',
] as const;

export const DISPATCH_STATIONS: readonly DispatchStation[] = [
  'kitchen',
  'barista',
  'bakery',
  'none',
] as const;

/**
 * Stations that actually display tickets on a KDS screen.
 * Excludes `'none'`.
 */
export const KDS_STATIONS: readonly Exclude<DispatchStation, 'none'>[] = [
  'kitchen',
  'barista',
  'bakery',
] as const;
