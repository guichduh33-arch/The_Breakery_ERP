// apps/pos/src/features/tablet/__tests__/tablet-send-idempotent.smoke.test.tsx
//
// Session 25 / Phase 2.A.3 — POS smoke for tablet-send idempotency wiring.
//
// Strategy:
//   - Unit-level smoke: mocks `@/lib/supabase` so that `supabase.rpc` is a
//     pure spy. No live DB, no UI rendering — we exercise the
//     `useCreateTabletOrder` hook in isolation with React Query.
//   - Verifies that the post-S25 hook signature `{ cart, waiterId, clientUuid }`
//     forwards `clientUuid` as `p_client_uuid` to the `create_tablet_order_v9`
//     RPC, and that a retry with the SAME `clientUuid` re-sends the SAME
//     `p_client_uuid` value (sticky UUID lifecycle).

/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { TabletCart } from '@breakery/domain';
import { useCreateTabletOrder } from '../hooks/useCreateTabletOrder';

// ── Hoisted Supabase mock ────────────────────────────────────────────
const supaMocks = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: supaMocks.rpc },
}));

// ── Helpers ──────────────────────────────────────────────────────────
// `useCreateTabletOrder` chains `.abortSignal(...)` on the `rpc()` builder
// (Critique 2026-08-24 P0, 15s timeout) — the mock must expose it.
function rpcResult(data: unknown, error: unknown = null) {
  return { abortSignal: () => Promise.resolve({ data, error }) };
}

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

const minimalCart: TabletCart = {
  items: [
    { id: 'l1', product_id: 'p-1', name: 'Americano', unit_price: 25000, quantity: 1, modifiers: [] },
  ],
  tableNumber: 'T1',
  orderType: 'dine_in',
};

// ── Tests ────────────────────────────────────────────────────────────
describe('S25 useCreateTabletOrder — idempotency wiring', () => {
  beforeEach(() => {
    supaMocks.rpc.mockReset();
  });

  it('C1: passes the provided clientUuid as p_client_uuid to create_tablet_order_v9', async () => {
    supaMocks.rpc.mockReturnValue(rpcResult('order-id-1'));

    const wrapper = makeWrapper();
    const { result } = renderHook(() => useCreateTabletOrder(), { wrapper });

    const myUuid = '11111111-1111-1111-1111-111111111111';
    await act(async () => {
      await result.current.mutateAsync({
        cart: minimalCart,
        waiterId: 'w-1',
        clientUuid: myUuid,
      });
    });

    expect(supaMocks.rpc).toHaveBeenCalledTimes(1);
    expect(supaMocks.rpc).toHaveBeenCalledWith(
      'create_tablet_order_v9',
      expect.objectContaining({
        p_client_uuid: myUuid,
        p_waiter_id: 'w-1',
        p_table_number: 'T1',
        p_order_type: 'dine_in',
      }),
    );
  });

  it('C2: retry mutate with SAME clientUuid forwards the same p_client_uuid on both RPC calls', async () => {
    supaMocks.rpc.mockReturnValue(rpcResult('order-id-2'));

    const wrapper = makeWrapper();
    const { result } = renderHook(() => useCreateTabletOrder(), { wrapper });

    const stickyUuid = '22222222-2222-2222-2222-222222222222';

    // First send.
    await act(async () => {
      await result.current.mutateAsync({
        cart: minimalCart,
        waiterId: 'w-2',
        clientUuid: stickyUuid,
      });
    });

    // Retry with the SAME clientUuid (simulates a user-triggered retry where
    // the UUID is preserved by the caller for idempotency).
    await act(async () => {
      await result.current.mutateAsync({
        cart: minimalCart,
        waiterId: 'w-2',
        clientUuid: stickyUuid,
      });
    });

    expect(supaMocks.rpc).toHaveBeenCalledTimes(2);

    const firstCallArgs = supaMocks.rpc.mock.calls[0]!;
    const secondCallArgs = supaMocks.rpc.mock.calls[1]!;

    expect(firstCallArgs[0]).toBe('create_tablet_order_v9');
    expect(secondCallArgs[0]).toBe('create_tablet_order_v9');

    const firstClientUuid = (firstCallArgs[1] as { p_client_uuid: string }).p_client_uuid;
    const secondClientUuid = (secondCallArgs[1] as { p_client_uuid: string }).p_client_uuid;

    expect(firstClientUuid).toBe(stickyUuid);
    expect(secondClientUuid).toBe(stickyUuid);
    expect(firstClientUuid).toBe(secondClientUuid);
  });

  // Audit lot 1 P0 n°6 (docs/audits/2026-08-31-audit-pos-flow.md) — lot D du
  // plan validé par Mamat le 2026-09-05. `create_tablet_order_v8` valide les
  // composants d'un combo mais ne les persiste jamais : `combo_components`
  // n'atteignait même pas le wire : `buildSubmitPayload` ne forwardait pas la
  // clé dans `p_items`. Enregistré rouge le 2026-09-05 avant la passe client,
  // vert depuis que `p_items[]` porte `combo_components` et que le hook cible
  // la v9.
  it('C4: a combo cart line forwards combo_components to create_tablet_order_v9', async () => {
    supaMocks.rpc.mockReturnValue(rpcResult('order-id-4'));

    const wrapper = makeWrapper();
    const { result } = renderHook(() => useCreateTabletOrder(), { wrapper });

    const comboCart: TabletCart = {
      items: [
        {
          id: 'l1',
          product_id: 'combo-1',
          name: 'Breakfast Set',
          unit_price: 40000,
          quantity: 1,
          modifiers: [{ group_name: 'Size', option_label: 'Large', price_adjustment: 8000 }],
          product_type: 'combo',
          combo_components: [{ product_id: 'comp-1', quantity: 1 }],
        },
      ],
      tableNumber: 'T4',
      orderType: 'dine_in',
    };

    await act(async () => {
      await result.current.mutateAsync({
        cart: comboCart,
        waiterId: 'w-4',
        clientUuid: '44444444-4444-4444-4444-444444444444',
      });
    });

    // Même lecture que C1/C2 : les arguments du mock sont relus tels quels
    // (un matcher `expect.arrayContaining` dans `toHaveBeenCalledWith` est
    // typé `any` et réveille no-unsafe-assignment sur le ratchet).
    expect(supaMocks.rpc).toHaveBeenCalledTimes(1);
    const callArgs = supaMocks.rpc.mock.calls[0]!;
    expect(callArgs[0]).toBe('create_tablet_order_v9');
    const items = (callArgs[1] as { p_items: { combo_components?: unknown }[] }).p_items;
    expect(items[0]?.combo_components).toEqual([{ product_id: 'comp-1', quantity: 1 }]);
  });
});
