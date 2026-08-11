// apps/pos/src/features/display/hooks/__tests__/useShowcaseProducts.test.ts
//
// ADR-023 déc. 1 et 2 — la vitrine résout sa sélection contre le catalogue.
// Ce test tient les deux preuves exigées par ADR-023 §2.5 côté lecture :
//   - un produit désactivé / invisible en caisse / retiré du catalogue sort de
//     la vitrine sans réédition de la sélection ;
//   - l'ordre affiché est celui de la SÉLECTION, pas celui de la base.
// Le prix, lui, n'est jamais stocké : le hook ne lit que `retail_price`.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

const eqMock = vi.fn();
const inMock = vi.fn();
const selectMock = vi.fn();
const fromMock = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => fromMock(...args) as unknown,
  },
}));

import { useShowcaseProducts } from '../useShowcaseProducts';

const CROISSANT = '11111111-1111-4111-8111-111111111111';
const ECLAIR = '22222222-2222-4222-8222-222222222222';
const RETIRE = '33333333-3333-4333-8333-333333333333';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client: qc }, children);
}

/** .select().in('id', ids).eq('is_active', true).eq('visible_on_pos', true) */
function armQuery(rows: unknown[]) {
  const terminal = Promise.resolve({ data: rows, error: null });
  eqMock.mockReturnValueOnce({ eq: eqMock }).mockReturnValueOnce(terminal);
  inMock.mockReturnValue({ eq: eqMock });
  selectMock.mockReturnValue({ in: inMock });
  fromMock.mockReturnValue({ select: selectMock });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useShowcaseProducts', () => {
  it('rend les produits DANS L’ORDRE de la sélection, pas celui de la base', async () => {
    armQuery([
      { id: ECLAIR, name: 'Éclair', image_url: null, retail_price: 38000 },
      { id: CROISSANT, name: 'Croissant', image_url: '/c.jpg', retail_price: 25000 },
    ]);

    const { result } = renderHook(() => useShowcaseProducts([CROISSANT, ECLAIR]), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fromMock).toHaveBeenCalledWith('products');
    expect(eqMock).toHaveBeenCalledWith('is_active', true);
    expect(eqMock).toHaveBeenCalledWith('visible_on_pos', true);
    expect(result.current.data?.map((p) => p.name)).toEqual(['Croissant', 'Éclair']);
    expect(result.current.data?.[0]?.retail_price).toBe(25000);
  });

  it('tait un produit que le catalogue ne rend plus (désactivé, invisible, supprimé)', async () => {
    // La requête filtre en base : la ligne du produit retiré ne revient pas.
    armQuery([{ id: CROISSANT, name: 'Croissant', image_url: null, retail_price: 25000 }]);

    const { result } = renderHook(
      () => useShowcaseProducts([CROISSANT, RETIRE]),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.map((p) => p.id)).toEqual([CROISSANT]);
  });

  it('ne va pas chercher le catalogue quand la sélection est vide', async () => {
    const { result } = renderHook(() => useShowcaseProducts([]), { wrapper });

    await waitFor(() => expect(result.current.fetchStatus).toBe('idle'));
    expect(fromMock).not.toHaveBeenCalled();
  });
});
