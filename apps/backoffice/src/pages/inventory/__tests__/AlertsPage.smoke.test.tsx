// apps/backoffice/src/pages/inventory/__tests__/AlertsPage.smoke.test.tsx
// Session 14 / Phase 4.C — smoke test for the rewritten AlertsPage.
//
// Refonte design 2026-08-08 : la page ne porte plus de rangée de tuiles KPI.
// Le compte vit désormais sur chaque onglet et le déficit dans le sous-titre,
// ce test suit. Les quatre onglets restent — c'est ce que le test garde.
//
// Mocks the low-stock hook + the per-tab content components so the suite
// stays focused on the page chrome (header, tab list, per-tab counts).

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type * as UseLowStockModule from '@/features/inventory-alerts/hooks/useLowStock.js';
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

// La page charge le compte des QUATRE onglets, y compris ceux qui ne sont pas
// montés — le client doit donc répondre même pour un test de chrome.
vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    from: () => ({ select: () => Promise.resolve({ data: [], error: null }) }),
    rpc: () => Promise.resolve({ data: [], error: null }),
  },
}));

vi.mock('@/features/inventory-alerts/hooks/useLowStock.js', async (importOriginal) => {
  const actual = await importOriginal<typeof UseLowStockModule>();
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
vi.mock('@/features/inventory-alerts/components/ConfigIssuesTab.js', () => ({
  ConfigIssuesTab: () => <div data-testid="config-tab" />,
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
  it('renders the page header with the shortfall summary', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /Stock alerts/i })).toBeInTheDocument();
    // 2 lignes, 1 à zéro, 19 unités manquantes au total.
    expect(screen.getByText(/2 under threshold · 1 at zero · 19 units short/i)).toBeInTheDocument();
  });

  it('keeps the four tabs and shows the Low stock pane by default', () => {
    renderPage();
    expect(screen.getByRole('tab', { name: /Low stock/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Reorder/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Production/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Config produit/i })).toBeInTheDocument();
    // Default-selected pane mounts the Low stock content stub.
    expect(screen.getByTestId('low-tab')).toBeInTheDocument();
  });

  it('carries the low-stock count on its own tab', () => {
    renderPage();
    expect(screen.getByTestId('tab-low')).toHaveTextContent('2');
  });
});
