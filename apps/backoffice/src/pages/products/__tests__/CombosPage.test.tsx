// apps/backoffice/src/pages/products/__tests__/CombosPage.test.tsx
//
// Session 47 — updated for choice-group model.
// Tests: renders cards from new schema, search filter, KPI counts,
// Create button visible with permission, hidden without.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import CombosPage from '@/pages/products/CombosPage.js';

// ------------------------------------------------------------------
// Mock data — choice-group model
// ------------------------------------------------------------------
const COMBOS_DATA = [
  {
    id: 'cb-1',
    name: 'French Platter',
    sku: 'CMB-001',
    retail_price: 45000,
    combo_base_price: 45000,
    is_active: true,
    image_url: null,
    combo_groups: [
      {
        id: 'g-1',
        name: 'Drinks',
        group_type: 'single',
        is_required: true,
        min_select: 1,
        max_select: 1,
        sort_order: 0,
        combo_group_options: [
          {
            component_product_id: 'p-amer',
            surcharge: 0,
            is_default: true,
            sort_order: 0,
            component: { name: 'Americano', retail_price: 35000 },
          },
        ],
      },
    ],
  },
  {
    id: 'cb-2',
    name: 'Classic Combo',
    sku: 'CMB-002',
    retail_price: 50000,
    combo_base_price: 50000,
    is_active: false,
    image_url: null,
    combo_groups: [],
  },
];

function buildChain(data: unknown[]) {
  const chain: Record<string, unknown> = {};
  const methods = ['eq', 'is', 'neq', 'not', 'filter', 'limit', 'range'];
  for (const m of methods) { chain[m] = () => chain; }
  chain.select = () => chain;
  chain.order = () => Promise.resolve({ data, error: null });
  chain.maybeSingle = () => Promise.resolve({ data: null, error: null });
  return chain;
}

vi.mock('@/lib/supabase.js', () => ({
  supabase: { from: () => buildChain(COMBOS_DATA) },
}));

let canCreatePerm = true;
vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (sel: (s: { hasPermission: (p: string) => boolean }) => unknown) =>
    sel({ hasPermission: () => canCreatePerm }),
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/backoffice/products/combos']}>
        <Routes>
          <Route path="/backoffice/products/combos" element={<CombosPage />} />
          <Route path="/backoffice/products/combos/new" element={<div>New Combo</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('CombosPage', () => {
  it('renders combo cards from the mock rows', async () => {
    canCreatePerm = true;
    renderPage();
    expect(await screen.findByText('French Platter')).toBeInTheDocument();
    expect(screen.getByText('Classic Combo')).toBeInTheDocument();
    expect(screen.getByText(/Combo Management/i)).toBeInTheDocument();
  });

  it('filters combos via the search input', async () => {
    canCreatePerm = true;
    renderPage();
    expect(await screen.findByText('French Platter')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Search combos/i), { target: { value: 'classic' } });
    expect(screen.queryByText('French Platter')).not.toBeInTheDocument();
    expect(screen.getByText('Classic Combo')).toBeInTheDocument();
  });

  it('displays KPI labels for total, active and inactive', async () => {
    canCreatePerm = true;
    renderPage();
    await screen.findByText('French Platter');
    expect(screen.getByText('Total Combos')).toBeInTheDocument();
    expect(screen.getByText('Active Sets')).toBeInTheDocument();
    expect(screen.getByText('Inactive')).toBeInTheDocument();
  });

  it('shows Create button when user has combos.create', async () => {
    canCreatePerm = true;
    renderPage();
    await screen.findByText('French Platter');
    expect(screen.getByTestId('create-combo-btn')).toBeInTheDocument();
  });

  it('hides Create button when user lacks combos.create', async () => {
    canCreatePerm = false;
    renderPage();
    await screen.findByText('French Platter');
    expect(screen.queryByTestId('create-combo-btn')).not.toBeInTheDocument();
  });
});
