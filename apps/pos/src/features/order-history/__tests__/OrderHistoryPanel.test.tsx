// apps/pos/src/features/order-history/__tests__/OrderHistoryPanel.test.tsx
//
// Session 14 — Phase 2.D smoke for the rewritten order history panel.
// Mocks all data hooks (useOrderHistory / useOrderDetail / useVoidOrder /
// useRefundOrder) so we can verify the modal chrome, KPI strip, empty
// state, and onClose plumbing without touching Supabase.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OrderHistoryPanel } from '../OrderHistoryPanel';
import type { OrderHistoryRow } from '../hooks/useOrderHistory';

const historyState = {
  current: {
    data: [] as OrderHistoryRow[] | undefined,
    financialVisible: true,
    isLoading: false,
    isError: false,
    // S43 P1-3: the panel calls refetch() when it opens.
    refetch: vi.fn(),
  },
};

vi.mock('../hooks/useOrderHistory', () => ({
  useOrderHistory: () => historyState.current,
}));

vi.mock('../hooks/useOrderDetail', () => ({
  useOrderDetail: () => ({ data: null, isLoading: false, isError: false }),
}));

vi.mock('../hooks/useVoidOrder', () => ({
  useVoidOrder: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('../hooks/useRefundOrder', () => ({
  useRefundOrder: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  Toaster: () => null,
}));

function row(overrides: Partial<OrderHistoryRow> = {}): OrderHistoryRow {
  return {
    id: 'o1',
    order_number: '1001',
    status: 'paid',
    total: 75_000,
    paid_at: '2026-05-14T10:00:00.000Z',
    voided_at: null,
    customer_id: null,
    table_number: null,
    order_type: 'dine_in',
    total_refunded: 0,
    primary_payment_method: 'cash',
    paid_by_method: [{ method: 'cash', amount: 75_000 }],
    ...overrides,
  };
}

describe('OrderHistoryPanel', () => {
  beforeEach(() => {
    historyState.current = { data: [], financialVisible: true, isLoading: false, isError: false, refetch: vi.fn() };
  });

  it('renders the Transaction History header and KPI strip when open', () => {
    render(<OrderHistoryPanel open onClose={() => { /* fixture sans effet */ }} />);
    expect(screen.getByRole('heading', { name: /transaction history/i })).toBeInTheDocument();
    expect(screen.getByTestId('order-history-stats')).toBeInTheDocument();
  });

  it('shows the empty-shift message when the list is []', () => {
    render(<OrderHistoryPanel open onClose={() => { /* fixture sans effet */ }} />);
    expect(screen.getByText(/no orders in this shift yet/i)).toBeInTheDocument();
  });

  it('renders nothing when open=false', () => {
    render(<OrderHistoryPanel open={false} onClose={() => { /* fixture sans effet */ }} />);
    expect(screen.queryByRole('heading', { name: /transaction history/i })).toBeNull();
  });

  it('renders a transaction row and a count tally for each row', () => {
    historyState.current = {
      data: [row(), row({ id: 'o2', order_number: '1002', status: 'voided' })],
      financialVisible: true,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };
    render(<OrderHistoryPanel open onClose={() => { /* fixture sans effet */ }} />);
    expect(screen.getByTestId('history-row-o1')).toBeInTheDocument();
    expect(screen.getByTestId('history-row-o2')).toBeInTheDocument();
    expect(screen.getByText(/voided/i)).toBeInTheDocument();
    expect(screen.getByText(/2 transactions this shift/i)).toBeInTheDocument();
  });

  it('hides totals, transaction count and unsolicited rows while the shift is blind', () => {
    historyState.current = { data: [row()], financialVisible: false, isLoading: false, isError: false, refetch: vi.fn() };
    render(<OrderHistoryPanel open onClose={vi.fn()} />);
    expect(screen.queryByTestId('order-history-stats')).not.toBeInTheDocument();
    expect(screen.queryByTestId('history-row-o1')).not.toBeInTheDocument();
    expect(screen.getByText('Shift totals are hidden until closure')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Find receipt' })).toBeDisabled();
  });

  it('allows exact receipt lookup without revealing shift totals', () => {
    historyState.current = { data: [row()], financialVisible: false, isLoading: false, isError: false, refetch: vi.fn() };
    render(<OrderHistoryPanel open onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Receipt number' }), { target: { value: '1001' } });
    fireEvent.click(screen.getByRole('button', { name: 'Find receipt' }));
    expect(screen.getByTestId('history-row-o1')).toBeInTheDocument();
    expect(screen.queryByTestId('order-history-stats')).not.toBeInTheDocument();
    expect(screen.queryByText(/transactions this shift/i)).not.toBeInTheDocument();
  });

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn();
    render(<OrderHistoryPanel open onClose={onClose} />);
    fireEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
