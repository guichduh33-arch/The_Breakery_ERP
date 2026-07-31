// apps/pos/src/features/tablet/__tests__/tablet-ready-toast.test.tsx
//
// La boucle de retour cuisine → salle était cassée sur deux plans :
//   1. le toast lisait `item.name`, qui n'existe pas (la colonne est
//      `name_snapshot`) — il annonçait donc TOUJOURS « Item ready: item » ;
//   2. le filtre realtime ne portait que sur `kitchen_status`, sans aucun tri
//      par serveur : chaque tablette recevait un toast pour CHAQUE item prêt du
//      restaurant, comptoir compris.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastMock, Toaster: () => null }));

/** Capture le callback passé à `.on()` pour rejouer un event realtime. */
const handlers = vi.hoisted(() => ({ current: null as ((p: unknown) => void) | null }));
vi.mock('@/lib/supabase', () => ({
  supabase: {
    channel: () => ({
      on: (_evt: string, _cfg: unknown, cb: (p: unknown) => void) => {
        handlers.current = cb;
        return { subscribe: () => ({}) };
      },
      subscribe: () => ({}),
    }),
    removeChannel: vi.fn(),
  },
}));
vi.mock('@/lib/useReconnectInvalidate', () => ({ useReconnectInvalidate: () => undefined }));

import { useTabletOrderStatusListener } from '../hooks/useTabletOrderStatusListener';
import { useAuthStore } from '@/stores/authStore';

const WAITER = 'waiter-001';
let qc: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function emitReady(over: Record<string, unknown> = {}): void {
  handlers.current?.({
    new: {
      id: 'item-1',
      order_id: 'order-mine',
      name_snapshot: 'Cappuccino',
      kitchen_status: 'ready',
      ...over,
    },
  });
}

beforeEach(() => {
  toastMock.success.mockClear();
  handlers.current = null;
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  useAuthStore.setState({ user: { id: WAITER, full_name: 'Made', role_code: 'waiter', employee_code: 'E1' } });
  // Les commandes de CETTE tablette, telles que useMyTabletOrders les cache.
  qc.setQueryData(['tablet-orders', WAITER], [{ id: 'order-mine' }]);
});

describe('toast « item prêt » sur la tablette', () => {
  it('nomme le produit (name_snapshot, pas name)', () => {
    renderHook(() => useTabletOrderStatusListener(), { wrapper });
    emitReady();

    expect(toastMock.success).toHaveBeenCalledWith('Item ready: Cappuccino');
    // Le symptôme historique : un toast qui ne dit pas QUOI est prêt.
    expect(toastMock.success).not.toHaveBeenCalledWith('Item ready: item');
  });

  it("ignore un item d'une commande qui n'est pas la sienne", () => {
    renderHook(() => useTabletOrderStatusListener(), { wrapper });
    emitReady({ order_id: 'order-du-comptoir', id: 'item-9' });

    expect(toastMock.success).not.toHaveBeenCalled();
  });

  it('ne notifie qu’une fois par item, même si l’event est rejoué', () => {
    renderHook(() => useTabletOrderStatusListener(), { wrapper });
    emitReady();
    emitReady();

    expect(toastMock.success).toHaveBeenCalledTimes(1);
  });
});
