// apps/pos/src/features/cart/__tests__/fire-persists-order.smoke.test.tsx
//
// Session 43 / Wave C — P0-3 : le fire comptoir doit persister AVANT d'imprimer
// (fire_counter_order_v4), et marquer les items locked+printed même si
// l'imprimante échoue — la DB est la source de vérité ; un échec d'impression
// ne doit plus laisser les items « non envoyés » (sinon re-fire = doublon DB).
//
// Couvre aussi :
//   • items station 'none' → envoyés au RPC (complétude DB) mais pas imprimés.
//   • mode append : pickedUpOrderId existant → p_order_id transmis, pas écrasé.
//   • idempotence retry : échec RPC → rien n'est marqué ; le retry rejoue le
//     MÊME p_client_uuid ; un fire suivant (après succès) en génère un nouveau.

/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useCartStore } from '@/stores/cartStore';
import { useShiftStore } from '@/stores/shiftStore';

// ── Hoisted mocks (stable refs — S39 lesson DEV-S39-B1-01) ───────────────────

const { rpcMock, printStationTicketMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  printStationTicketMock: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: (...a: unknown[]) => rpcMock(...a) },
  supabaseUrl: 'http://sb.test',
}));

vi.mock('@/services/print/printService', () => ({
  printStationTicket: (...a: unknown[]) => printStationTicketMock(...a),
}));

const PRINTERS_MAP = new Map([
  ['barista', { ip_address: '192.168.1.11', port: 9100, name: 'Barista' }],
]);

vi.mock('@/features/cart/hooks/useStationPrinters', () => ({
  useStationPrinters: () => ({ data: PRINTERS_MAP }),
}));

// p-none has no dispatch_station → station 'none' (prints nowhere, but MUST
// reach the RPC so the DB order is complete for payment).
const PRODUCTS = [
  { id: 'p-barista', name: 'Latte', dispatch_station: 'barista' },
  { id: 'p-none', name: 'Croissant', dispatch_station: 'none' },
];

vi.mock('@/features/products/hooks/useProducts', () => ({
  useProducts: () => ({ data: PRODUCTS }),
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: Object.assign(
    (sel: (s: { user: { full_name: string } }) => unknown) =>
      sel({ user: { full_name: 'Tester' } }),
    { getState: () => ({ user: { full_name: 'Tester' } }) },
  ),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  qc.setQueryData(['products'], PRODUCTS);
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function seedCart(opts: { pickedUpOrderId?: string | null } = {}) {
  useCartStore.setState({
    cart: {
      items: [
        { id: 'l1', product_id: 'p-barista', name: 'Latte', unit_price: 30_000, quantity: 1, modifiers: [] },
        {
          id: 'l2',
          product_id: 'p-none',
          name: 'Croissant',
          unit_price: 15_000,
          quantity: 2,
          modifiers: [],
          discount: { type: 'fixed_amount', value: 1_000, amount: 1_000, reason: 'day-old' },
        },
      ],
      order_type: 'take_out',
      tableNumber: 'T5',
    },
    printedItemIds: [],
    lockedItemIds: [],
    attachedCustomer: null,
    pickedUpOrderId: opts.pickedUpOrderId ?? null,
    appliedPromotions: [],
    dismissedPromotionIds: new Set<string>(),
    isOffline: false,
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

vi.mock('@/features/cart/hooks/useStationMap', () => {
  // S44 P0-B — useFireToStations now reads the station map (variant-aware) for
  // firableCount (render) and routing (getStationMap, fire path). Mock both so
  // the test never hits supabase.from.
  const STATION_MAP: Record<string, string> = { 'p-barista': 'barista', 'p-kitchen': 'kitchen', 'p-none': 'none' };
  return {
    useStationMap: () => ({ data: STATION_MAP }),
    getStationMap: () => Promise.resolve(STATION_MAP),
  };
});

describe('useFireToStations persists before printing (P0-3)', () => {
  beforeEach(() => {
    rpcMock.mockReset();
    printStationTicketMock.mockReset();
    rpcMock.mockResolvedValue({
      data: { order_id: 'order-db-1', order_number: '#0042', idempotent_replay: false },
      error: null,
    });
    // Printer unreachable — items must STILL end up locked+printed.
    printStationTicketMock.mockResolvedValue({ success: false, error: 'unreachable' });
    useShiftStore.setState({ current: { id: 'sess-1', opened_at: '', opening_cash: 0 } });
    seedCart();
  });

  it('calls fire_counter_order_v4 with ALL unprinted items, sets pickedUpOrderId, marks items even when print fails', async () => {
    const { useFireToStations } = await import('../hooks/useFireToStations');
    const { result } = renderHook(() => useFireToStations(), { wrapper });

    await act(async () => {
      await result.current.mutation.mutateAsync({ tableNumber: 'T5' });
    });

    expect(rpcMock).toHaveBeenCalledTimes(1);
    const [fnName, args] = rpcMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(fnName).toBe('fire_counter_order_v4');
    expect(args.p_session_id).toBe('sess-1');
    expect(args.p_order_id).toBeUndefined(); // create mode
    expect(args.p_table_number).toBe('T5');
    expect(args.p_order_type).toBe('take_out');
    expect(typeof args.p_client_uuid).toBe('string');
    // Both items go to the RPC — including the 'none'-station croissant.
    expect(args.p_items).toEqual([
      { product_id: 'p-barista', quantity: 1, unit_price: 30_000, modifiers: [] },
      { product_id: 'p-none', quantity: 2, unit_price: 15_000, modifiers: [], discount_amount: 1_000 },
    ]);

    // Persistence is the source of truth.
    expect(useCartStore.getState().pickedUpOrderId).toBe('order-db-1');
    expect(useCartStore.getState().printedItemIds).toEqual(expect.arrayContaining(['l1', 'l2']));
    expect(useCartStore.getState().lockedItemIds).toEqual(expect.arrayContaining(['l1', 'l2']));

    // Printing was still attempted for the barista station (best effort).
    expect(printStationTicketMock).toHaveBeenCalledTimes(1);
  });

  it('append mode: passes p_order_id when pickedUpOrderId is already set and does not overwrite it', async () => {
    seedCart({ pickedUpOrderId: 'order-db-1' });
    rpcMock.mockResolvedValue({
      data: { order_id: 'order-db-1', order_number: '#0042', idempotent_replay: false },
      error: null,
    });

    const { useFireToStations } = await import('../hooks/useFireToStations');
    const { result } = renderHook(() => useFireToStations(), { wrapper });

    await act(async () => {
      await result.current.mutation.mutateAsync(undefined);
    });

    const args = rpcMock.mock.calls[0]![1] as Record<string, unknown>;
    expect(args.p_order_id).toBe('order-db-1');
    expect(useCartStore.getState().pickedUpOrderId).toBe('order-db-1');
  });

  it('RPC failure: nothing is marked, retry replays the SAME client uuid, success resets it', async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });

    const { useFireToStations } = await import('../hooks/useFireToStations');
    const { result } = renderHook(() => useFireToStations(), { wrapper });

    await act(async () => {
      await expect(result.current.mutation.mutateAsync(undefined)).rejects.toThrow('boom');
    });

    // Nothing sealed locally — the order was NOT persisted.
    expect(useCartStore.getState().printedItemIds).toEqual([]);
    expect(useCartStore.getState().lockedItemIds).toEqual([]);
    expect(useCartStore.getState().pickedUpOrderId).toBeNull();

    // Retry (RPC now succeeds) → same p_client_uuid as the failed attempt.
    await act(async () => {
      await result.current.mutation.mutateAsync(undefined);
    });
    await waitFor(() => expect(rpcMock).toHaveBeenCalledTimes(2));
    const uuid1 = (rpcMock.mock.calls[0]![1] as Record<string, unknown>).p_client_uuid;
    const uuid2 = (rpcMock.mock.calls[1]![1] as Record<string, unknown>).p_client_uuid;
    expect(uuid2).toBe(uuid1);

    // Next fire (new batch) → NEW uuid.
    useCartStore.setState({
      cart: {
        items: [{ id: 'l3', product_id: 'p-barista', name: 'Latte', unit_price: 30_000, quantity: 1, modifiers: [] }],
        order_type: 'take_out',
      },
      printedItemIds: [],
      lockedItemIds: [],
    });
    await act(async () => {
      await result.current.mutation.mutateAsync(undefined);
    });
    const uuid3 = (rpcMock.mock.calls[2]![1] as Record<string, unknown>).p_client_uuid;
    expect(uuid3).not.toBe(uuid1);
  });

  it('locked-but-unprinted lines (checkout append) are excluded from the RPC payload', async () => {
    // l2 was appended to the DB order by a failed checkout attempt (useCheckout
    // markLocked's it on append success) — a manual fire must NOT re-send it
    // (duplicate DB line), but must still seal + print everything unprinted.
    seedCart({ pickedUpOrderId: 'order-db-1' });
    useCartStore.setState({ lockedItemIds: ['l2'] });

    const { useFireToStations } = await import('../hooks/useFireToStations');
    const { result } = renderHook(() => useFireToStations(), { wrapper });

    await act(async () => {
      await result.current.mutation.mutateAsync(undefined);
    });

    expect(rpcMock).toHaveBeenCalledTimes(1);
    const args = rpcMock.mock.calls[0]![1] as Record<string, unknown>;
    expect(args.p_items).toEqual([
      { product_id: 'p-barista', quantity: 1, unit_price: 30_000, modifiers: [] },
    ]);

    // Both lines still end up sealed + the barista ticket printed.
    expect(useCartStore.getState().printedItemIds).toEqual(expect.arrayContaining(['l1', 'l2']));
    expect(printStationTicketMock).toHaveBeenCalledTimes(1);
  });

  it('every unprinted line already locked (e.g. pickup cart) → RPC skipped, print still happens', async () => {
    // Pre-follow-up this fired an append against the server order — a
    // guaranteed P0002 on a tablet pickup (created_via != 'pos').
    seedCart({ pickedUpOrderId: 'order-db-1' });
    useCartStore.setState({ lockedItemIds: ['l1', 'l2'] });
    printStationTicketMock.mockResolvedValue({ success: true });

    const { useFireToStations } = await import('../hooks/useFireToStations');
    const { result } = renderHook(() => useFireToStations(), { wrapper });

    await act(async () => {
      await result.current.mutation.mutateAsync(undefined);
    });

    expect(rpcMock).not.toHaveBeenCalled();
    expect(printStationTicketMock).toHaveBeenCalledTimes(1);
    expect(useCartStore.getState().printedItemIds).toEqual(expect.arrayContaining(['l1', 'l2']));
  });

  it('printOnly (post-payment auto-fire): RPC is NOT called, items still seal and print', async () => {
    // Post-payment, the order already exists in DB (created by v11 / paid via
    // pay_existing_order_v9) — persisting here would mint an orphan order
    // (direct pay) or append against a PAID order (pickup) → P0002.
    printStationTicketMock.mockResolvedValue({ success: true });

    const { useFireToStations } = await import('../hooks/useFireToStations');
    const { result } = renderHook(() => useFireToStations(), { wrapper });

    await act(async () => {
      await result.current.mutation.mutateAsync({ orderNumber: 'ORD-7', printOnly: true });
    });

    // No persist, no pickedUpOrderId capture.
    expect(rpcMock).not.toHaveBeenCalled();
    expect(useCartStore.getState().pickedUpOrderId).toBeNull();

    // Items are still sealed (legacy post-payment behaviour) …
    expect(useCartStore.getState().printedItemIds).toEqual(expect.arrayContaining(['l1', 'l2']));
    expect(useCartStore.getState().lockedItemIds).toEqual(expect.arrayContaining(['l1', 'l2']));

    // … and the barista ticket printed with the caller-supplied order number.
    expect(printStationTicketMock).toHaveBeenCalledTimes(1);
    const payload = printStationTicketMock.mock.calls[0]![1] as { order_number: string };
    expect(payload.order_number).toBe('ORD-7');
  });

  it('throws no_open_shift when there is no open session', async () => {
    useShiftStore.setState({ current: null });

    const { useFireToStations } = await import('../hooks/useFireToStations');
    const { result } = renderHook(() => useFireToStations(), { wrapper });

    await act(async () => {
      await expect(result.current.mutation.mutateAsync(undefined)).rejects.toThrow('no_open_shift');
    });
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
