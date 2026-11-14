import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DisplayDayClosingModal } from '../components/DisplayDayClosingModal';
import { useAuthStore } from '@/stores/authStore';
import { financialStorageKey, todayIsoDate } from '@breakery/utils';
import { displayDayError } from '../hooks/useDisplayDayClosing';

interface RpcResult { data: unknown; error: { message: string; code?: string } | null }
const api = vi.hoisted(() => ({ rpc: vi.fn<(name: string, args?: Record<string, unknown>) => Promise<RpcResult>>(),
  recorded: null as Record<string, unknown> | null, loseResponse: false,
  submitError: null as { message: string; code?: string } | null }));
const profile = '11111111-1111-4111-8111-111111111111';
const product = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const closingId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
vi.mock('@/lib/supabase', () => ({ supabaseUrl: 'https://ikcyvlovptebroadgtvd.supabase.co', supabase: { rpc: api.rpc } }));

function savedRecord(remaining = 5, wasteReason = 'Damaged pieces') {
  return { closing_id: closingId, business_day: todayIsoDate(), revision: 1,
    recorded_by: profile, recorded_at: new Date().toISOString(),
    items: [{ product_id: product, product_name: 'Croissant', unit: 'pcs', remaining_qty: remaining,
      waste_qty: 2, waste_reason: wasteReason, waste_status: 'pending', expected_qty: 888, variance: -883 }],
    history: [{ revision: 1, recorded_at: new Date().toISOString(), correction_reason: null }] };
}
function mount() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}><DisplayDayClosingModal onClose={vi.fn()} /></QueryClientProvider>);
}
async function enterCount(reason = 'damaged') {
  await screen.findByRole('heading', { name: /Croissant/ });
  fireEvent.change(screen.getByLabelText('Remaining — Croissant'), { target: { value: '5' } });
  fireEvent.change(screen.getByLabelText('Waste — Croissant'), { target: { value: '2' } });
  fireEvent.change(await screen.findByLabelText('Waste reason — Croissant'), { target: { value: reason } });
}
const legacyKey = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
/** Tentative en attente écrite par une caisse d'avant la liste fermée (texte libre, sans note). */
function storeLegacyPending(wasteReason: string) {
  const scope = { environment: 'https://ikcyvlovptebroadgtvd.supabase.co', profileId: profile,
    operation: 'display-day-count', target: todayIsoDate() };
  localStorage.setItem(financialStorageKey(scope), JSON.stringify({ version: 1, revision: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    operation: 'display-day-count', target: todayIsoDate(), status: 'pending', idempotencyKey: legacyKey,
    payload: { businessDay: todayIsoDate(), closingId: null, correctionReason: '',
      items: [{ product_id: product, remaining_qty: 5, waste_qty: 2, waste_reason: wasteReason }] } }));
}
beforeEach(() => {
  localStorage.clear();
  api.recorded = null;
  api.loseResponse = false;
  api.submitError = null;
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
    if (name === 'get_display_day_closing_v2') return Promise.resolve({ data: api.recorded, error: null });
    if (name === 'submit_display_day_closing_v2') {
      if (api.submitError) return Promise.resolve({ data: null, error: api.submitError });
      const replay = api.recorded !== null;
      api.recorded = savedRecord();
      if (api.loseResponse) { api.loseResponse = false; return Promise.resolve({ data: null, error: { message: 'Network response lost', code: 'NETWORK' } }); }
      return Promise.resolve({ data: { closing_id: closingId, business_day: todayIsoDate(), revision: 1, idempotent_replay: replay }, error: null });
    }
    if (name === 'correct_display_day_count_v2') {
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
    const submission = api.rpc.mock.calls.find(([name]) => name === 'submit_display_day_closing_v2');
    expect(submission?.[1]).toEqual(expect.objectContaining({ p_business_day: todayIsoDate(),
      p_items: [{ product_id: product, remaining_qty: 5, waste_qty: 2, waste_reason: 'damaged', waste_note: null }] }));
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
    const original = api.rpc.mock.calls.find(([name]) => name === 'submit_display_day_closing_v2')?.[1];
    first.unmount();
    mount();
    const retry = await screen.findByRole('button', { name: 'Retry same count' });
    expect(await screen.findByLabelText('Remaining — Croissant')).toBeDisabled();
    fireEvent.click(retry);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry same count' })).not.toBeInTheDocument());
    const submissions = api.rpc.mock.calls.filter(([name]) => name === 'submit_display_day_closing_v2');
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
    await waitFor(() => expect(api.rpc).toHaveBeenCalledWith('correct_display_day_count_v2', expect.objectContaining({
      p_closing_id: closingId, p_counts: [{ product_id: product, remaining_qty: 6 }],
      p_reason: 'Second physical count',
    })));
    expect(api.rpc.mock.calls.some(([name]) => name === 'submit_display_day_closing_v2')).toBe(false);
  });
  it('feeds each waste row from the closed list and blocks Other without a note', async () => {
    mount();
    await enterCount('other');
    const submit = screen.getByRole('button', { name: 'Record end-of-day count' });
    const select = screen.getByLabelText<HTMLSelectElement>('Waste reason — Croissant');
    expect(Array.from(select.options).map((option) => option.value)).toEqual(['', 'mis_baked', 'poor_proofing',
      'cosmetic', 'demo', 'recipe_test', 'tasting', 'expired', 'leftover', 'damaged', 'other']);
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Note (required) — Croissant'), { target: { value: 'ab' } });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Note (required) — Croissant'), { target: { value: ' Fell on the floor ' } });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    await screen.findByText(/Recorded · revision 1/);
    const submission = api.rpc.mock.calls.find(([name]) => name === 'submit_display_day_closing_v2');
    expect(submission?.[1]?.p_items).toEqual([{ product_id: product, remaining_qty: 5, waste_qty: 2,
      waste_reason: 'other', waste_note: 'Fell on the floor' }]);
  });
  it('shows a recorded reason read-only: a code by its label, an old free text as it is', async () => {
    api.recorded = savedRecord(5, 'expired');
    const first = mount();
    expect(await screen.findByText('Expired')).toBeInTheDocument();
    expect(screen.queryByLabelText('Waste reason — Croissant')).not.toBeInTheDocument();
    first.unmount();
    api.recorded = savedRecord();
    mount();
    expect(await screen.findByText('Damaged pieces')).toBeInTheDocument();
    expect(screen.getByLabelText('Remaining — Croissant')).toBeDisabled();
  });
  it('keeps an old-shape pending count readable and retries it in the new shape with the same key', async () => {
    storeLegacyPending('Damaged pieces');
    mount();
    const retry = await screen.findByRole('button', { name: 'Retry same count' });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(await screen.findByLabelText('Waste reason — Croissant')).toHaveValue('other');
    expect(screen.getByLabelText('Note (required) — Croissant')).toHaveValue('Damaged pieces');
    expect(screen.getByLabelText('Remaining — Croissant')).toBeDisabled();
    fireEvent.click(retry);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry same count' })).not.toBeInTheDocument());
    const submission = api.rpc.mock.calls.find(([name]) => name === 'submit_display_day_closing_v2');
    expect(submission?.[1]).toEqual({ p_business_day: todayIsoDate(), p_idempotency_key: legacyKey,
      p_items: [{ product_id: product, remaining_qty: 5, waste_qty: 2, waste_reason: 'other', waste_note: 'Damaged pieces' }] });
  });
  it('maps an old-shape free text equal to a code back to that code', async () => {
    storeLegacyPending('expired');
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Retry same count' }));
    await waitFor(() => expect(api.rpc).toHaveBeenCalledWith('submit_display_day_closing_v2', expect.objectContaining({
      p_items: [{ product_id: product, remaining_qty: 5, waste_qty: 2, waste_reason: 'expired', waste_note: null }] })));
  });
  it('explains a definitive refusal of an old-shape retry and keeps the attempt for review', async () => {
    storeLegacyPending('Damaged pieces');
    api.submitError = { message: 'idempotency_conflict', code: '22023' };
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Retry same count' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('already recorded with different details');
    expect(screen.getByRole('button', { name: 'Retry same count' })).toBeInTheDocument();
  });
  it('maps the closed-list refusal to a clear message', () => {
    expect(displayDayError('invalid_display_quantity_or_reason')).toMatch(/reason from the list/);
  });
});
