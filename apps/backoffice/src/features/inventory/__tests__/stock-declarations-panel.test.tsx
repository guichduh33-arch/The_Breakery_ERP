import { beforeEach, expect, it, vi, type Mock } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StockDeclarationsPanel } from '../components/StockDeclarationsPanel.js';
type Rpc = (fn: string, args?: unknown) => Promise<{ data: unknown; error: { message: string } | null }>;
const mocks = vi.hoisted((): { rpc: Mock<Rpc>; user: { id: string; role_code: string } | null } => ({ rpc: vi.fn<Rpc>(), user: { id: 'owner', role_code: 'SUPER_ADMIN' } }));
vi.mock('@/lib/supabase.js', () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock('@/stores/authStore.js', () => ({ useAuthStore: (select: (s: unknown) => unknown) => select({ user: mocks.user }) }));
const declaration = { id: 'd', operation: 'waste', product_name: 'Flour', product_sku: 'FLOUR', quantity: 1.25,
  reason: 'Damaged bag', unit: 'kg', declared_by: 'cashier', declared_by_name: 'Cashier', status: 'pending', created_at: '2026-10-30T15:00:00Z' };
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><StockDeclarationsPanel /></QueryClientProvider>);
  return client;
}
beforeEach(() => {
  mocks.user = { id: 'owner', role_code: 'SUPER_ADMIN' };
  mocks.rpc.mockReset();
  mocks.rpc.mockImplementation((fn: string) => Promise.resolve({ data: fn === 'get_stock_declarations_v1' ? [declaration] : {}, error: null }));
});
it('shows declared quantity and unit without a baseline or resulting stock', async () => {
  mocks.user = { id: 'cashier', role_code: 'CASHIER' };
  mount();
  await screen.findByText('Flour · FLOUR');
  expect(screen.getByText(/Stock loss · 1.25 kg · pending/)).toBeInTheDocument();
  expect(screen.queryByText(/baseline|expected|resulting stock/i)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Approve Flour' })).not.toBeInTheDocument();
});
it('prevents an Owner from approving their own declaration', async () => {
  mocks.user = { id: 'cashier', role_code: 'SUPER_ADMIN' };
  mount();
  await screen.findByText('Flour · FLOUR');
  expect(screen.queryByRole('button', { name: 'Approve Flour' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Reject Flour' })).not.toBeInTheDocument();
});
it('approves a different declarant and invalidates stock and declaration caches', async () => {
  const client = mount();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  fireEvent.click(await screen.findByRole('button', { name: 'Approve Flour' }));
  await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('approve_stock_declaration_v3', { p_declaration_id: 'd' }));
  await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['stock-declarations'] }));
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['stock-levels'] });
});
it('requires a rejection reason and displays a server refusal', async () => {
  mocks.rpc.mockImplementation((fn: string) => Promise.resolve(fn === 'get_stock_declarations_v1'
    ? { data: [declaration], error: null } : { data: null, error: { message: 'self_approval_forbidden' } }));
  mount();
  const reject = await screen.findByRole('button', { name: 'Reject Flour' });
  expect(reject).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Rejection reason'), { target: { value: 'Count again' } });
  fireEvent.click(reject);
  await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('reject_stock_declaration_v1', { p_declaration_id: 'd', p_reason: 'Count again' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('self_approval_forbidden');
});
it('does not fetch without an authenticated profile', () => {
  mocks.user = null;
  mount();
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it.each(['pending', 'approved', 'rejected'])('explains the display withdrawal for a %s display loss without applying stock client-side', async (status) => {
  mocks.rpc.mockImplementation((fn: string) => Promise.resolve({ data: fn === 'get_stock_declarations_v1'
    ? [{ ...declaration, operation: 'display_waste', status, display_withdrawal_applied: true }]
    : {}, error: null }));
  mount();
  expect(await screen.findByText(/Display quantity already removed/)).toHaveTextContent('Rejection does not restore the display quantity.');
  expect(mocks.rpc.mock.calls.every(([fn]) => fn === 'get_stock_declarations_v1')).toBe(true);
});
it('keeps a legacy display loss distinct from a withdrawal already applied', async () => {
  mocks.rpc.mockResolvedValue({ data: [{ ...declaration, operation: 'display_waste', display_withdrawal_applied: false }], error: null });
  mount();
  expect(await screen.findByText('Display withdrawal has not been applied.')).toBeInTheDocument();
  expect(screen.queryByText(/Display quantity already removed/)).not.toBeInTheDocument();
});
