import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DisplayDayReviewPanel } from '../components/DisplayDayReviewPanel.js';

const state = vi.hoisted(() => ({ role: 'ADMIN', rpc: vi.fn() }));
vi.mock('@/stores/authStore.js', () => ({ useAuthStore: (selector: (value: unknown) => unknown) =>
  selector({ user: { id: 'profile', role_code: state.role } }) }));
vi.mock('@/lib/supabase.js', () => ({ supabase: { rpc: state.rpc } }));
function mount() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={queryClient}><DisplayDayReviewPanel /></QueryClientProvider>);
}
beforeEach(() => { state.role = 'ADMIN'; state.rpc.mockReset(); });
describe('Confidential daily display review', () => {
  it('does not request or render theoretical quantities for ADMIN', async () => {
    mount();
    await waitFor(() => expect(state.rpc).not.toHaveBeenCalled());
    expect(screen.queryByRole('heading', { name: 'Daily display review' })).not.toBeInTheDocument();
  });
  it('shows the frozen reference, variance and waste approval to the Owner', async () => {
    state.role = 'SUPER_ADMIN';
    state.rpc.mockResolvedValue({ data: { is_owner: true, closing_id: 'closing', revision: 1,
      recorded_at: '2026-11-05T12:00:00Z', history: [], items: [{ product_id: 'product', product_name: 'Brown Bread',
        unit: 'pcs', reference_basis: 'fresh_production', expected_qty: 8, remaining_qty: 6, variance: -2,
        waste_qty: 1, waste_reason: 'Damaged', waste_status: 'pending' }] }, error: null });
    mount();
    expect(await screen.findByText('Fresh production of the day')).toBeInTheDocument();
    expect(screen.getByText('Brown Bread')).toBeInTheDocument();
    expect(screen.getByText('pending')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Variance' })).toBeInTheDocument();
  });
});
