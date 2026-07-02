// apps/pos/src/features/payment/__tests__/checkout-fired-order-sync.smoke.test.tsx
//
// Session 43 / Wave C — P0-3 : checkout d'un ordre comptoir FIRED.
// pay_existing_order_v11 paie les order_items PERSISTÉS, pas le panier local —
// les items ajoutés APRÈS le dernier fire doivent être appendés à l'ordre DB
// (fire_counter_order_v4 append mode) AVANT le paiement, sinon le client paie
// un total partiel.
//
// Couvre :
//   • append AVANT pay : ordre des appels RPC + p_order_id + seulement les
//     items non-locked (non présents dans printedItemIds).
//   • rien à appender (tout est fired) → pay direct, pas d'appel fire.
//   • garde comptoir : un pickup tablette (printedItemIds vide) a déjà tous
//     ses items en DB → pas d'append même si le filtre "unsynced" matcherait.
//   • idempotence retry : pay échoue → le retry manuel (handleRetry rejoue
//     mutationFn) rejoue le MÊME p_client_uuid d'append (pas de doublon DB).

/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useCartStore } from '@/stores/cartStore';
import { useShiftStore } from '@/stores/shiftStore';
import { usePaymentStore } from '@/stores/paymentStore';

// ── Hoisted mocks (stable refs — S39 lesson DEV-S39-B1-01) ───────────────────

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));

vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: (...a: unknown[]) => rpcMock(...a) },
  supabaseUrl: 'http://sb.test',
}));

vi.mock('@/lib/accessToken', () => ({
  getAccessToken: vi.fn().mockResolvedValue('tok'),
}));

const FIRE_OK = {
  data: { order_id: 'order-db-1', order_number: '#0042', idempotent_replay: false },
  error: null,
};
const PAY_OK = {
  data: {
    order_id: 'order-db-1',
    order_number: '#0042',
    subtotal: 60_000,
    tax_amount: 0,
    total: 60_000,
    change_given: null,
    idempotent_replay: false,
  },
  error: null,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

/** Fired counter order : l1 sealed by the last fire, l2 added afterwards. */
function seedFiredCounterCart() {
  useCartStore.setState({
    cart: {
      items: [
        { id: 'l1', product_id: 'p1', name: 'Latte', unit_price: 30_000, quantity: 1, modifiers: [] },
        {
          id: 'l2',
          product_id: 'p2',
          name: 'Croissant',
          unit_price: 15_000,
          quantity: 2,
          modifiers: [],
          discount: { type: 'fixed_amount', value: 1_000, amount: 1_000, reason: 'day-old' },
        },
      ],
      order_type: 'take_out',
    },
    printedItemIds: ['l1'],
    lockedItemIds: ['l1'],
    attachedCustomer: null,
    pickedUpOrderId: 'order-db-1',
    appliedPromotions: [],
    dismissedPromotionIds: new Set<string>(),
    isOffline: false,
  });
}

async function runCheckout() {
  const { useCheckout } = await import('../hooks/useCheckout');
  const { result } = renderHook(() => useCheckout(), { wrapper });
  await act(async () => {
    await result.current.mutateAsync({
      cart: useCartStore.getState().cart,
      payment: { method: 'cash', amount: 60_000 },
    });
  });
  return result;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('useCheckout — fired counter order syncs unfired items before paying (P0-3)', () => {
  beforeEach(() => {
    rpcMock.mockReset();
    rpcMock.mockImplementation((fn: unknown) =>
      Promise.resolve(fn === 'fire_counter_order_v4' ? FIRE_OK : PAY_OK),
    );
    useShiftStore.setState({ current: { id: 'sess-1', opened_at: '', opening_cash: 0 } });
    usePaymentStore.setState({ idempotencyKey: 'attempt-1' });
    seedFiredCounterCart();
  });

  it('appends the unsynced items (fire append mode) BEFORE pay_existing_order_v11', async () => {
    await runCheckout();

    expect(rpcMock.mock.calls.map((c) => c[0])).toEqual([
      'fire_counter_order_v4',
      'pay_existing_order_v11',
    ]);

    const appendArgs = rpcMock.mock.calls[0]![1] as Record<string, unknown>;
    expect(appendArgs.p_order_id).toBe('order-db-1'); // append, not create
    expect(appendArgs.p_session_id).toBe('sess-1');
    expect(typeof appendArgs.p_client_uuid).toBe('string');
    // Only l2 — l1 is already persisted (printedItemIds).
    expect(appendArgs.p_items).toHaveLength(1);
    expect(appendArgs.p_items).toEqual([
      { product_id: 'p2', quantity: 2, unit_price: 15_000, modifiers: [], discount_amount: 1_000 },
    ]);

    const payArgs = rpcMock.mock.calls[1]![1] as Record<string, unknown>;
    expect(payArgs.p_order_id).toBe('order-db-1');

    // Append success seals l2 LOCKED (the DB owns it — no re-append/edit) but
    // NOT printed: the post-pay printOnly auto-fire computes from
    // unprintedItems() and must still print l2's prep ticket.
    expect(useCartStore.getState().lockedItemIds).toContain('l2');
    expect(useCartStore.getState().printedItemIds).not.toContain('l2');
  });

  it('pays directly (no append) when every item was already fired', async () => {
    useCartStore.setState({ printedItemIds: ['l1', 'l2'], lockedItemIds: ['l1', 'l2'] });

    await runCheckout();

    expect(rpcMock.mock.calls.map((c) => c[0])).toEqual(['pay_existing_order_v11']);
  });

  it('tablet pickup (printedItemIds empty): never appends — all items already live in DB', async () => {
    // A pickup restores the server order's items locked but NOT printed; the
    // append guard keys on printedItemIds (counter fires seal items printed).
    useCartStore.setState({ printedItemIds: [], lockedItemIds: ['l1', 'l2'] });

    await runCheckout();

    expect(rpcMock.mock.calls.map((c) => c[0])).toEqual(['pay_existing_order_v11']);
  });

  it('retry after an append FAILURE replays the SAME p_client_uuid (nothing was locked)', async () => {
    rpcMock.mockImplementation((fn: unknown) =>
      Promise.resolve(
        fn === 'fire_counter_order_v4' ? { data: null, error: { message: 'append_boom' } } : PAY_OK,
      ),
    );

    const { useCheckout } = await import('../hooks/useCheckout');
    const { result } = renderHook(() => useCheckout(), { wrapper });

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          cart: useCartStore.getState().cart,
          payment: { method: 'cash', amount: 60_000 },
        }),
      ).rejects.toThrow('append_boom');
    });

    // Append never succeeded → l2 was NOT locked, so the retry re-appends…
    expect(useCartStore.getState().lockedItemIds).not.toContain('l2');

    rpcMock.mockImplementation((fn: unknown) =>
      Promise.resolve(fn === 'fire_counter_order_v4' ? FIRE_OK : PAY_OK),
    );
    await act(async () => {
      await result.current.mutateAsync({
        cart: useCartStore.getState().cart,
        payment: { method: 'cash', amount: 60_000 },
      });
    });

    // …with the SAME uuid (RPC flavor-2 idempotent replay, no duplicate).
    const fireCalls = rpcMock.mock.calls.filter((c) => c[0] === 'fire_counter_order_v4');
    expect(fireCalls).toHaveLength(2);
    const uuid1 = (fireCalls[0]![1] as Record<string, unknown>).p_client_uuid;
    const uuid2 = (fireCalls[1]![1] as Record<string, unknown>).p_client_uuid;
    expect(uuid2).toBe(uuid1);
  });

  it('retry after append SUCCESS + pay failure makes ZERO additional append calls (lines locked)', async () => {
    rpcMock.mockImplementation((fn: unknown) =>
      Promise.resolve(
        fn === 'fire_counter_order_v4' ? FIRE_OK : { data: null, error: { message: 'network' } },
      ),
    );

    const { useCheckout } = await import('../hooks/useCheckout');
    const { result } = renderHook(() => useCheckout(), { wrapper });

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          cart: useCartStore.getState().cart,
          payment: { method: 'cash', amount: 60_000 },
        }),
      ).rejects.toThrow('network');
    });

    // Append succeeded → l2 locked; the DB owns the line now.
    expect(useCartStore.getState().lockedItemIds).toContain('l2');

    rpcMock.mockImplementation((fn: unknown) =>
      Promise.resolve(fn === 'fire_counter_order_v4' ? FIRE_OK : PAY_OK),
    );
    await act(async () => {
      await result.current.mutateAsync({
        cart: useCartStore.getState().cart,
        payment: { method: 'cash', amount: 60_000 },
      });
    });

    // unsynced is now empty → no second fire call, just the pay.
    const fireCalls = rpcMock.mock.calls.filter((c) => c[0] === 'fire_counter_order_v4');
    expect(fireCalls).toHaveLength(1);
  });

  it('close/reopen (new idempotencyKey) after append success + pay failure: NO double append', async () => {
    // Regression: the close/reopen of the payment modal regenerates
    // paymentStore.idempotencyKey → a fresh append p_client_uuid. The uuid
    // replay alone can't prevent a duplicate — the LOCK on the appended
    // lines is what keeps them out of the unsynced set.
    rpcMock.mockImplementation((fn: unknown) =>
      Promise.resolve(
        fn === 'fire_counter_order_v4' ? FIRE_OK : { data: null, error: { message: 'network' } },
      ),
    );

    const { useCheckout } = await import('../hooks/useCheckout');
    const { result } = renderHook(() => useCheckout(), { wrapper });

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          cart: useCartStore.getState().cart,
          payment: { method: 'cash', amount: 60_000 },
        }),
      ).rejects.toThrow('network');
    });

    // Cashier closes then reopens the terminal → fresh attempt key.
    act(() => {
      usePaymentStore.setState({ idempotencyKey: 'attempt-2' });
    });

    rpcMock.mockImplementation((fn: unknown) =>
      Promise.resolve(fn === 'fire_counter_order_v4' ? FIRE_OK : PAY_OK),
    );
    await act(async () => {
      await result.current.mutateAsync({
        cart: useCartStore.getState().cart,
        payment: { method: 'cash', amount: 60_000 },
      });
    });

    const fireCalls = rpcMock.mock.calls.filter((c) => c[0] === 'fire_counter_order_v4');
    expect(fireCalls).toHaveLength(1); // first attempt only — l2 stayed locked
  });
});
