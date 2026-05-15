// apps/backoffice/src/__tests__/inventory-kpi.smoke.test.tsx
// Session 14 / Phase 6.A — verifies the KPI strip + matching screenshot
// title rebuild. Mocks the data hook directly so we only exercise the page
// shell (no Supabase, no MSW).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

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
        current_stock: 5, min_stock_threshold: 10,
        last_movement_at: null, total_count: 12,
      },
      {
        product_id: 'p-2', sku: 'PAS-CROI', name: 'Croissant',
        category_id: null, category_name: null,
        current_stock: 50, min_stock_threshold: 0,
        last_movement_at: null, total_count: 12,
      },
    ],
    isLoading: false,
    error: null,
  }),
  STOCK_LEVELS_QUERY_KEY: ['stock-levels'],
}));

vi.mock('@/features/inventory/hooks/useInventoryReferenceData.js', () => ({
  useInventoryReferenceData: () => ({
    data: { categories: [], suppliers: [] },
    isLoading: false,
    error: null,
  }),
}));

// Stub the modals so we don't pull their (heavier) dependency trees.
vi.mock('@/features/inventory/components/AdjustModal.js',  () => ({ AdjustModal:  () => null }));
vi.mock('@/features/inventory/components/ReceiveModal.js', () => ({ ReceiveModal: () => null }));
vi.mock('@/features/inventory/components/WasteModal.js',   () => ({ WasteModal:   () => null }));
vi.mock('@/features/inventory/components/MovementHistoryDrawer.js', () => ({
  MovementHistoryDrawer: () => null,
}));

function renderPage(Component: React.ComponentType) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Component />
    </QueryClientProvider>,
  );
}

describe('Inventory page (KPI rebuild)', () => {
  beforeEach(() => { cleanup(); });

  it('renders the new "Stock & Inventory" title from the screenshot', { timeout: 30_000 }, async () => {
    const InventoryPage = (await import('@/pages/Inventory.js')).default;
    renderPage(InventoryPage);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/Stock\s*&\s*Inventory/i);
  });

  it('renders all 4 KPI tile labels in the header strip', { timeout: 15_000 }, async () => {
    const InventoryPage = (await import('@/pages/Inventory.js')).default;
    renderPage(InventoryPage);
    expect(screen.getByText(/Total products/i)).toBeInTheDocument();
    expect(screen.getByText(/In current page/i)).toBeInTheDocument();
    expect(screen.getByText(/Active filters/i)).toBeInTheDocument();
    expect(screen.getByText(/Critical alerts/i)).toBeInTheDocument();
  });
});
