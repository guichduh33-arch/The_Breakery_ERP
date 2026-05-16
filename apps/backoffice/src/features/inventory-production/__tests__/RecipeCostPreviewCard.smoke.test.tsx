// apps/backoffice/src/features/inventory-production/__tests__/RecipeCostPreviewCard.smoke.test.tsx
// Session 15 — Phase 3.B — RecipeCostPreviewCard render + threshold paths.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { RecipeRow } from '@breakery/domain';
import { RecipeCostPreviewCard } from '../components/RecipeCostPreviewCard.js';

// ── Mock supabase ─────────────────────────────────────────────────────────────
// useProductSummary issues a single `.from('products').select(...).eq('id', id).maybeSingle()`.
// We tag the chain with the id we asked for so each test can route to a different fixture.

const PRODUCT_FIXTURES: Record<string, {
  id: string; sku: string; name: string; unit: string;
  image_url: string | null; retail_price: number | null; cost_price: number;
}> = {
  'bag-1': {
    id: 'bag-1', sku: 'BAG-1', name: 'Test Baguette', unit: 'pcs',
    image_url: 'https://example.com/baguette.jpg',
    retail_price: 10_000, cost_price: 2_500,
  },
  'low-margin': {
    id: 'low-margin', sku: 'LM-1', name: 'Low Margin Item', unit: 'pcs',
    image_url: null,
    retail_price: 5_000, cost_price: 4_000,
  },
  'drift-product': {
    id: 'drift-product', sku: 'DR-1', name: 'Drifted Cost', unit: 'pcs',
    image_url: null,
    retail_price: 10_000, cost_price: 1_000, // stored cost very different from BoM
  },
};

vi.mock('@/lib/supabase.js', () => {
  function buildChain(table: string) {
    let askedId: string | null = null;
    const chain: {
      select: () => typeof chain;
      eq:     (col: string, val: string) => typeof chain;
      maybeSingle: () => Promise<{ data: unknown; error: null }>;
    } = {
      select: () => chain,
      eq:     (_col, val) => { askedId = val; return chain; },
      maybeSingle: () => {
        if (table !== 'products') return Promise.resolve({ data: null, error: null });
        return Promise.resolve({
          data: askedId !== null ? (PRODUCT_FIXTURES[askedId] ?? null) : null,
          error: null,
        });
      },
    };
    return chain;
  }
  return {
    supabase: {
      from: (t: string) => buildChain(t),
    },
  };
});

function makeRow(materialCost: number, qty: number): RecipeRow {
  return {
    recipe_id: 'r-' + materialCost + '-' + qty,
    product_id: 'whatever',
    product_name: 'whatever',
    product_unit: 'pcs',
    material_id: 'm-' + materialCost,
    material_name: 'mat',
    material_unit: 'kg',
    material_cost_price: materialCost,
    quantity: qty,
    unit: 'kg',
    is_active: true,
    notes: null,
  };
}

function renderCard(productId: string | null, rows: RecipeRow[]) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <RecipeCostPreviewCard productId={productId} rows={rows} />
    </QueryClientProvider>,
  );
}

describe('RecipeCostPreviewCard smoke', () => {
  it('renders an idle hint when productId is null', () => {
    renderCard(null, []);
    expect(screen.getByText(/Select a finished product/i)).toBeInTheDocument();
  });

  it('renders sku, name, selling price, and material cost (per 1 unit)', async () => {
    // Row : 0.25 kg flour @ 10000/kg → 2500 / unit
    renderCard('bag-1', [makeRow(10_000, 0.25)]);
    await waitFor(() => {
      expect(screen.getByText('Test Baguette')).toBeInTheDocument();
    });
    expect(screen.getByText(/BAG-1/)).toBeInTheDocument();
    // Currency formatting is locale-dependent — assert digit substring.
    expect(screen.getByTestId('selling-price').textContent).toMatch(/10[\., ]?000/);
    expect(screen.getByTestId('material-cost').textContent).toMatch(/2[\., ]?500/);
  });

  it('shows a green margin badge when margin ≥ 60', async () => {
    // 10_000 retail - 2_500 BoM ⇒ 75%
    renderCard('bag-1', [makeRow(10_000, 0.25)]);
    await waitFor(() => {
      expect(screen.getByTestId('margin-pct')).toHaveAttribute('data-tone', 'green');
    });
    expect(screen.getByTestId('margin-pct').textContent).toMatch(/75\.0%/);
  });

  it('shows a red margin badge when margin < 40', async () => {
    // 5_000 retail - 4_000 BoM ⇒ 20% (red)
    renderCard('low-margin', [makeRow(4_000, 1)]);
    await waitFor(() => {
      expect(screen.getByTestId('margin-pct')).toHaveAttribute('data-tone', 'red');
    });
  });

  it('shows the Recompute badge when stored cost drifts > 5% from BoM', async () => {
    // BoM ≈ 6000, stored cost_price = 1000 ⇒ drift = 500% > 5%
    renderCard('drift-product', [makeRow(6_000, 1)]);
    await waitFor(() => {
      expect(screen.getByTestId('recompute-badge')).toBeInTheDocument();
    });
  });

  it('does NOT show the Recompute badge when stored cost is within 5%', async () => {
    // BoM = 2_500, stored cost_price = 2_500 → drift 0%
    renderCard('bag-1', [makeRow(10_000, 0.25)]);
    await waitFor(() => {
      expect(screen.getByText('Test Baguette')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('recompute-badge')).toBeNull();
  });
});
