// apps/backoffice/src/__tests__/inventory-kpi.smoke.test.tsx
// Session 14 / Phase 6.A — verifies the KPI strip + matching screenshot
// title rebuild. Mocks the data hook directly so we only exercise the page
// shell (no Supabase, no MSW).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (sel: (s: { hasPermission: (p: string) => boolean }) => unknown) =>
    sel({ hasPermission: () => true }),
}));

vi.mock('@/features/inventory/hooks/useStockLevels.js', () => ({
  useStockLevels: () => ({
    data: [
      {
        product_id: 'p-1', sku: 'BEV-AMER', name: 'Americano',
        category_id: null, category_name: null,
        current_stock: 5, min_stock_threshold: 10, track_inventory: true,
        unit: 'pcs', stock_value: 25_000,
        last_movement_at: null,
      },
      {
        product_id: 'p-2', sku: 'PAS-CROI', name: 'Croissant',
        category_id: null, category_name: null,
        current_stock: 50, min_stock_threshold: 0, track_inventory: true,
        unit: 'pcs', stock_value: 500_000,
        last_movement_at: null,
      },
    ],
    isLoading: false,
    error: null,
  }),
  STOCK_LEVELS_QUERY_KEY: ['stock-levels'],
}));

// ADR-024 déc. 1 — le total et les compteurs ne viennent plus des lignes.
// Ce mock doit exister, sinon la page appelle le vrai hook et part au réseau.
vi.mock('@/features/inventory/hooks/useStockCounters.js', () => ({
  useStockCounters: () => ({
    data: { total_count: 12, low_count: 1, zero_count: 0, negative_count: 0, untracked_count: 0 },
    isLoading: false,
    error: null,
  }),
  STOCK_COUNTERS_QUERY_KEY: ['stock-levels', 'counters'],
}));

vi.mock('@/features/inventory/hooks/useInventoryReferenceData.js', () => ({
  useInventoryReferenceData: () => ({
    data: { categories: [], suppliers: [] },
    isLoading: false,
    error: null,
  }),
}));

// Stub the modals so we don't pull their (heavier) dependency trees.
// `ReceiveModal` n'est plus stubbé : le module a été retiré à l'audit du
// 2026-07-27 (la réception valorisée passe par /inventory/incoming). Le stub
// survivait à vide et laissait croire à une couverture qui n'existait plus.
vi.mock('@/features/inventory/components/AdjustModal.js',  () => ({ AdjustModal:  () => null }));
vi.mock('@/features/inventory/components/WasteModal.js',   () => ({ WasteModal:   () => null }));
vi.mock('@/features/inventory/components/MovementHistoryDrawer.js', () => ({
  MovementHistoryDrawer: () => null,
}));

function renderPage(Component: React.ComponentType) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><Component /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Inventory page (KPI rebuild)', () => {
  beforeEach(() => { cleanup(); });

  // Les requêtes portent sur le conteneur rendu (`within(r.container)`) et non
  // sur `screen`, qui interroge tout le document. Ce fichier tombait en
  // « Found multiple elements » dès qu'un autre fichier de la suite laissait une
  // page Inventory montée : `cleanup()` ne démonte que ce que CE module a rendu.
  // Même motif que `inventory.smoke.test.tsx`, qui ne souffrait pas du défaut.
  it('renders the new "Stock & Inventory" title from the screenshot', { timeout: 30_000 }, async () => {
    const InventoryPage = (await import('@/pages/Inventory.js')).default;
    const w = within(renderPage(InventoryPage).container);
    expect(w.getByRole('heading', { level: 1 })).toHaveTextContent(/Stock\s*&\s*Inventory/i);
  });

  it('renders all 4 KPI tile labels in the header strip', { timeout: 15_000 }, async () => {
    const InventoryPage = (await import('@/pages/Inventory.js')).default;
    const w = within(renderPage(InventoryPage).container);
    expect(w.getByText(/Total products/i)).toBeInTheDocument();
    expect(w.getByText(/In current page/i)).toBeInTheDocument();
    expect(w.getByText(/Active filters/i)).toBeInTheDocument();
    expect(w.getByText(/Critical alerts/i)).toBeInTheDocument();
  });
});
