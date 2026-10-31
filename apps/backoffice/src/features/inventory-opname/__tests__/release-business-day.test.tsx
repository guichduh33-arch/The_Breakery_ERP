import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReleaseBusinessDay } from '../components/ReleaseBusinessDay.js';
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase.js', () => ({ supabase: { rpc: mocks.rpc } }));
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><ReleaseBusinessDay countId="count" businessDay="2026-10-30" /></QueryClientProvider>);
  return client;
}
beforeEach(() => { mocks.rpc.mockReset(); mocks.rpc.mockResolvedValue({ data: { released: false }, error: null }); });
it('uses the count business day after midnight and requires deliberate confirmation', async () => {
  const client = mount();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const button = screen.getByRole('button', { name: 'Release product sales' });
  expect(button).toBeDisabled();
  expect(screen.getByLabelText('Business day')).toHaveValue('2026-10-30');
  expect(screen.getByLabelText('Business day')).toHaveAttribute('readonly');
  await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('get_business_day_visibility_v1', { p_day: '2026-10-30' }));
  fireEvent.click(screen.getByRole('checkbox'));
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('release_business_day_v1', { p_day: '2026-10-30', p_count_id: 'count' }));
  await waitFor(() => expect(invalidate).toHaveBeenCalled());
  expect(screen.getByRole('checkbox')).not.toBeChecked();
});
it('shows an open-register refusal and does not claim release succeeded', async () => {
  mocks.rpc.mockImplementation((fn: string) => Promise.resolve(fn === 'release_business_day_v1'
    ? { error: { message: 'registers_still_open' } } : { data: { released: false }, error: null }));
  mount();
  fireEvent.click(screen.getByRole('checkbox'));
  const button = screen.getByRole('button', { name: 'Release product sales' });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  expect(await screen.findByRole('alert')).toHaveTextContent('registers_still_open');
  expect(screen.queryByText('Sales have been released for this day.')).not.toBeInTheDocument();
});
it('blocks release when visibility cannot be verified', async () => {
  mocks.rpc.mockResolvedValue({ data: null, error: { message: 'forbidden' } });
  mount();
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('checkbox'));
  expect(screen.getByRole('button', { name: 'Release product sales' })).toBeDisabled();
  expect(mocks.rpc.mock.calls.every((c) => c[0] === 'get_business_day_visibility_v1')).toBe(true);
});
it('does not offer a second release for a day already released', async () => {
  mocks.rpc.mockResolvedValue({ data: { released: true }, error: null });
  mount();
  await screen.findByText('Sales have been released for this day.');
  expect(screen.queryByRole('button', { name: 'Release product sales' })).not.toBeInTheDocument();
});

it.each([null, {}, { released: 'yes' }])('does not enable release on an invalid visibility payload: %j', async (data) => {
  mocks.rpc.mockResolvedValue({ data, error: null });
  mount();
  expect(await screen.findByRole('alert')).toHaveTextContent('Cannot verify daily sales visibility.');
  fireEvent.click(screen.getByRole('checkbox'));
  expect(screen.getByRole('button', { name: 'Release product sales' })).toBeDisabled();
});
