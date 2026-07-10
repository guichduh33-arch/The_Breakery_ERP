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

const returnToKitchenMutate = vi.fn();
vi.mock('../hooks/useReturnToKitchen', () => ({
  useReturnToKitchen: () => ({ mutate: returnToKitchenMutate, isPending: false }),
  DisplayGestureError: class extends Error {
    constructor(public code: string, message?: string) { super(message ?? code); }
  },
}));

const wasteMutate = vi.fn();
vi.mock('../hooks/useWasteDisplay', () => ({
  useWasteDisplay: () => ({ mutate: wasteMutate, isPending: false }),
}));

vi.mock('../hooks/useAdjustDisplay', () => ({
  useAdjustDisplay: () => ({ mutate: vi.fn(), isPending: false }),
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
    display_stock: 5,
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
    returnToKitchenMutate.mockReset();
    wasteMutate.mockReset();
    productsState.current = { data: [], isLoading: false, isError: false };
  });

  it('renders the Display Stock header and KPI chips with zero state', () => {
    renderView();
    expect(screen.getByRole('heading', { name: /display stock/i })).toBeInTheDocument();
    expect(screen.getByText(/0 out/i)).toBeInTheDocument();
    expect(screen.getByText(/0 low/i)).toBeInTheDocument();
    expect(screen.getByText(/0 products/i)).toBeInTheDocument();
  });

  it('renders the empty state when no products match', () => {
    renderView();
    expect(screen.getByText(/no products in this category/i)).toBeInTheDocument();
  });

  it('shows a loading message while products are fetching', () => {
    productsState.current = { data: [], isLoading: true, isError: false };
    renderView();
    expect(screen.getByText(/loading stock/i)).toBeInTheDocument();
  });

  it('aggregates KPI counts from the loaded rows', () => {
    productsState.current = {
      data: [
        row({ id: 'p1', display_stock: 0, min_stock_threshold: 2 }),
        row({ id: 'p2', display_stock: 1, min_stock_threshold: 2 }),
        row({ id: 'p3', display_stock: 10, min_stock_threshold: 2 }),
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

  it('invokes the return-to-kitchen mutation when "Return to kitchen" is tapped', () => {
    productsState.current = {
      data: [row({ id: 'p1', name: 'Croissant', display_stock: 5 })],
      isLoading: false,
      isError: false,
    };
    renderView();

    // Bump the card's local qty stepper so the closure buttons enable.
    fireEvent.click(screen.getByLabelText('Increase'));

    fireEvent.click(screen.getByRole('button', { name: /return to kitchen/i }));

    expect(returnToKitchenMutate).toHaveBeenCalledTimes(1);
    expect(returnToKitchenMutate.mock.calls[0]?.[0]).toMatchObject({
      productId: 'p1',
      quantity: 1,
    });
  });

  it('opens the waste modal and invokes the waste mutation on confirm', () => {
    productsState.current = {
      data: [row({ id: 'p1', name: 'Croissant', display_stock: 5 })],
      isLoading: false,
      isError: false,
    };
    renderView();

    // "Waste" opens the modal (no window.prompt anymore).
    fireEvent.click(screen.getByRole('button', { name: /waste/i }));
    expect(screen.getByTestId('waste-display-modal')).toBeInTheDocument();

    // Confirm is disabled until a reason (>= 3 chars) is entered.
    const confirm = screen.getByTestId('waste-display-confirm');
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: 'unsold' } });
    expect(confirm).not.toBeDisabled();
    fireEvent.click(confirm);

    expect(wasteMutate).toHaveBeenCalledTimes(1);
    expect(wasteMutate.mock.calls[0]?.[0]).toMatchObject({
      productId: 'p1',
      quantity: 1,
      reason: 'unsold',
    });
  });
});
