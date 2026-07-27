// apps/pos/src/features/lan/__tests__/offlineOutbox.test.ts
// Spec 006x lot 4 — outbox durable des intentions offline. jsdom n'a pas
// d'IndexedDB : c'est le backend localStorage (celui que la CI exerce) qui
// est testé, même contrat async que la prod.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  enqueueIntent, getPendingIntents, removeIntents, removeIntentsByRoot,
  pendingIntentCount, nextIntentSeq,
  type OfflineFireIntent, type OfflineCashPaymentIntent, type OfflinePaymentIntent,
} from '../offlineOutbox';

function fireIntent(overrides: Partial<OfflineFireIntent> = {}): OfflineFireIntent {
  return {
    kind: 'fire',
    id: 'fire-1',
    root_client_uuid: 'fire-1',
    seq: 1,
    created_at: '2026-07-21T10:00:00.000Z',
    local_number: 'L-1',
    session_id: 'session-1',
    order_type: 'take_out',
    table_number: null,
    items: [{ product_id: 'p1', quantity: 1, unit_price: 25000, modifiers: [] }],
    ...overrides,
  };
}

function cashIntent(overrides: Partial<OfflineCashPaymentIntent> = {}): OfflineCashPaymentIntent {
  return {
    kind: 'cash_payment',
    id: 'pay-1',
    root_client_uuid: 'fire-1',
    seq: 2,
    created_at: '2026-07-21T10:01:00.000Z',
    local_number: 'L-1',
    payment: { method: 'cash', amount: 25000, cash_received: 50000, change_given: 25000 },
    ...overrides,
  };
}

/** ADR-015 — format COURANT : n règlements, toutes méthodes sauf store_credit. */
function paymentIntent(overrides: Partial<OfflinePaymentIntent> = {}): OfflinePaymentIntent {
  return {
    kind: 'payment',
    id: 'pay-1',
    root_client_uuid: 'fire-1',
    seq: 2,
    created_at: '2026-07-21T10:01:00.000Z',
    local_number: 'L-1',
    payments: [
      { method: 'card', amount: 15000 },
      { method: 'cash', amount: 10000, cash_received: 20000, change_given: 10000 },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe('offlineOutbox (localStorage backend)', () => {
  it('enqueues write-first and reads back in seq order', async () => {
    await enqueueIntent(cashIntent());
    await enqueueIntent(fireIntent());
    const pending = await getPendingIntents();
    expect(pending.map((i) => i.id)).toEqual(['fire-1', 'pay-1']);
    expect(await pendingIntentCount()).toBe(2);
  });

  it('is idempotent on id (double enqueue = one record)', async () => {
    await enqueueIntent(fireIntent());
    await enqueueIntent(fireIntent());
    expect(await pendingIntentCount()).toBe(1);
  });

  it('removes only acked ids', async () => {
    await enqueueIntent(fireIntent());
    await enqueueIntent(cashIntent());
    await removeIntents(['fire-1']);
    const pending = await getPendingIntents();
    expect(pending.map((i) => i.id)).toEqual(['pay-1']);
  });

  it('removeIntentsByRoot purges fire + payment of a voided local order, keeps others', async () => {
    await enqueueIntent(fireIntent());
    await enqueueIntent(cashIntent());
    await enqueueIntent(fireIntent({ id: 'fire-2', root_client_uuid: 'fire-2', seq: 3, local_number: 'L-2' }));
    await removeIntentsByRoot('fire-1');
    const pending = await getPendingIntents();
    expect(pending.map((i) => i.id)).toEqual(['fire-2']);
  });

  // ── ADR-015 — intent multi-règlements + cohabitation avec le format legacy ──

  it('enqueues a multi-tender payment intent and reads its tenders back', async () => {
    await enqueueIntent(fireIntent());
    await enqueueIntent(paymentIntent());
    const pending = await getPendingIntents();
    expect(pending.map((i) => i.kind)).toEqual(['fire', 'payment']);
    const pay = pending[1] as OfflinePaymentIntent;
    expect(pay.payments).toHaveLength(2);
    expect(pay.payments.map((t) => t.method)).toEqual(['card', 'cash']);
  });

  it('removeIntentsByRoot purges the CURRENT payment kind too', async () => {
    await enqueueIntent(fireIntent());
    await enqueueIntent(paymentIntent());
    await enqueueIntent(fireIntent({ id: 'fire-2', root_client_uuid: 'fire-2', seq: 3, local_number: 'L-2' }));
    await removeIntentsByRoot('fire-1');
    expect((await getPendingIntents()).map((i) => i.id)).toEqual(['fire-2']);
  });

  it('legacy cash_payment records survive alongside the current format', async () => {
    // Un terminal mis à jour avec des ventes déjà en file : les deux formes
    // cohabitent dans l'outbox et sortent dans l'ordre de seq (invariant 1).
    await enqueueIntent(cashIntent({ id: 'legacy-1', seq: 1 }));
    await enqueueIntent(paymentIntent({ id: 'current-1', seq: 2 }));
    const pending = await getPendingIntents();
    expect(pending.map((i) => [i.id, i.kind])).toEqual([
      ['legacy-1', 'cash_payment'],
      ['current-1', 'payment'],
    ]);
  });

  it('nextIntentSeq is monotonic and survives a broken storage', () => {
    const a = nextIntentSeq();
    const b = nextIntentSeq();
    expect(b).toBe(a + 1);
    const broken = {
      getItem: () => { throw new Error('quota'); },
      setItem: () => { throw new Error('quota'); },
    };
    expect(nextIntentSeq(broken)).toBeGreaterThan(0);
  });
});
