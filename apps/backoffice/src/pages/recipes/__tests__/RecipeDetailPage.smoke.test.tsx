import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RecipeDetailPage } from '../RecipeDetailPage.js';

vi.mock('@/features/recipes/hooks/useRecipeDetail.js', () => ({
  useRecipeDetail: (productId: string) => ({
    isLoading: false,
    data: {
      product: {
        id: productId,
        name: 'Pain au chocolat',
        sku: 'PAC-001',
        unit: 'pcs',
        cost_price: 4500,
        is_semi_finished: false,
      },
      active_version_number: 3,
      version_count: 5,
      bom: [
        {
          material_id: 'm-1',
          material_name: 'Flour',
          material_unit: 'g',
          qty_per_unit: 500,
          current_stock: 25_000,
          cost_price: 5,
        },
        {
          material_id: 'm-2',
          material_name: 'Butter',
          material_unit: 'g',
          qty_per_unit: 150,
          current_stock: 8_000,
          cost_price: 30,
        },
      ],
      total_cost: 7000,
    },
  }),
}));

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
});
