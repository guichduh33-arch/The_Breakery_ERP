// apps/pos/src/features/cart/__tests__/fire-offline-chaos.smoke.test.tsx
//
// Spec 006x lot 5 — chaos « coupure en plein fire » (§7.5). En mode OFFLINE :
//   • l'intention est écrite dans l'outbox durable AVANT le publish bus (§4.3) ;
//   • hub down en plein fire : publish() rend false, le fire ABOUTIT quand même
//     (l'intent est durable, le KOT part en direct — seul l'écran KDS est privé
//     du ticket jusqu'au retour du hub) ;
//   • un échec d'écriture outbox ne scelle RIEN — le fire reste re-tentable ;
//   • un re-fire sur la même commande locale devient un APPEND : nouvel intent
//     (sa propre clé d'idempotence RPC) pointant la même racine.

/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useCartStore } from '@/stores/cartStore';
import { useShiftStore } from '@/stores/shiftStore';
import { getPendingIntents, type OfflineFireIntent } from '@/features/lan/offlineOutbox';
import type * as OutboxModule from '@/features/lan/offlineOutbox';

// ── Hoisted mocks (stable refs — S39 lesson DEV-S39-B1-01) ───────────────────

const { rpcMock, printStationTicketMock, publishMock, outboxChaos } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  printStationTicketMock: vi.fn(),
  publishMock: vi.fn(),
  outboxChaos: { failEnqueue: false },
}));

vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: (...a: unknown[]): unknown => rpcMock(...a) },
  supabaseUrl: 'http://sb.test',
}));

vi.mock('@/services/print/printService', () => ({
  printStationTicket: (...a: unknown[]): unknown => printStationTicketMock(...a),
}));

// Mode OFFLINE forcé (internet down + hub censé être joignable).
vi.mock('@/features/lan/offlineMode', () => ({ isOfflineMode: () => true }));

// Hub DOWN en plein fire : publish() dégrade en false, ne jette jamais.
vi.mock('@/features/lan/hubBusClient', () => ({
  hubBus: { publish: (...a: unknown[]): boolean => publishMock(...a) as boolean },
}));

vi.mock('@/features/lan/localOrderNumber', () => ({ nextLocalOrderNumber: () => 'L-1' }));

// Outbox réelle (backend localStorage en jsdom), avec un point d'injection de
// panne sur enqueueIntent pour le scénario « écriture outbox échoue ».
vi.mock('@/features/lan/offlineOutbox', async (importOriginal) => {
  // Import de type top-level (érasé au runtime) — autorisé dans la factory.
  const actual = await importOriginal<typeof OutboxModule>();
  return {
    ...actual,
    enqueueIntent: (intent: never): Promise<void> =>
      outboxChaos.failEnqueue
        ? Promise.reject(new Error('outbox_write_failed'))
        : actual.enqueueIntent(intent),
  };
});

const PRINTERS_MAP = new Map([
  ['barista', { ip_address: '192.168.1.11', port: 9100, name: 'Barista' }],
]);

vi.mock('@/features/cart/hooks/useStationPrinters', () => ({
  useStationPrinters: () => ({ data: PRINTERS_MAP }),
}));

const PRODUCTS = [{ id: 'p-barista', name: 'Latte', dispatch_station: 'barista' }];

vi.mock('@/features/products/hooks/useProducts', () => ({
  useProducts: () => ({ data: PRODUCTS }),
}));

vi.mock('@/features/cart/hooks/useStationMap', () => {
  const STATION_MAP: Record<string, string[]> = { 'p-barista': ['barista'] };
  return {
    useStationMap: () => ({ data: STATION_MAP }),
    getStationMap: () => Promise.resolve(STATION_MAP),
  };
});

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
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function seedCart(): void {
  useCartStore.setState({
    cart: {
      items: [
        { id: 'l1', product_id: 'p-barista', name: 'Latte', unit_price: 30_000, quantity: 1, modifiers: [] },
      ],
      order_type: 'take_out',
    },
    printedItemIds: [],
    lockedItemIds: [],
    attachedCustomer: null,
    pickedUpOrderId: null,
    offlineOrder: null,
    appliedPromotions: [],
    dismissedPromotionIds: new Set<string>(),
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('offline fire chaos (spec 006x lot 5)', () => {
  beforeEach(() => {
    localStorage.clear();
    rpcMock.mockReset();
    printStationTicketMock.mockReset();
    publishMock.mockReset();
    outboxChaos.failEnqueue = false;
    publishMock.mockReturnValue(false); // hub DOWN par défaut dans ce fichier
    printStationTicketMock.mockResolvedValue({ success: true });
    useShiftStore.setState({ current: { id: 'sess-1', opened_at: '', opening_cash: 0 } });
    seedCart();
  });

  it('hub down mid-fire: intent durable, no RPC, items sealed, KOT still prints direct', async () => {
    const { useFireToStations } = await import('../hooks/useFireToStations');
    const { result } = renderHook(() => useFireToStations(), { wrapper });

    await act(async () => {
      await result.current.mutation.mutateAsync(undefined);
    });

    // Aucune écriture cloud en mode offline.
    expect(rpcMock).not.toHaveBeenCalled();

    // L'intent est DURABLE malgré le publish false (write-first §4.3).
    const pending = await getPendingIntents();
    expect(pending).toHaveLength(1);
    const intent = pending[0] as OfflineFireIntent;
    expect(intent.kind).toBe('fire');
    expect(intent.root_client_uuid).toBe(intent.id); // 1ᵉʳ fire = racine
    expect(intent.local_number).toBe('L-1');
    expect(intent.session_id).toBe('sess-1');
    expect(intent.items).toEqual([
      { product_id: 'p-barista', quantity: 1, unit_price: 30_000, modifiers: [] },
    ]);

    // Publish tenté (best effort) puis ignoré — pas d'exception.
    expect(publishMock).toHaveBeenCalledWith('order.fired', expect.objectContaining({
      client_uuid: intent.root_client_uuid,
      order_number: 'L-1',
    }));

    // La commande locale est raccordée au cart et les lignes scellées.
    expect(useCartStore.getState().offlineOrder).toEqual({ clientUuid: intent.root_client_uuid, localNumber: 'L-1' });
    expect(useCartStore.getState().printedItemIds).toEqual(['l1']);
    expect(useCartStore.getState().lockedItemIds).toEqual(['l1']);

    // Le KOT papier part en direct (bridge local, indépendant du hub).
    expect(printStationTicketMock).toHaveBeenCalledTimes(1);
  });

  it('re-fire on the same local order becomes an APPEND intent (own key, same root)', async () => {
    const { useFireToStations } = await import('../hooks/useFireToStations');
    const { result } = renderHook(() => useFireToStations(), { wrapper });

    await act(async () => {
      await result.current.mutation.mutateAsync(undefined);
    });
    // Nouvelle ligne ajoutée pendant la coupure, sur la même commande locale.
    useCartStore.setState((s) => ({
      cart: {
        ...s.cart,
        items: [...s.cart.items,
          { id: 'l2', product_id: 'p-barista', name: 'Latte', unit_price: 30_000, quantity: 2, modifiers: [] }],
      },
    }));
    await act(async () => {
      await result.current.mutation.mutateAsync(undefined);
    });

    const pending = (await getPendingIntents()) as OfflineFireIntent[];
    expect(pending).toHaveLength(2);
    const [root, append] = pending;
    expect(append!.root_client_uuid).toBe(root!.root_client_uuid); // même commande
    expect(append!.id).not.toBe(root!.id); // sa propre clé d'idempotence RPC
    expect(append!.local_number).toBe('L-1');
    expect(useCartStore.getState().offlineOrder?.clientUuid).toBe(root!.root_client_uuid);
  });

  it('outbox write failure: nothing is sealed, the fire stays retryable', async () => {
    outboxChaos.failEnqueue = true;

    const { useFireToStations } = await import('../hooks/useFireToStations');
    const { result } = renderHook(() => useFireToStations(), { wrapper });

    await act(async () => {
      await expect(result.current.mutation.mutateAsync(undefined)).rejects.toThrow('outbox_write_failed');
    });

    // Rien de scellé, rien de publié, rien en file — le fire est re-tentable.
    expect(useCartStore.getState().printedItemIds).toEqual([]);
    expect(useCartStore.getState().lockedItemIds).toEqual([]);
    expect(useCartStore.getState().offlineOrder).toBeNull();
    expect(publishMock).not.toHaveBeenCalled();
    expect(await getPendingIntents()).toEqual([]);

    // Retry après retour du disque : le fire aboutit.
    outboxChaos.failEnqueue = false;
    await act(async () => {
      await result.current.mutation.mutateAsync(undefined);
    });
    expect(await getPendingIntents()).toHaveLength(1);
    expect(useCartStore.getState().printedItemIds).toEqual(['l1']);
  });
});
