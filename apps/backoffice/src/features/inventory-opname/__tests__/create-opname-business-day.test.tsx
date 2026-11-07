import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CreateOpnameModal } from '../components/CreateOpnameModal.js';
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase.js', () => ({ supabase: { rpc: mocks.rpc } }));
beforeEach(() => { mocks.rpc.mockReset(); mocks.rpc.mockResolvedValue({ data: { count_id: 'count', count_number: 'OPN1', status: 'counting' }, error: null }); });
function mount() {
  const created = vi.fn();
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
    <CreateOpnameModal onCreated={created} onClose={vi.fn()} />
  </QueryClientProvider>);
  return created;
}
it('persists the explicitly selected day rather than deriving it from creation time', async () => {
  const created = mount();
  fireEvent.change(screen.getByLabelText('Business day'), { target: { value: '2026-10-01' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create count' }));
  await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('create_opname_v3', expect.objectContaining({ p_business_day: '2026-10-01' })));
  const args: unknown = mocks.rpc.mock.calls[0]?.[1];
  expect(args).toHaveProperty('p_idempotency_key');
  await waitFor(() => expect(created).toHaveBeenCalledWith('count'));
});
it('requires a business day before creation', () => {
  mount();
  fireEvent.change(screen.getByLabelText('Business day'), { target: { value: '' } });
  expect(screen.getByRole('button', { name: 'Create count' })).toBeDisabled();
  expect(mocks.rpc).not.toHaveBeenCalled();
});
