import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RecipeDetailPage } from '../RecipeDetailPage.js';

// Le hook est remplacé par un état mutable : chaque test pose la forme exacte
// que `useRecipeDetail` renverrait (chargement, erreur, absence, données).
interface HookState {
  isLoading: boolean;
  error: unknown;
  data: unknown;
}
const hookState: { current: HookState } = {
  current: { isLoading: false, error: null, data: null },
};

vi.mock('@/features/recipes/hooks/useRecipeDetail.js', () => ({
  useRecipeDetail: () => hookState.current,
}));

function bomRow(over: Record<string, unknown>) {
  return {
    material_id: 'm-x',
    material_name: 'Material',
    material_unit: 'g',
    qty_per_unit: 1,
    current_stock: 0,
    cost_price: 0,
    qty_in_base: 1,
    line_cost: 0,
    ...over,
  };
}

/** Recette à 8 000 : 6 000 de farine (75 %) + 2 000 de beurre (25 %). */
function loadedDetail(over: Record<string, unknown> = {}) {
  return {
    isLoading: false,
    error: null,
    data: {
      product: {
        id: 'p-1',
        name: 'Pain au chocolat',
        sku: 'PAC-001',
        unit: 'pcs',
        cost_price: 4500,
        is_semi_finished: false,
      },
      active_version_number: 3,
      version_count: 5,
      bom: [
        bomRow({
          material_id: 'm-1', material_name: 'Flour', material_unit: 'g',
          qty_per_unit: 500, current_stock: 25_000, cost_price: 5, line_cost: 6000,
        }),
        bomRow({
          material_id: 'm-2', material_name: 'Butter', material_unit: 'g',
          qty_per_unit: 150, current_stock: 8_000, cost_price: 30, line_cost: 2000,
        }),
      ],
      total_cost: 8000,
      ...over,
    },
  };
}

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/backoffice/inventory/recipes/:productId" element={<RecipeDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('RecipeDetailPage', () => {
  beforeEach(() => {
    hookState.current = loadedDetail();
  });

  it('renders header with product name + version label', async () => {
    renderAt('/backoffice/inventory/recipes/p-1');
    await waitFor(() => expect(screen.getByText('Pain au chocolat')).toBeInTheDocument());
    expect(screen.getByText(/v3/)).toBeInTheDocument();
    expect(screen.getByText(/5 versions/)).toBeInTheDocument();
  });

  it('renders BOM with material drill-down', async () => {
    renderAt('/backoffice/inventory/recipes/p-1');
    await waitFor(() => expect(screen.getByText('Flour')).toBeInTheDocument());
    expect(screen.getByText('Butter')).toBeInTheDocument();
    const flourLink = screen.getByRole('link', { name: /Flour/ });
    expect(flourLink.getAttribute('href')).toBe('/backoffice/products/m-1');
  });

  it('renders the empty state — not "Loading…" — when the recipe is absent', () => {
    hookState.current = { isLoading: false, error: null, data: null };
    renderAt('/backoffice/inventory/recipes/nope');
    expect(screen.getByText('Recipe not found')).toBeInTheDocument();
    expect(screen.queryByText(/Loading/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Back to recipes/ })).toBeInTheDocument();
  });

  it('renders an alert block when the query fails', () => {
    hookState.current = { isLoading: false, error: new Error('boom'), data: undefined };
    renderAt('/backoffice/inventory/recipes/p-1');
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Failed to load recipe');
    expect(screen.queryByText(/Loading/)).not.toBeInTheDocument();
  });

  it('renders the share of cost per line', async () => {
    renderAt('/backoffice/inventory/recipes/p-1');
    await waitFor(() => expect(screen.getByText('Flour')).toBeInTheDocument());
    expect(screen.getByText('75,0%')).toBeInTheDocument();
    expect(screen.getByText('25,0%')).toBeInTheDocument();
  });

  it('sums the line costs in the table foot', async () => {
    const { container } = renderAt('/backoffice/inventory/recipes/p-1');
    await waitFor(() => expect(screen.getByText('Flour')).toBeInTheDocument());
    const foot = container.querySelector('tfoot');
    expect(foot).not.toBeNull();
    // 6 000 + 2 000 = 8 000, et la part du pied referme les 100 %.
    expect(foot?.textContent).toContain('8.000');
    expect(foot?.textContent).toContain('100,0%');
  });

  it('renders a dash — never NaN nor 0 % — when the total cost is zero', async () => {
    hookState.current = loadedDetail({
      bom: [bomRow({ material_id: 'm-1', material_name: 'Flour', line_cost: 0 })],
      total_cost: 0,
    });
    const { container } = renderAt('/backoffice/inventory/recipes/p-1');
    await waitFor(() => expect(screen.getByText('Flour')).toBeInTheDocument());
    expect(container.textContent).not.toContain('NaN');
    const foot = container.querySelector('tfoot');
    expect(foot?.textContent).toContain('—');
    expect(foot?.textContent).not.toContain('0,0%');
  });
});
