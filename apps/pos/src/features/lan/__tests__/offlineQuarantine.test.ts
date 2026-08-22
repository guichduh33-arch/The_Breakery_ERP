// apps/pos/src/features/lan/__tests__/offlineQuarantine.test.ts
//
// ADR-018 — un intent DÉFINITIVEMENT rejeté au rejeu sort vers la quarantaine
// et le drain CONTINUE ; un échec TRANSITOIRE garde le comportement d'origine
// (arrêt du drain, file intacte et ordonnée).
//
// Le scénario de référence est celui qui a motivé l'ADR : coupure en soirée,
// une commande de salle dine-in sans table part en file, DOUZE encaissements
// s'empilent derrière. Avant l'ADR, le refus de la commande de salle bloquait
// les douze — de l'argent réellement perçu qui ne remontait jamais.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const rpcMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: rpcMock } }));

const emitPosEventMock = vi.hoisted(() => vi.fn());
vi.mock('@/features/audit/emitPosEvent', () => ({ emitPosEvent: emitPosEventMock }));

import { replayOfflineOutbox } from '../offlineReplay';
import {
  enqueueIntent,
  getPendingIntents,
  getQuarantinedIntents,
  quarantinedIntentCount,
  type OfflineIntent,
} from '../offlineOutbox';
import { useAuthStore } from '@/stores/authStore';
import { useCartStore } from '@/stores/cartStore';

/** Erreur telle que la produit le code de rejeu : message + `details.code`. */
function rpcError(code: string, message: string) {
  return { data: null, error: { code, message } };
}

function tabletIntent(over: Partial<OfflineIntent> = {}): OfflineIntent {
  return {
    kind: 'tablet_order', id: 'tab-1', seq: 1,
    created_at: '2026-07-31T18:30:00.000Z', local_number: 'L-1',
    waiter_id: 'w-1', table_number: '', order_type: 'dine_in', notes: null,
    items: [{ product_id: 'p1', quantity: 2, unit_price: 20000, modifiers: [] }],
    ...over,
  } as OfflineIntent;
}

function cashIntent(id: string, seq: number, amount: number): OfflineIntent {
  return {
    kind: 'cash_payment', id, root_client_uuid: `root-${id}`, seq,
    created_at: '2026-07-31T18:40:00.000Z', local_number: `L-${seq}`,
    payment: { method: 'cash', amount, cash_received: amount, change_given: 0 },
  };
}

beforeEach(() => {
  localStorage.clear();
  rpcMock.mockReset();
  emitPosEventMock.mockReset();
  useAuthStore.setState({ isAuthenticated: true });
  useCartStore.setState({ pickedUpOrderId: null, offlineOrder: null });
});

describe('ADR-018 — quarantaine des intents définitivement rejetés', () => {
  it("la commande de salle refusée part en quarantaine et les encaissements derrière remontent", async () => {
    rpcMock.mockImplementation((fn: string) => {
      if (fn === 'create_tablet_order_v8') {
        return Promise.resolve(rpcError('P0011', 'table_required_for_dine_in'));
      }
      if (fn === 'fire_counter_order_v7') {
        return Promise.resolve({
          data: { order_id: 'db-1', order_number: '#0001', idempotent_replay: false },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });

    await enqueueIntent(tabletIntent());
    // Douze encaissements espèces derrière la commande empoisonnée.
    for (let i = 0; i < 12; i += 1) {
      await enqueueIntent(cashIntent(`pay-${i}`, i + 2, 40000));
    }

    const res = await replayOfflineOutbox();

    expect(res.quarantined).toBe(1);
    expect(res.failed).toBe(0);
    // Les 12 paiements (fire idempotent + pay = 2 appels chacun) sont passés.
    expect(res.replayed).toBe(12);
    expect(await getPendingIntents()).toEqual([]);

    const quarantined = await getQuarantinedIntents();
    expect(quarantined).toHaveLength(1);
    expect(quarantined[0]).toMatchObject({
      id: 'tab-1',
      code: 'P0011',
      reason: 'table_required_for_dine_in',
    });
    expect(quarantined[0]!.intent.kind).toBe('tablet_order');
  });

  it('un échec transitoire laisse la file intacte et arrête le drain (D1)', async () => {
    // Pas de `code` : réseau coupé en plein drain — le défaut est transitoire.
    rpcMock.mockResolvedValue({ data: null, error: { message: 'Failed to fetch' } });

    await enqueueIntent(tabletIntent());
    await enqueueIntent(cashIntent('pay-0', 2, 40000));

    const res = await replayOfflineOutbox();

    expect(res.replayed).toBe(0);
    expect(res.failed).toBe(2);
    expect(res.quarantined).toBeUndefined();
    expect(await quarantinedIntentCount()).toBe(0);
    // La file est intacte ET toujours ordonnée par seq.
    expect((await getPendingIntents()).map((i) => i.id)).toEqual(['tab-1', 'pay-0']);
  });

  it("un code inconnu reste transitoire — le défaut protège l'argent (D2)", async () => {
    rpcMock.mockResolvedValue(rpcError('P0003', 'Permission denied: sales.create'));

    await enqueueIntent(tabletIntent());
    const res = await replayOfflineOutbox();

    expect(res.failed).toBe(1);
    expect(await quarantinedIntentCount()).toBe(0);
    expect(await getPendingIntents()).toHaveLength(1);
  });

  it('la quarantaine cascade sur la racine : le règlement suit son fire (D3)', async () => {
    rpcMock.mockImplementation((fn: string) => {
      if (fn === 'fire_counter_order_v7') {
        return Promise.resolve(rpcError('23514', 'Order must contain at least one item'));
      }
      return Promise.resolve({ data: null, error: null });
    });

    await enqueueIntent({
      kind: 'fire', id: 'root-9', root_client_uuid: 'root-9', seq: 1,
      created_at: '2026-07-31T18:30:00.000Z', local_number: 'L-9',
      session_id: 'sess-1', order_type: 'take_out', table_number: null, items: [],
    });
    await enqueueIntent({
      kind: 'cash_payment', id: 'pay-9', root_client_uuid: 'root-9', seq: 2,
      created_at: '2026-07-31T18:31:00.000Z', local_number: 'L-9',
      payment: { method: 'cash', amount: 15000, cash_received: 15000, change_given: 0 },
    });

    const res = await replayOfflineOutbox();

    // Le règlement n'est JAMAIS rejoué seul : sans sa commande, il échouerait
    // à son tour et le blocage n'aurait été déplacé que d'un cran.
    expect(res.quarantined).toBe(2);
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(await getPendingIntents()).toEqual([]);

    const ids = (await getQuarantinedIntents()).map((q) => q.id);
    expect(ids).toEqual(expect.arrayContaining(['root-9', 'pay-9']));
  });

  it('toute mise en quarantaine laisse une trace, et un règlement crie (D5)', async () => {
    rpcMock.mockImplementation((fn: string) =>
      fn === 'fire_counter_order_v7'
        ? Promise.resolve(rpcError('23514', 'Order must contain at least one item'))
        : Promise.resolve({ data: null, error: null }),
    );

    await enqueueIntent({
      kind: 'fire', id: 'root-9', root_client_uuid: 'root-9', seq: 1,
      created_at: '2026-07-31T18:30:00.000Z', local_number: 'L-9',
      session_id: 'sess-1', order_type: 'take_out', table_number: null, items: [],
    });
    await enqueueIntent({
      kind: 'cash_payment', id: 'pay-9', root_client_uuid: 'root-9', seq: 2,
      created_at: '2026-07-31T18:31:00.000Z', local_number: 'L-9',
      payment: { method: 'cash', amount: 15000, cash_received: 15000, change_given: 0 },
    });

    await replayOfflineOutbox();

    const types = emitPosEventMock.mock.calls.map((c) => c[0] as string);
    // Une trace de quarantaine par victime…
    expect(types.filter((t) => t === 'offline_intent_quarantined')).toHaveLength(2);

    const quarantineCalls = emitPosEventMock.mock.calls.filter(
      (c) => c[0] === 'offline_intent_quarantined',
    );
    const cascaded = quarantineCalls.find(
      (c) => (c[1] as { payload: { kind: string } }).payload.kind === 'cash_payment',
    );
    expect(cascaded![1]).toMatchObject({
      amount: 15000,
      order_number_snap: 'L-9',
      payload: { idempotency_key: 'pay-9', code: '23514', cascaded: true },
    });
  });
});
