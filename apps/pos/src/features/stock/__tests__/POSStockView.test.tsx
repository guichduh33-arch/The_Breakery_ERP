// apps/pos/src/features/stock/__tests__/POSStockView.test.tsx
//
// Session 14 — Phase 2.D smoke for the POS Cafe Stock view. Mocks the data
// hooks (usePOSStockProducts / usePOSReceiveStock), useNavigate, and the
// auth store so we can verify header chips, empty state, and back nav.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, renderHook, act, screen, fireEvent, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { DisplayGestureError } from '../hooks/useReturnToKitchen';
import { useDisplayStockGestures } from '../hooks/useDisplayStockGestures';
import { MemoryRouter } from 'react-router-dom';
import type * as ReactRouterDom from 'react-router-dom';
import POSStockView from '../POSStockView';
import type { POSStockProductRow } from '../hooks/usePOSStockProducts';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof ReactRouterDom>('react-router-dom');
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

const receiveMutate = vi.fn();
vi.mock('../hooks/usePOSReceiveStock', () => ({
  usePOSReceiveStock: () => ({ mutateAsync: receiveMutate, isPending: false }),
  POSReceiveStockError: class extends Error {
    constructor(public code: string, message?: string) { super(message ?? code); }
  },
}));

const returnToKitchenMutate = vi.fn();
vi.mock('../hooks/useReturnToKitchen', () => ({
  useReturnToKitchen: () => ({ mutateAsync: returnToKitchenMutate, isPending: false }),
  DisplayGestureError: class extends Error {
    constructor(public code: string, message?: string) { super(message ?? code); }
  },
}));

const wasteMutate = vi.fn();
vi.mock('../hooks/useWasteDisplay', () => ({
  useWasteDisplay: () => ({ mutateAsync: wasteMutate, isPending: false }),
}));

const adjustMutate = vi.fn();
vi.mock('../hooks/useAdjustDisplay', () => ({
  useAdjustDisplay: () => ({ mutateAsync: adjustMutate, isPending: false }),
}));

let canManage = true;
vi.mock('@/stores/authStore', () => ({
  useAuthStore: <T,>(selector: (s: { hasPermission: (code: string) => boolean }) => T) =>
    selector({ hasPermission: () => canManage }),
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
    vi.clearAllMocks();
    canManage = true;
    localStorage.clear();
    navigateMock.mockReset();
    returnToKitchenMutate.mockReset();
    wasteMutate.mockReset();
    receiveMutate.mockReset();
    adjustMutate.mockReset();
    for (const mutation of [receiveMutate, returnToKitchenMutate, wasteMutate, adjustMutate]) {
      mutation.mockResolvedValue({ product_id: 'p1', new_display_stock: 4, idempotent_replay: false });
    }
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

  it('invokes the return-to-kitchen mutation when "Return to kitchen" is tapped', async () => {
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
    await waitFor(() => expect(screen.getByLabelText(/Enter quantity/)).toHaveValue(0));
  });

  it('opens the waste modal and invokes the waste mutation on confirm', async () => {
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
    await waitFor(() => expect(screen.queryByTestId('waste-display-modal')).not.toBeInTheDocument());
  });

  function withProduct() {
    productsState.current = { data: [row()], isLoading: false, isError: false };
    renderView();
  }

  it('keeps the exact received quantity and key after a lost response, then clears after replay', async () => {
    receiveMutate.mockRejectedValueOnce(new Error('response lost'));
    receiveMutate.mockResolvedValueOnce({ product_id: 'p1', new_display_stock: 6.375, idempotent_replay: true });
    withProduct();
    fireEvent.change(screen.getByLabelText(/Enter quantity/), { target: { value: '1.375' } });
    fireEvent.click(screen.getByRole('button', { name: 'Receive +1.375' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.getByLabelText(/Enter quantity/)).toBeDisabled();
    expect(screen.getByRole('button', { name: '+6' })).toBeDisabled();
    expect(toast.success).not.toHaveBeenCalled();
    const original: unknown = receiveMutate.mock.calls[0]?.[0];
    fireEvent.click(screen.getByRole('button', { name: 'Retry operation' }));
    await waitFor(() => expect(toast.info).toHaveBeenCalledWith(expect.stringContaining('6.375 pcs')));
    expect(receiveMutate.mock.calls[1]?.[0]).toEqual(original);
    expect(screen.getByLabelText(/Enter quantity/)).toHaveValue(0);
    expect(screen.queryByRole('button', { name: 'Retry operation' })).not.toBeInTheDocument();
  });

  it('retains fractional waste and its reason after refusal and permits correction', async () => {
    wasteMutate.mockRejectedValueOnce(new DisplayGestureError('insufficient_display_stock'));
    withProduct();
    fireEvent.click(screen.getByRole('button', { name: 'Waste' }));
    fireEvent.change(screen.getByLabelText('Wasted quantity'), { target: { value: '0.375' } });
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'unsold' } });
    fireEvent.click(screen.getByTestId('waste-display-confirm'));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.getByLabelText('Wasted quantity')).toHaveValue(0.375);
    expect(screen.getByLabelText('Wasted quantity')).toBeEnabled();
    expect(screen.getByLabelText(/Reason/)).toHaveValue('unsold');
    fireEvent.change(screen.getByLabelText('Wasted quantity'), { target: { value: '0.125' } });
    fireEvent.click(screen.getByTestId('waste-display-confirm'));
    await waitFor(() => expect(screen.queryByTestId('waste-display-modal')).not.toBeInTheDocument());
    expect(wasteMutate.mock.calls[1]?.[0]).toMatchObject({ quantity: 0.125 });
    const first = wasteMutate.mock.calls[0]?.[0] as { idempotencyKey: string };
    const second = wasteMutate.mock.calls[1]?.[0] as { idempotencyKey: string };
    expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
  });

  it('refuses changed parameters while an earlier response is uncertain', async () => {
    receiveMutate.mockRejectedValue(new Error('response lost'));
    const { result } = renderHook(() => useDisplayStockGestures(true));
    await act(async () => { await result.current.submit('receive', row(), 1.375, 'receive'); });
    await act(async () => {
      expect(await result.current.submit('receive', row(), 6, 'receive')).toBe(false);
      expect(await result.current.submit('waste', row(), 1.375, 'receive')).toBe(false);
    });
    expect(receiveMutate).toHaveBeenCalledOnce();
    expect(wasteMutate).not.toHaveBeenCalled();
    expect(result.current.pending[0]).toMatchObject({ quantity: 1.375, reason: 'receive' });
  });

  it('rejects excessive precision and an empty absolute count', () => {
    withProduct();
    fireEvent.click(screen.getByRole('button', { name: 'Adjust' }));
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'recount' } });
    fireEvent.change(screen.getByLabelText('New quantity'), { target: { value: '' } });
    expect(screen.getByTestId('adjust-display-confirm')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('New quantity'), { target: { value: '0.0001' } });
    expect(screen.getByTestId('adjust-display-confirm')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('New quantity'), { target: { value: '0' } });
    expect(screen.getByTestId('adjust-display-confirm')).toBeEnabled();
    expect(adjustMutate).not.toHaveBeenCalled();
  });

  it.each(['card', 'list'])('allows reading without manage actions in %s view', (mode) => {
    canManage = false;
    localStorage.setItem('pos-stock-view', mode);
    withProduct();
    expect(screen.getByText('Croissant')).toBeInTheDocument();
    expect(screen.getByText(/Read-only access/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Enter quantity/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Receive|Waste|Adjust|More actions/ })).not.toBeInTheDocument();
  });
});
