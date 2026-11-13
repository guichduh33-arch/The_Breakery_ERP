import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DisplayDayClosingModal } from '../components/DisplayDayClosingModal';
import { useAuthStore } from '@/stores/authStore';
import { todayIsoDate } from '@breakery/utils';

interface RpcResult { data: unknown; error: { message: string; code?: string } | null }
const api = vi.hoisted(() => ({ rpc: vi.fn<(name: string, args?: Record<string, unknown>) => Promise<RpcResult>>(),
  recorded: null as Record<string, unknown> | null, loseResponse: false }));
const profile = '11111111-1111-4111-8111-111111111111';
const product = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const closingId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
vi.mock('@/lib/supabase', () => ({ supabaseUrl: 'https://ikcyvlovptebroadgtvd.supabase.co', supabase: { rpc: api.rpc } }));

function savedRecord(remaining = 5) {
  return { closing_id: closingId, business_day: todayIsoDate(), revision: 1,
    recorded_by: profile, recorded_at: new Date().toISOString(),
    items: [{ product_id: product, product_name: 'Croissant', unit: 'pcs', remaining_qty: remaining,
      waste_qty: 2, waste_reason: 'Damaged pieces', waste_status: 'pending', expected_qty: 888, variance: -883 }],
    history: [{ revision: 1, recorded_at: new Date().toISOString(), correction_reason: null }] };
}
function mount() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}><DisplayDayClosingModal onClose={vi.fn()} /></QueryClientProvider>);
}
async function enterCount() {
  await screen.findByRole('heading', { name: /Croissant/ });
  fireEvent.change(screen.getByLabelText('Remaining — Croissant'), { target: { value: '5' } });
  fireEvent.change(screen.getByLabelText('Waste — Croissant'), { target: { value: '2' } });
  fireEvent.change(await screen.findByLabelText('Waste reason — Croissant'), { target: { value: 'Damaged pieces' } });
}
beforeEach(() => {
  localStorage.clear();
  api.recorded = null;
  api.loseResponse = false;
  api.rpc.mockReset();
  useAuthStore.setState({ user: { id: profile, full_name: 'Cashier', employee_code: 'C', role_code: 'CASHIER' },
    permissions: ['display.count'], sessionToken: 'session', isAuthenticated: true, isLocked: false, cloudValidated: true });
  Object.defineProperty(navigator, 'locks', { configurable: true, value: {
    request: vi.fn((_name: string, _options: unknown, callback: (lock: { mode: 'exclusive' }) => Promise<unknown>) => callback({ mode: 'exclusive' })),
  } });
  api.rpc.mockImplementation((name: string, args: Record<string, unknown> = {}) => {
    if (name === 'get_operational_products_v3') return Promise.resolve({ data: [{ id: product, name: 'Croissant', sku: 'CLV-007',
      unit: 'pcs', is_active: true, is_display_item: true, current_stock: null, is_sellable: true,
      display_stock: { quantity: null }, categories: null, category_id: null, min_stock_threshold: 0, retail_price: 10000 }], error: null });
    if (name === 'get_display_day_closing_v1') return Promise.resolve({ data: api.recorded, error: null });
    if (name === 'submit_display_day_closing_v1') {
      const replay = api.recorded !== null;
      api.recorded = savedRecord();
      if (api.loseResponse) { api.loseResponse = false; return Promise.resolve({ data: null, error: { message: 'Network response lost', code: 'NETWORK' } }); }
      return Promise.resolve({ data: { closing_id: closingId, business_day: todayIsoDate(), revision: 1, idempotent_replay: replay }, error: null });
    }
    if (name === 'correct_display_day_count_v1') {
      api.recorded = { ...savedRecord(6), closing_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', revision: 2 };
      return Promise.resolve({ data: { closing_id: api.recorded.closing_id, business_day: todayIsoDate(), revision: 2, idempotent_replay: false }, error: null });
    }
    throw new Error(`Unexpected write or read ${name}: ${JSON.stringify(args)}`);
  });
});

describe('End-of-day display observations', () => {
  it('keeps the count blind and submits leftovers and waste through one dedicated declaration', async () => {
    mount();
    await screen.findByRole('heading', { name: /Croissant/ });
    expect(screen.getByLabelText('Remaining — Croissant')).toHaveValue(null);
    await enterCount();
    fireEvent.click(screen.getByRole('button', { name: 'Record end-of-day count' }));
    await screen.findByText(/Recorded · revision 1/);
    const submission = api.rpc.mock.calls.find(([name]) => name === 'submit_display_day_closing_v1');
    expect(submission?.[1]).toEqual(expect.objectContaining({ p_business_day: todayIsoDate(),
      p_items: [{ product_id: product, remaining_qty: 5, waste_qty: 2, waste_reason: 'Damaged pieces' }] }));
    expect(typeof submission?.[1]?.p_idempotency_key).toBe('string');
    expect(screen.queryByText('888')).not.toBeInTheDocument();
    expect(screen.queryByText('-883')).not.toBeInTheDocument();
    expect(api.rpc.mock.calls.some(([name]) => /adjust|approve|finalize|close_shift/.test(name))).toBe(false);
  });
  it('recovers a lost response after remount with exactly the same payload and key', async () => {
    api.loseResponse = true;
    const first = mount();
    await enterCount();
    fireEvent.click(screen.getByRole('button', { name: 'Record end-of-day count' }));
    await screen.findByRole('button', { name: 'Retry same count' });
    const original = api.rpc.mock.calls.find(([name]) => name === 'submit_display_day_closing_v1')?.[1];
    first.unmount();
    mount();
    const retry = await screen.findByRole('button', { name: 'Retry same count' });
    expect(await screen.findByLabelText('Remaining — Croissant')).toBeDisabled();
    fireEvent.click(retry);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry same count' })).not.toBeInTheDocument());
    const submissions = api.rpc.mock.calls.filter(([name]) => name === 'submit_display_day_closing_v1');
    expect(submissions).toHaveLength(2);
    expect(submissions[1]?.[1]).toEqual(original);
  });
  it('corrects remaining counts by revision without resubmitting waste', async () => {
    api.recorded = savedRecord();
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Correct remaining counts' }));
    expect(screen.getByLabelText('Waste — Croissant')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Remaining — Croissant'), { target: { value: '6' } });
    fireEvent.change(screen.getByLabelText('Correction reason'), { target: { value: 'Second physical count' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record correction' }));
    await waitFor(() => expect(api.rpc).toHaveBeenCalledWith('correct_display_day_count_v1', expect.objectContaining({
      p_closing_id: closingId, p_counts: [{ product_id: product, remaining_qty: 6 }],
      p_reason: 'Second physical count',
    })));
    expect(api.rpc.mock.calls.some(([name]) => name === 'submit_display_day_closing_v1')).toBe(false);
  });
});
