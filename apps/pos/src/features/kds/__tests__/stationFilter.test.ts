// apps/pos/src/features/kds/__tests__/stationFilter.test.ts
//
// S75 (task 7) — StationFilter chips wired to real `categories.kds_station`
// data. Covers the exported `filterAndArchive` predicate in isolation:
//   - chip 'bar' + item kds_station 'hot'  → false (narrowed out)
//   - chip 'bar' + item kds_station 'bar'  → true  (matches)
//   - chip 'bar' + item kds_station null   → true  (unresolved category
//     passes ALL chips — nothing silently vanishes, per brief)
//   - chip 'all' → true regardless of kds_station (passthrough)
//
// Archive-window behaviour (ready items > archiveMs old) is already covered
// by KdsBoard.test.tsx; this file is scoped to the station-chip narrowing
// added in this task.

import { describe, it, expect } from 'vitest';

import { filterAndArchive } from '../KdsBoard';
import type { KdsItemRow } from '../hooks/useKdsOrders';

function makeItem(overrides: Partial<KdsItemRow> = {}): KdsItemRow {
  return {
    id: 'oi-1',
    order_id: 'ord-1',
    product_id: 'prod-1',
    product_name: 'Americano',
    quantity: 1,
    unit_price: 35000,
    modifiers: [],
    modifiers_total: 0,
    kitchen_status: 'pending',
    dispatch_station: 'kitchen',
    dispatch_stations: null,
    kds_station: null,
    sent_to_kitchen_at: new Date('2026-05-14T11:59:00.000Z').toISOString(),
    ready_at: null,
    prep_started_at: null,
    order_number: '#A-001',
    order_status: 'pending_payment',
    order_notes: null,
    is_cancelled: false,
    cancelled_at: null,
    cancelled_reason: null,
    ...overrides,
  };
}

const NOW = Date.parse('2026-05-14T12:00:00.000Z');
const ARCHIVE_MS = 300_000;

describe('filterAndArchive — station chip narrowing (S75 task 7)', () => {
  it('drops an item whose kds_station does not match the active chip', () => {
    const item = makeItem({ kds_station: 'hot' });
    expect(filterAndArchive(item, 'bar', NOW, ARCHIVE_MS)).toBe(false);
  });

  it('keeps an item whose kds_station matches the active chip', () => {
    const item = makeItem({ kds_station: 'bar' });
    expect(filterAndArchive(item, 'bar', NOW, ARCHIVE_MS)).toBe(true);
  });

  it('keeps an item with kds_station null under ANY chip (unresolved category never vanishes)', () => {
    const item = makeItem({ kds_station: null });
    expect(filterAndArchive(item, 'bar', NOW, ARCHIVE_MS)).toBe(true);
  });

  it('the "all" chip is a passthrough regardless of kds_station', () => {
    const item = makeItem({ kds_station: 'hot' });
    expect(filterAndArchive(item, 'all', NOW, ARCHIVE_MS)).toBe(true);
  });
});
