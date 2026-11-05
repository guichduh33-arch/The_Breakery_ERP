import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, cleanup, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useOrderHistory } from '../hooks/useOrderHistory';
import { useOrderDetail } from '../hooks/useOrderDetail';
import { useShiftStore } from '@/stores/shiftStore';
import { useAuthStore } from '@/stores/authStore';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc }, supabaseUrl: 'https://example.supabase.co' }));
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
let client: QueryClient;
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  rpc.mockReset().mockResolvedValue({ data: { financial_visible: false, orders: [] }, error: null });
  useShiftStore.setState({ current: { id: 'shift-1', opened_at: '2026-11-05T08:00:00Z', opening_cash: 0 } });
  useAuthStore.setState({ user: { id: 'cashier', role_code: 'CASHIER', full_name: 'Cashier', employee_code: 'C' } });
});
afterEach(() => { cleanup(); client.clear(); useShiftStore.setState({ current: null }); useAuthStore.setState({ user: null }); });

describe('Protected transaction history', () => {
  it('uses the protected server decision and never fetches a raw payment list', async () => {
    const { result } = renderHook(() => useOrderHistory(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.financialVisible).toBe(false);
    expect(result.current.data).toEqual([]);
    expect(rpc).toHaveBeenCalledWith('get_pos_transaction_history_v2', { p_session_id: 'shift-1', p_order_number: undefined });
  });
  it('does not fetch while the panel is closed', async () => {
    const { result } = renderHook(() => useOrderHistory(false), { wrapper });
    await act(async () => { await result.current.refetch(); });
    expect(rpc).not.toHaveBeenCalled();
  });
  it('passes an exact receipt number instead of searching a bulk list', async () => {
    renderHook(() => useOrderHistory(true, 'P05112026001'), { wrapper });
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('get_pos_transaction_history_v2', {
      p_session_id: 'shift-1', p_order_number: 'P05112026001',
    }));
  });
  it('loads one receipt with its prior refund through the protected API', async () => {
    rpc.mockResolvedValue({ data: { financial_visible: false, detail: {
      id: 'order-1', order_number: 'P05112026001', status: 'paid', total: 10000, tax_amount: 0,
      customer_id: null, table_number: null, paid_at: null, voided_at: null, void_reason: null,
      order_items: [{ id: 'item-1', product_id: 'product-1', name_snapshot: 'Bread', quantity: 2, line_total: 10000, is_cancelled: false }],
      order_payments: [{ id: 'pay-1', method: 'cash', amount: 10000, reference: null }],
      refunds: [{ total: 5000, refund_lines: [{ order_item_id: 'item-1', qty: 1 }], refund_payments: [{ method: 'cash', amount: 5000 }] }],
    } }, error: null });
    const { result } = renderHook(() => useOrderDetail('P05112026001'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.items[0]?.qty_already_refunded).toBe(1);
    expect(result.current.data?.refunded_by_method.cash).toBe(5000);
    expect(result.current.data?.payments[0]?.amount).toBe(10000);
    expect(rpc).toHaveBeenCalledWith('get_pos_transaction_history_v2', { p_session_id: 'shift-1', p_order_number: 'P05112026001' });
  });

  it('cannot reuse the Owner response after switching to a cashier', async () => {
    rpc.mockResolvedValueOnce({ data: { financial_visible: true, orders: [] }, error: null });
    useAuthStore.setState({ user: { id: 'owner', role_code: 'SUPER_ADMIN', full_name: 'Owner', employee_code: 'O' } });
    const { result } = renderHook(() => useOrderHistory(), { wrapper });
    await waitFor(() => expect(result.current.financialVisible).toBe(true));
    act(() => useAuthStore.setState({ user: { id: 'cashier', role_code: 'CASHIER', full_name: 'Cashier', employee_code: 'C' } }));
    expect(result.current.financialVisible).toBe(false);
    expect(result.current.data).toBeUndefined();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.financialVisible).toBe(false);
  });
});
