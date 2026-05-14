// apps/pos/src/features/stock/__tests__/POSStockView.test.tsx
//
// Session 14 — Phase 2.D smoke for the POS Cafe Stock view. Mocks the data
// hooks (usePOSStockProducts / usePOSReceiveStock), useNavigate, and the
// auth store so we can verify header chips, empty state, and back nav.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import POSStockView from '../POSStockView';
import type { POSStockProductRow } from '../hooks/usePOSStockProducts';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  Toaster: () => null,
}));

const productsState = {
  current: {
    data: [] as POSStockProductRow[],
    isLoading: false,
    isError: false,
  },
};

vi.mock('../hooks/usePOSStockProducts', () => ({
  POS_STOCK_PRODUCTS_KEY: ['pos-stock-products'],
  usePOSStockProducts: () => productsState.current,
}));

vi.mock('../hooks/usePOSReceiveStock', () => ({
  usePOSReceiveStock: () => ({ mutate: vi.fn(), isPending: false }),
  POSReceiveStockError: class extends Error {
    constructor(public code: string, message?: string) { super(message ?? code); }
  },
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: <T,>(selector: (s: { hasPermission: (code: string) => boolean }) => T) =>
    selector({ hasPermission: () => true }),
}));

function row(overrides: Partial<POSStockProductRow> = {}): POSStockProductRow {
  return {
    id: 'p1',
    sku: 'SKU-1',
    name: 'Croissant',
    unit: 'pcs',
    image_url: null,
    current_stock: 5,
    min_stock_threshold: 2,
    retail_price: 25_000,
    category_id: 'c1',
    category_name: 'Pastry',
    category_slug: 'pastry',
    ...overrides,
  };
}

function renderView() {
  return render(
    <MemoryRouter>
      <POSStockView />
    </MemoryRouter>,
  );
}

describe('POSStockView', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    productsState.current = { data: [], isLoading: false, isError: false };
  });

  it('renders the Cafe Stock header and KPI chips with zero state', () => {
    renderView();
    expect(screen.getByRole('heading', { name: /cafe stock/i })).toBeInTheDocument();
    expect(screen.getByText(/0 out/i)).toBeInTheDocument();
    expect(screen.getByText(/0 low/i)).toBeInTheDocument();
    expect(screen.getByText(/0 products/i)).toBeInTheDocument();
  });

  it('renders the empty state when no products match', () => {
    renderView();
    expect(screen.getByText(/no products match/i)).toBeInTheDocument();
  });

  it('shows a loading message while products are fetching', () => {
    productsState.current = { data: [], isLoading: true, isError: false };
    renderView();
    expect(screen.getByText(/loading stock/i)).toBeInTheDocument();
  });

  it('aggregates KPI counts from the loaded rows', () => {
    productsState.current = {
      data: [
        row({ id: 'p1', current_stock: 0, min_stock_threshold: 2 }),
        row({ id: 'p2', current_stock: 1, min_stock_threshold: 2 }),
        row({ id: 'p3', current_stock: 10, min_stock_threshold: 2 }),
      ],
      isLoading: false,
      isError: false,
    };
    renderView();
    expect(screen.getByText(/1 out/i)).toBeInTheDocument();
    expect(screen.getByText(/1 low/i)).toBeInTheDocument();
    expect(screen.getByText(/3 products/i)).toBeInTheDocument();
  });

  it('navigates back to /pos when the back button is clicked', () => {
    renderView();
    fireEvent.click(screen.getByTestId('pos-stock-back'));
    expect(navigateMock).toHaveBeenCalledWith('/pos');
  });
});
