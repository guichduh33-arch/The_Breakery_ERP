// apps/backoffice/src/features/inventory-alerts/__tests__/low-stock-no-threshold.test.tsx
//
// S3-10 — l'onglet de stock bas doit dire ce qu'il ne sait pas : les produits
// suivis sans seuil n'y apparaîtront jamais. Le vrai crochet de comptage tourne
// contre un PostgREST simulé ; on vérifie aussi la portée de la requête.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LowStockTab } from '../components/LowStockTab.js';

const state = vi.hoisted(() => ({
  count: 0,
  calls: [] as [string, ...unknown[]][],
}));

vi.mock('@/lib/supabase.js', () => {
  function builder(table: string): Record<string, unknown> {
    state.calls.push(['from', table]);
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'is', 'lte']) {
      chain[m] = (...args: unknown[]) => {
        state.calls.push([m, ...args]);
        return chain;
      };
    }
    chain.then = (resolve: (v: { count: number; error: null }) => unknown) =>
      Promise.resolve({ count: state.count, error: null }).then(resolve);
    return chain;
  }
  return { supabase: { from: (t: string) => builder(t) } };
});

vi.mock('../hooks/useLowStock.js', () => ({
  useLowStock: () => ({ data: [], isLoading: false, error: null }),
}));

vi.mock('../components/ProductCell.js', () => ({
  ProductCell: () => null,
}));

function renderTab(): void {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <LowStockTab />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.calls = [];
});

describe('LowStockTab — products without a threshold (S3-10)', () => {
  it('announces how many tracked products have no threshold and stops claiming all is fine', async () => {
    state.count = 245;
    renderTab();
    const banner = await screen.findByTestId('low-stock-no-threshold');
    expect(banner).toHaveAttribute('role', 'status');
    expect(banner).toHaveTextContent('245 tracked products have no low-stock threshold');
    expect(banner).toHaveTextContent('can never appear in this list');
    expect(screen.queryByText('All above threshold')).not.toBeInTheDocument();
    expect(screen.getByText('Nothing below a set minimum')).toBeInTheDocument();

    // Portée : produits actifs, non supprimés, suivis, seuil ≤ 0 — comptage seul.
    expect(state.calls).toContainEqual(['from', 'products']);
    expect(state.calls).toContainEqual(['select', 'id', { count: 'exact', head: true }]);
    expect(state.calls).toContainEqual(['eq', 'track_inventory', true]);
    expect(state.calls).toContainEqual(['eq', 'is_active', true]);
    expect(state.calls).toContainEqual(['is', 'deleted_at', null]);
    expect(state.calls).toContainEqual(['lte', 'min_stock_threshold', 0]);
  });

  it('hides the banner and keeps the all-clear wording when every tracked product has a threshold', async () => {
    state.count = 0;
    renderTab();
    await waitFor(() => expect(screen.getByText('All above threshold')).toBeInTheDocument());
    expect(screen.queryByTestId('low-stock-no-threshold')).not.toBeInTheDocument();
  });
});
