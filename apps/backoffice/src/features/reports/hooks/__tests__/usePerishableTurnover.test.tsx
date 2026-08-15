// apps/backoffice/src/features/reports/hooks/__tests__/usePerishableTurnover.test.tsx
//
// Lot J (campagne Reports 2026-08-15) — le hook du rapport Perishable Turnover.
//
// Ce que le fichier tient sous contrat :
//  · le nom de RPC et les bornes MÉTIER passées telles quelles (`p_date_start` /
//    `p_date_end`, aucune conversion de fuseau côté client) ;
//  · les deux champs NULLABLES restent `null` — un tiret, jamais un zéro : « 0
//    jour en stock » et « périme le jour même » sont deux affirmations fausses ;
//  · `waste_pct` est relu du serveur, pas recalculé ;
//  · une enveloppe amputée ne casse pas le rendu (parse défensif).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const mockRpc = vi.fn();

vi.mock('@/lib/supabase.js', () => ({
  supabase: { rpc: (fn: string, args: Record<string, unknown>) => mockRpc(fn, args) as unknown },
}));

import { usePerishableTurnover } from '../usePerishableTurnover.js';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const ENVELOPE = {
  period: { start: '2026-07-01', end: '2026-07-31' },
  by_product: [
    {
      product_id: 'p-1', product_name: 'Croissant',
      lots_count: 42, consumed_qty: 310, expired_qty: 18,
      current_active_qty: 24, waste_pct: 5.49,
      avg_days_in_stock: 1.75, shelf_life_days_p50: 3, velocity_score: 5,
    },
    {
      // Aucun lot consommé sur la fenêtre : les deux champs nullables le disent.
      product_id: 'p-2', product_name: 'Sourdough Loaf',
      lots_count: 6, consumed_qty: 0, expired_qty: 4,
      current_active_qty: 2, waste_pct: 100,
      avg_days_in_stock: null, shelf_life_days_p50: null, velocity_score: 1,
    },
  ],
};

beforeEach(() => {
  mockRpc.mockReset();
  mockRpc.mockResolvedValue({ data: ENVELOPE, error: null });
});

function render() {
  return renderHook(
    () => usePerishableTurnover({ start: '2026-07-01', end: '2026-07-31' }),
    { wrapper },
  );
}

describe('usePerishableTurnover', () => {
  it('appelle get_perishable_turnover_v1 avec les bornes metier', async () => {
    const { result } = render();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockRpc).toHaveBeenCalledWith('get_perishable_turnover_v1', {
      p_date_start: '2026-07-01',
      p_date_end:   '2026-07-31',
    });
  });

  it('expose la ventilation par produit dans l ordre serveur', async () => {
    const { result } = render();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.by_product).toHaveLength(2);
    expect(result.current.data?.by_product[0]).toMatchObject({
      product_name:        'Croissant',
      lots_count:          42,
      consumed_qty:        310,
      expired_qty:         18,
      current_active_qty:  24,
      avg_days_in_stock:   1.75,
      shelf_life_days_p50: 3,
      velocity_score:      5,
    });
  });

  it('relit waste_pct du serveur au lieu de le recalculer', async () => {
    const { result } = render();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // 18 / (310 + 18) = 5,4878… — le serveur arrondit à 5.49, le hook n'y touche pas.
    expect(result.current.data?.by_product[0]?.waste_pct).toBe(5.49);
  });

  it('garde null les jours de stock et la duree de vie inconnus', async () => {
    const { result } = render();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const row = result.current.data?.by_product[1];
    expect(row?.avg_days_in_stock).toBeNull();
    expect(row?.shelf_life_days_p50).toBeNull();
    // …et ce n'est pas un zero deguise.
    expect(row?.avg_days_in_stock).not.toBe(0);
  });

  it('ne casse pas sur une enveloppe amputee', async () => {
    mockRpc.mockResolvedValue({ data: {}, error: null });
    const { result } = render();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.by_product).toEqual([]);
    expect(result.current.data?.period).toEqual({ start: '2026-07-01', end: '2026-07-31' });
  });

  it('tolere une ligne sans aucun champ', async () => {
    mockRpc.mockResolvedValue({ data: { by_product: [{}] }, error: null });
    const { result } = render();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.by_product[0]).toMatchObject({
      product_id: '', product_name: '', lots_count: 0,
      consumed_qty: 0, expired_qty: 0, current_active_qty: 0,
      waste_pct: 0, avg_days_in_stock: null, shelf_life_days_p50: null,
    });
  });
});
