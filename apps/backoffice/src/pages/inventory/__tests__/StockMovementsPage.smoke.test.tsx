// apps/backoffice/src/pages/inventory/__tests__/StockMovementsPage.smoke.test.tsx
// Session 14 / Phase 4.C — smoke tests for the rewritten StockMovementsPage.
//
// Covers: header renders, KPI tiles render, ledger rows from the infinite
// query show up. Mocks the data hooks + the section list (imported by the
// MovementsFiltersBar via inventory-transfers/hooks/useSections).

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import StockMovementsPage from '@/pages/inventory/StockMovementsPage.js';
import type { MovementRow } from '@/features/inventory-movements/hooks/useStockMovementsFeed.js';

const MOCK_MOVEMENTS: MovementRow[] = [
  {
    id:                'mv-1',
    product_id:        'p-1',
    product_sku:       'BEV-AMER',
    product_name:      'Americano',
    movement_type:     'sale',
    quantity:          -2,
    unit:              'pcs',
    reason:            'Counter sale',
    unit_cost:         null,
    from_section_id:   's-1',
    from_section_code: 'KIT',
    to_section_id:     null,
    to_section_code:   null,
    supplier_id:       null,
    supplier_name:     null,
    reference_type:    'sales_order',
    reference_id:      'so-1',
    lot_id:            null,
    created_at:        '2026-05-12T08:00:00Z',
    created_by:        'u-1',
    author_name:       'Jane Operator',
    metadata:          {},
  },
  {
    id:                'mv-2',
    product_id:        'p-2',
    product_sku:       'PAS-CROI',
    product_name:      'Croissant',
    movement_type:     'purchase',
    quantity:          24,
    unit:              'pcs',
    reason:            'Daily delivery',
    unit_cost:         5000,
    from_section_id:   null,
    from_section_code: null,
    to_section_id:     's-1',
    to_section_code:   'KIT',
    supplier_id:       'sup-1',
    supplier_name:     'Supplier A',
    reference_type:    'purchase_order',
    reference_id:      'po-1',
    lot_id:            null,
    created_at:        '2026-05-12T07:00:00Z',
    created_by:        'u-2',
    author_name:       'John Receiver',
    metadata:          {},
  },
];

vi.mock('@/features/inventory-movements/hooks/useStockMovementsFeed.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/inventory-movements/hooks/useStockMovementsFeed.js')>();
  return {
    ...actual,
    useStockMovementsFeed: () => ({
      data:               { pages: [MOCK_MOVEMENTS], pageParams: [{}] },
      isLoading:          false,
      error:              null,
      hasNextPage:        false,
      isFetchingNextPage: false,
      fetchNextPage:      () => Promise.resolve(undefined),
    }),
  };
});

vi.mock('@/features/inventory-movements/hooks/useMovementAggregates.js', () => ({
  useMovementAggregates: () => ({
    data: [
      { movement_type: 'sale',     count: 10, qty_total: -20, value_total: 0 },
      { movement_type: 'purchase', count: 3,  qty_total:  72, value_total: 360000 },
    ],
    isLoading: false,
    error:     null,
  }),
}));

vi.mock('@/features/inventory-transfers/hooks/useSections.js', () => ({
  useSections: () => ({
    data: [
      { id: 's-1', code: 'KIT', name: 'Kitchen', kind: 'production', display_order: 1 },
    ],
    isLoading: false,
    error:     null,
  }),
}));

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <StockMovementsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('StockMovementsPage (Phase 4.C rewrite)', () => {
  it('renders the page header and KPI tiles', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /Stock movements/i })).toBeInTheDocument();
    expect(screen.getByText(/Stock in/i)).toBeInTheDocument();
    expect(screen.getByText(/Stock out/i)).toBeInTheDocument();
    expect(screen.getByText(/Value moved/i)).toBeInTheDocument();
  });

  it('renders ledger rows from the mocked feed', () => {
    renderPage();
    expect(screen.getByText('Americano')).toBeInTheDocument();
    expect(screen.getByText('Croissant')).toBeInTheDocument();
    expect(screen.getByText('BEV-AMER')).toBeInTheDocument();
    expect(screen.getByText('PAS-CROI')).toBeInTheDocument();
  });

  it('renders the filter bar (section / type / dates)', () => {
    renderPage();
    expect(screen.getByLabelText(/Section/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Type/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/From/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^To$/i)).toBeInTheDocument();
  });
});
