// apps/backoffice/src/pages/inventory/__tests__/AlertsPage.smoke.test.tsx
// Session 14 / Phase 4.C — smoke test for the rewritten AlertsPage.
//
// Mocks the low-stock hook + the per-tab content components so the suite
// stays focused on the page chrome (header, KPI tiles, tab list).

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import AlertsPage from '@/pages/inventory/AlertsPage.js';
import type { LowStockRow } from '@/features/inventory-alerts/hooks/useLowStock.js';

const MOCK_LOW: LowStockRow[] = [
  {
    product_id:          'p-1',
    product_sku:         'BEV-AMER',
    product_name:        'Americano',
    current_qty:         0,
    min_stock_threshold: 10,
    unit:                'pcs',
    section_id:          's-1',
    section_code:        'KIT',
    section_name:        'Kitchen',
    shortfall:           10,
  },
  {
    product_id:          'p-2',
    product_sku:         'PAS-CROI',
    product_name:        'Croissant',
    current_qty:         3,
    min_stock_threshold: 12,
    unit:                'pcs',
    section_id:          's-1',
    section_code:        'KIT',
    section_name:        'Kitchen',
    shortfall:           9,
  },
];

vi.mock('@/features/inventory-alerts/hooks/useLowStock.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/inventory-alerts/hooks/useLowStock.js')>();
  return {
    ...actual,
    useLowStock: () => ({ data: MOCK_LOW, isLoading: false, error: null }),
  };
});

// Tab content components are mocked so we don't pull in the whole alerts
// query graph for a chrome-only smoke test.
vi.mock('@/features/inventory-alerts/components/LowStockTab.js', () => ({
  LowStockTab: () => <div data-testid="low-tab" />,
}));
vi.mock('@/features/inventory-alerts/components/ReorderTab.js', () => ({
  ReorderTab: () => <div data-testid="reorder-tab" />,
}));
vi.mock('@/features/inventory-alerts/components/ProductionAlertsTab.js', () => ({
  ProductionAlertsTab: () => <div data-testid="production-tab" />,
}));

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AlertsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AlertsPage (Phase 4.C rewrite)', () => {
  it('renders the page header and three KPI tiles', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /Inventory alerts/i })).toBeInTheDocument();
    expect(screen.getByText(/Low stock products/i)).toBeInTheDocument();
    expect(screen.getByText(/Shortfall units/i)).toBeInTheDocument();
    expect(screen.getByText(/Status/i)).toBeInTheDocument();
  });

  it('renders the three tab triggers and shows the Low stock pane by default', () => {
    renderPage();
    // Tab list with all three labels
    expect(screen.getByRole('tab', { name: /Low stock/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Reorder/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Production/i })).toBeInTheDocument();
    // Default-selected pane mounts the Low stock content stub.
    expect(screen.getByTestId('low-tab')).toBeInTheDocument();
  });
});
