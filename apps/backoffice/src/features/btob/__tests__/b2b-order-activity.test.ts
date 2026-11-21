// apps/backoffice/src/features/btob/__tests__/b2b-order-activity.test.ts
//
// Historique de la commande B2B : chaque événement porte date-heure, action,
// personne et détail ; les plus récents d'abord ; un code inconnu reste lisible.

import { describe, it, expect } from 'vitest';
import { buildB2bOrderActivity, type B2bOrderAllocationRow, type B2bOrderAuditRow } from '../b2bOrderActivity.js';

const AUDIT: B2bOrderAuditRow[] = [
  {
    id: 1, action: 'b2b.order.created', created_at: '2026-10-31T01:00:00Z',
    metadata: { invoice_number: 'INV/2026/00012', items_total: 240000, delivery_date: '2026-10-31' },
    actor: { full_name: 'Riyanti' },
  },
  {
    id: 2, action: 'b2b.order.delivered', created_at: '2026-11-01T04:05:00Z',
    metadata: { pickup_date: '2026-10-31' }, actor: { full_name: 'Agus' },
  },
  {
    id: 3, action: 'b2b.order.edited', created_at: '2026-10-31T02:00:00Z',
    metadata: { total_delta: -40000 }, actor: null,
  },
  {
    id: 4, action: 'b2b.order.something_new', created_at: '2026-10-30T00:00:00Z',
    metadata: null, actor: { full_name: 'mamat' },
  },
];

const ALLOCATIONS: B2bOrderAllocationRow[] = [
  {
    id: 'a1', amount_applied: 100000, created_at: '2026-11-05T03:00:00Z',
    payment: {
      payment_number: 'BP-2026-0028', method: 'transfer', paid_at: '2026-11-05T02:59:00Z',
      created_at: '2026-11-05T03:00:00Z', creator: { full_name: 'Annisa' },
    },
  },
];

describe('buildB2bOrderActivity', () => {
  const events = buildB2bOrderActivity(AUDIT, ALLOCATIONS);

  it('orders events most recent first', () => {
    expect(events.map((e) => e.id)).toEqual(['alloc-a1', 'audit-2', 'audit-3', 'audit-1', 'audit-4']);
  });

  it('names the action and the person of each event', () => {
    expect(events[0]).toMatchObject({ action: 'Payment received', person: 'Annisa', at: '2026-11-05T02:59:00Z' });
    expect(events[1]).toMatchObject({ action: 'Collected', person: 'Agus' });
    expect(events[3]).toMatchObject({ action: 'Order created', person: 'Riyanti' });
  });

  it('keeps a missing person as null, never a guess', () => {
    expect(events[2]).toMatchObject({ action: 'Order edited', person: null });
  });

  it('gives a readable detail for each known action', () => {
    expect(events[0]?.detail).toBe('BP-2026-0028 · Bank transfer · Rp 100.000 applied');
    expect(events[2]?.detail).toBe('Total −Rp 40.000');
    expect(events[3]?.detail).toMatch(/^INV\/2026\/00012 · Rp 240\.000 · pickup /);
  });

  it('turns an unknown action code into words, not the raw code', () => {
    expect(events[4]?.action).toBe('Something new');
  });
});
