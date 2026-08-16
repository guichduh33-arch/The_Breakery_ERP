// apps/pos/src/features/tablet/__tests__/tablet-dine-in-guard.smoke.test.tsx
//
// ADR-018 D7 — on ne met JAMAIS en file ce qu'un garde serveur refusera.
// `create_tablet_order` exige une table pour un dine-in (P0011). Le garde est
// porté par le HOOK, pas par un composant, pour couvrir les deux chemins
// d'envoi et surtout les deux modes : hors ligne, l'intent serait accepté par
// la file, le ticket partirait en cuisine par le bus, puis le rejeu le
// refuserait à chaque tentative — bloquant derrière lui des encaissements
// déjà perçus. C'est exactement la pilule empoisonnée que l'ADR-018 traite.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const rpcMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: rpcMock } }));

const isOfflineModeMock = vi.hoisted(() => vi.fn(() => false));
vi.mock('@/features/lan/offlineMode', () => ({ isOfflineMode: isOfflineModeMock }));

const enqueueIntentMock = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock('@/features/lan/offlineOutbox', () => ({
  enqueueIntent: enqueueIntentMock,
  nextIntentSeq: () => 1,
}));

const publishMock = vi.hoisted(() => vi.fn());
vi.mock('@/features/lan/hubBusClient', () => ({ hubBus: { publish: publishMock } }));
vi.mock('@/features/lan/localOrderNumber', () => ({ nextLocalOrderNumber: () => 'L-1' }));
vi.mock('@/features/cart/hooks/useStationMap', () => ({
  getStationMap: () => Promise.resolve({}),
}));

import { useCreateTabletOrder } from '../hooks/useCreateTabletOrder';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const DINE_IN_NO_TABLE = {
  cart: {
    items: [{ id: 'i1', product_id: 'p1', name: 'Croissant', unit_price: 20000, quantity: 2, modifiers: [] }],
    tableNumber: null,
    orderType: 'dine_in' as const,
    notes: null,
  },
  waiterId: 'w-1',
  clientUuid: 'uuid-1',
};

beforeEach(() => {
  rpcMock.mockReset().mockResolvedValue({ data: 'order-1', error: null });
  enqueueIntentMock.mockClear();
  publishMock.mockClear();
  isOfflineModeMock.mockReturnValue(false);
});

describe('garde dine-in avant enfilement (ADR-018 D7)', () => {
  it('EN LIGNE : refuse un dine-in sans table sans appeler la RPC', async () => {
    const { result } = renderHook(() => useCreateTabletOrder(), { wrapper });

    await act(async () => {
      await expect(result.current.mutateAsync(DINE_IN_NO_TABLE)).rejects.toThrow(
        'table_required_for_dine_in',
      );
    });

    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("HORS LIGNE : n'empile RIEN et ne tire pas le ticket en cuisine", async () => {
    isOfflineModeMock.mockReturnValue(true);
    const { result } = renderHook(() => useCreateTabletOrder(), { wrapper });

    await act(async () => {
      await expect(result.current.mutateAsync(DINE_IN_NO_TABLE)).rejects.toThrow(
        'table_required_for_dine_in',
      );
    });

    // Le point critique : pas d'intent en file (donc pas de drain bloqué au
    // retour du réseau) ET pas de ticket cuisine pour un plat qui ne serait
    // jamais rattaché à une commande cloud.
    expect(enqueueIntentMock).not.toHaveBeenCalled();
    expect(publishMock).not.toHaveBeenCalled();
  });

  it('laisse passer un take-out sans table (la règle ne vise que le dine-in)', async () => {
    const { result } = renderHook(() => useCreateTabletOrder(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        ...DINE_IN_NO_TABLE,
        cart: { ...DINE_IN_NO_TABLE.cart, orderType: 'take_out' as const },
      });
    });

    expect(rpcMock).toHaveBeenCalledWith('create_tablet_order_v7', expect.objectContaining({
      p_order_type: 'take_out',
    }));
  });

  it('laisse passer un dine-in AVEC table', async () => {
    const { result } = renderHook(() => useCreateTabletOrder(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        ...DINE_IN_NO_TABLE,
        cart: { ...DINE_IN_NO_TABLE.cart, tableNumber: '7' },
      });
    });

    expect(rpcMock).toHaveBeenCalledWith('create_tablet_order_v7', expect.objectContaining({
      p_table_number: '7',
    }));
  });
});
