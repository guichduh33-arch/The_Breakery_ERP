// apps/backoffice/src/pages/inventory/__tests__/display-stock-page.smoke.test.tsx
//
// POS display-stock isolation (Wave 6 / Task 26) — DisplayStockPage smoke.
//
// Covers: header renders, both tables render their mocked rows (1 counter
// row + 1 ledger row). Mocks the two read-only hooks.

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import DisplayStockPage from '@/pages/inventory/DisplayStockPage.js';
import type { DisplayStockRow } from '@/features/inventory/hooks/useDisplayStock.js';
import type { DisplayMovementRow } from '@/features/inventory/hooks/useDisplayMovements.js';

const MOCK_STOCK: DisplayStockRow[] = [
  {
    product_id:   'p-1',
    product_name: 'Croissant',
    sku:          'PAS-CROI',
    unit:         'pcs',
    quantity:     12,
    updated_at:   '2026-05-30T08:00:00Z',
  },
];

const MOCK_MOVEMENTS: DisplayMovementRow[] = [
  {
    id:             'dm-1',
    product_name:   'Croissant',
    movement_type:  'sale',
    quantity:       -2,
    reason:         'Counter sale',
    reference_type: 'order',
    created_at:     '2026-05-30T09:00:00Z',
  },
];

vi.mock('@/features/inventory/hooks/useDisplayStock.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/inventory/hooks/useDisplayStock.js')>();
  return {
    ...actual,
    useDisplayStock: () => ({ data: MOCK_STOCK, isLoading: false, error: null }),
  };
});

vi.mock('@/features/inventory/hooks/useDisplayMovements.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/inventory/hooks/useDisplayMovements.js')>();
  return {
    ...actual,
    useDisplayMovements: () => ({ data: MOCK_MOVEMENTS, isLoading: false, error: null }),
  };
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <DisplayStockPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('DisplayStockPage [Wave 6 / Task 26]', () => {
  it('renders the page header and both tables', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /Display Stock \(Vitrine\)/i })).toBeInTheDocument();
    expect(screen.getByTestId('display-stock-table')).toBeInTheDocument();
    expect(screen.getByTestId('display-movements-table')).toBeInTheDocument();
  });

  it('renders the counter row and the ledger row', () => {
    renderPage();
    // Counter row: SKU is unique to the stock table.
    expect(screen.getByText('PAS-CROI')).toBeInTheDocument();
    // Ledger row: the sale movement type chip is unique to the ledger table.
    expect(screen.getByText(/^sale$/i)).toBeInTheDocument();
    expect(screen.getByText('Counter sale')).toBeInTheDocument();
  });
});
