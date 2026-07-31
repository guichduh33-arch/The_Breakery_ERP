// apps/pos/src/features/inbox/__tests__/pendingTabletOrders.total.test.ts
//
// Le montant affiché au caissier dans l'inbox était recalculé côté client en
// `unit_price × quantité` — il IGNORAIT les modificateurs, que le serveur
// inclut pourtant dans `line_total`. Une commande avec suppléments s'annonçait
// moins chère qu'elle ne l'est. On somme désormais la valeur serveur, et on
// exclut les lignes annulées : ce qui reste dû, pas ce qui fut commandé.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const rows = vi.hoisted(() => ({ current: [] as unknown[] }));
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            order: () => Promise.resolve({ data: rows.current, error: null }),
          }),
        }),
      }),
    }),
    channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }),
    removeChannel: vi.fn(),
  },
}));

import { usePendingTabletOrders } from '../hooks/usePendingTabletOrders';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function seed(items: { id: string; line_total: number; is_cancelled: boolean }[]): void {
  rows.current = [
    {
      id: 'o1', order_number: '#0007', table_number: '7', order_type: 'dine_in',
      waiter_id: 'w1', sent_to_kitchen_at: '2026-08-01T10:00:00Z', notes: null,
      order_items: items, user_profiles: { full_name: 'Made' },
    },
  ];
}

beforeEach(() => { rows.current = []; });

describe('usePendingTabletOrders — montant annoncé au caissier', () => {
  it('somme line_total (modificateurs inclus), pas unit_price × quantité', async () => {
    // 2 × (20000 + 5000 de supplément) = 50000 côté serveur. L'ancien calcul
    // annonçait 40000 et le caissier encaissait en dessous.
    seed([{ id: 'i1', line_total: 50_000, is_cancelled: false }]);

    const { result } = renderHook(() => usePendingTabletOrders(), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(result.current.data![0]!.items_total).toBe(50_000);
  });

  it('exclut les lignes annulées du montant et du compte actif', async () => {
    seed([
      { id: 'i1', line_total: 50_000, is_cancelled: false },
      { id: 'i2', line_total: 30_000, is_cancelled: true },
    ]);

    const { result } = renderHook(() => usePendingTabletOrders(), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());

    const entry = result.current.data![0]!;
    expect(entry.items_total).toBe(50_000);
    expect(entry.active_items_count).toBe(1);
    expect(entry.items_count).toBe(2);
  });

  it('une commande entièrement annulée ne doit plus rien', async () => {
    seed([
      { id: 'i1', line_total: 50_000, is_cancelled: true },
      { id: 'i2', line_total: 30_000, is_cancelled: true },
    ]);

    const { result } = renderHook(() => usePendingTabletOrders(), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());

    const entry = result.current.data![0]!;
    expect(entry.items_total).toBe(0);
    expect(entry.active_items_count).toBe(0);
  });
});
