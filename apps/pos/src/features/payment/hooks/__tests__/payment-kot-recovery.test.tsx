import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { setSupabaseAccessToken, setSupabaseCloudEnabled } from '@breakery/supabase';
import { usePaymentFlowLogic } from '../usePaymentFlowLogic';
import { usePaymentStore } from '@/stores/paymentStore';
import type { PaymentAttempt } from '@/stores/paymentAttempt';
import { readPaymentAttempt } from '@/stores/paymentAttempt';
import { useCartStore } from '@/stores/cartStore';
import { useAuthStore } from '@/stores/authStore';
import { useShiftStore } from '@/stores/shiftStore';
import { useCloudStatusStore } from '@/features/lan/cloudStatusStore';
import { runPrintJob, usePrintJobs } from '@/services/print/printJobs';
import type * as PrintService from '@/services/print/printService';
import { installPrintLocks } from '@/services/print/__tests__/printBrowser';
import type { StationPrintersMap } from '@/features/cart/hooks/useStationPrinters';
import { toast } from 'sonner';

const paper = vi.hoisted(() => vi.fn());
// Les hooks de paiement, de fire, de configuration et le journal restent réels.
vi.mock('@/services/print/printService', async (original) => ({
  ...await original<typeof PrintService>(), printStationTicket: paper,
}));
const paid = { orderId: 'order', orderNumber: 'P-42', total: 25000, taxAmount: 0,
  changeGiven: 0, pointsEarned: 0, paymentMethod: 'cash' as const, cashReceived: 25000, customerName: undefined };
const snapshot = (): PaymentAttempt => ({ version: 1, state: 'unknown', stationPrinting: 'prepared', offline: false,
  cart: { order_type: 'take_out', items: [{ id: 'saved-line', product_id: 'coffee', name: 'Saved coffee', quantity: 1, unit_price: 25000, modifiers: [] }] },
  tenders: [{ method: 'cash', amount: 25000, cash_received: 25000 }], customer: null, taxRate: 0, taxInclusive: true,
  context: { idempotencyKey: '11111111-2222-4333-8444-555555555555', appendUuid: 'append', userId: 'cashier', sessionId: 'shift',
    pickedUpOrderId: null, orderOrigin: null, printedItemIds: [], lockedItemIds: [], appliedPromotions: [] } });
let injectedClient: QueryClient | null = null;
function makeClient(printers = true) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  qc.setQueryData(['business-config', 'tax-config'], { taxRate: 0, taxInclusive: true });
  qc.setQueryData(['business-config', 'enabled-payment-methods'], ['cash']);
  qc.setQueryData(['business-config', 'offline-network'], { offlinePaymentsEnabled: false });
  qc.setQueryData(['business-config', 'kot-copies'], { kitchen: 1, barista: 1, display: 1 });
  qc.setQueryData(['pos-presets'], { quickPayments: [25000], openingCashPresets: [], discountPresets: [] });
  qc.setQueryData(['station-map'], { coffee: ['kitchen'] });
  if (printers) qc.setQueryData(['station-printers'], new Map([['kitchen', { ip_address: '127.0.0.1', port: 9100, name: 'Kitchen' }]]));
  return qc;
}
function wrapper({ children }: { children: ReactNode }) {
  const qc = injectedClient ?? makeClient();
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}
beforeEach(() => {
  vi.restoreAllMocks(); localStorage.clear(); sessionStorage.clear(); paper.mockReset().mockResolvedValue({ success: true });
  injectedClient = null; installPrintLocks();
  usePrintJobs.setState({ jobs: [] }); usePaymentStore.getState().reset();
  useAuthStore.setState({ user: { id: 'cashier', full_name: 'Cashier', role_code: 'CASHIER', employee_code: 'C' }, sessionToken: 'test-jwt',
    isAuthenticated: true, isLoading: false, isLocked: false, cloudValidated: true });
  setSupabaseAccessToken('test-jwt'); setSupabaseCloudEnabled(true); useCloudStatusStore.setState({ cloudOnline: true });
  useShiftStore.setState({ current: { id: 'shift', opened_at: '', opening_cash: 0 } });
  useCartStore.setState({ cart: { items: [], order_type: 'take_out' }, printedItemIds: [], lockedItemIds: [], pickedUpOrderId: null });
});
describe('payment → actual fire hook → durable print journal', () => {
  it('recovers the paid server items for a confirmed legacy gift attempt without charging again', async () => {
    const value = snapshot();
    value.cart.items.push({ id: 'old-gift', product_id: 'gift', name: 'Old estimate', quantity: 99,
      unit_price: 0, modifiers: [], is_promo_gift: true, promotion_id: 'promotion' });
    injectedClient = makeClient();
    injectedClient.setQueryData(['station-map'], { coffee: ['kitchen'], gift: ['kitchen'] });
    usePaymentStore.getState().beginAttempt({ ...value, state: 'confirmed', result: paid });
    const http = vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      const address = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
      if (!address.endsWith('/rest/v1/rpc/get_pos_order_snapshot_v3')) throw new Error('Unexpected payment write');
      return Promise.resolve(new Response(JSON.stringify({ order_id: 'order', order_type: 'take_out',
        customerId: null, tableNumber: null, notes: null, items: [
          { id: 'coffee-row', product_id: 'coffee', name: 'Paid coffee', quantity: 1, unit_price: 25000,
            modifiers: [], is_locked: true, kitchen_status: 'pending' },
          { id: 'gift-row', product_id: 'gift', name: 'Legacy paid gift', quantity: 1, unit_price: 0,
            modifiers: [], is_locked: true, kitchen_status: 'pending', is_promo_gift: true, promotion_id: 'promotion' },
        ] }), { status: 200 }));
    });
    const first = renderHook(usePaymentFlowLogic, { wrapper });
    await waitFor(() => expect(paper).toHaveBeenCalledTimes(1));
    expect(http).toHaveBeenCalledTimes(1);
    expect(paper.mock.calls[0]?.[1]).toMatchObject({ items: [
      { name: 'Paid coffee', quantity: 1 }, { name: 'Legacy paid gift', quantity: 1 },
    ] });
    expect(readPaymentAttempt()?.result?.paidItems?.[1]?.quantity).toBe(1);
    first.unmount();
    const second = renderHook(usePaymentFlowLogic, { wrapper });
    await act(async () => { await Promise.resolve(); });
    expect(paper).toHaveBeenCalledTimes(1);
    second.unmount();
  });
  it('prints and persists server-awarded gifts instead of provisional cart gifts', async () => {
    const value = snapshot();
    value.cart.items.push({ id: 'estimate', product_id: 'gift', name: 'Unconfirmed gift', quantity: 99,
      unit_price: 0, modifiers: [], is_promo_gift: true, promotion_id: 'promotion' });
    injectedClient = makeClient();
    injectedClient.setQueryData(['station-map'], { coffee: ['kitchen'], gift: ['kitchen'] });
    usePaymentStore.getState().beginAttempt(value);
    const http = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      order_id: 'order', order_number: 'P-42', total: 25000, tax_amount: 0, change_given: 0,
      order_snapshot: { order_id: 'order', order_type: 'take_out', customerId: null, tableNumber: null, notes: null,
        items: [
          { id: 'coffee-row', product_id: 'coffee', name: 'Paid coffee', quantity: 1, unit_price: 25000,
            modifiers: [], is_locked: true, kitchen_status: 'pending' },
          { id: 'gift-row', product_id: 'gift', name: 'Awarded gift', quantity: 2, unit_price: 0,
            modifiers: [], is_locked: true, kitchen_status: 'pending', is_promo_gift: true, promotion_id: 'promotion' },
        ] },
    }), { status: 200 }));
    const first = renderHook(usePaymentFlowLogic, { wrapper });
    await act(async () => { await first.result.current.handleProcess(); });
    await waitFor(() => expect(paper).toHaveBeenCalledTimes(1));
    expect(paper.mock.calls[0]?.[1]).toMatchObject({ items: [
      { name: 'Paid coffee', quantity: 1 }, { name: 'Awarded gift', quantity: 2 },
    ] });
    const shippedBody = http.mock.calls[0]?.[1]?.body;
    if (typeof shippedBody !== 'string') throw new Error('Expected a JSON payment body');
    const shipped = JSON.parse(shippedBody) as { items: unknown[] };
    expect(shipped.items).toHaveLength(1);
    expect(readPaymentAttempt()?.result?.paidItems?.[1]).toMatchObject({
      server_id: 'gift-row', quantity: 2, is_promo_gift: true, promotion_id: 'promotion',
    });
    expect(first.result.current.cart.items[1]?.quantity).toBe(2);
    first.unmount();
    const second = renderHook(usePaymentFlowLogic, { wrapper });
    await act(async () => { await Promise.resolve(); });
    expect(paper).toHaveBeenCalledTimes(1);
    second.unmount();
  });
  it('waits for an in-flight printer query from a cold cache before creating any job', async () => {
    const qc = makeClient(false); injectedClient = qc;
    let finish!: (value: StationPrintersMap) => void;
    const lookup = qc.fetchQuery({ queryKey: ['station-printers'], queryFn: () => new Promise<StationPrintersMap>((resolve) => { finish = resolve; }) });
    usePaymentStore.getState().beginAttempt({ ...snapshot(), state: 'confirmed', result: paid });
    const mounted = renderHook(usePaymentFlowLogic, { wrapper });
    await act(async () => { await Promise.resolve(); });
    expect(paper).not.toHaveBeenCalled(); expect(usePrintJobs.getState().jobs).toEqual([]);
    await act(async () => { finish(new Map([['kitchen', { ip_address: '127.0.0.1', port: 9100, name: 'Kitchen' }]])); await lookup; });
    await waitFor(() => expect(usePrintJobs.getState().jobs[0]?.status).toBe('confirmed'));
    expect(paper).toHaveBeenCalledTimes(1); mounted.unmount();
  });
  it('surfaces a real printer lookup failure without fabricating an UNKNOWN job', async () => {
    const qc = makeClient(false); injectedClient = qc;
    let fail!: (reason: Error) => void;
    const lookup = qc.fetchQuery({ queryKey: ['station-printers'], queryFn: () => new Promise<StationPrintersMap>((_resolve, reject) => { fail = reject; }) });
    const rejected = expect(lookup).rejects.toThrow('Printer lookup unavailable');
    const error = vi.spyOn(toast, 'error');
    usePaymentStore.getState().beginAttempt({ ...snapshot(), state: 'confirmed', result: paid });
    const mounted = renderHook(usePaymentFlowLogic, { wrapper });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { fail(new Error('Printer lookup unavailable')); await rejected; });
    await waitFor(() => expect(error).toHaveBeenCalledWith('Station print failed: Printer lookup unavailable'));
    expect(paper).not.toHaveBeenCalled(); expect(usePrintJobs.getState().jobs).toEqual([]); mounted.unmount();
  });
  it('replays the online payment, prints its saved lines despite an empty live cart and deduplicates remounts', async () => {
    usePaymentStore.getState().beginAttempt(snapshot());
    const http = vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      const address = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
      if (!address.endsWith('/functions/v1/process-payment')) throw new Error(`Unexpected network request: ${address}`);
      return Promise.resolve(new Response(JSON.stringify({ order_id: 'order', order_number: 'P-42', total: 25000, tax_amount: 0,
        change_given: 0, idempotent_replay: true }), { status: 200 }));
    });
    const first = renderHook(usePaymentFlowLogic, { wrapper });
    await act(async () => { await first.result.current.handleProcess(); });
    await waitFor(() => expect(paper).toHaveBeenCalledTimes(1));
    expect(http).toHaveBeenCalledTimes(1);
    expect(paper.mock.calls[0]?.[1]).toMatchObject({ order_number: 'P-42', items: [{ name: 'Saved coffee', quantity: 1 }] });
    expect(useCartStore.getState().cart.items).toEqual([]);
    const saved = readPaymentAttempt(); first.unmount();
    usePaymentStore.setState({ attempt: saved });
    const second = renderHook(usePaymentFlowLogic, { wrapper });
    await waitFor(() => expect(usePrintJobs.getState().jobs[0]?.status).toBe('confirmed'));
    await act(async () => { await Promise.resolve(); });
    expect(paper).toHaveBeenCalledTimes(1); second.unmount();
  });
  it('keeps unknown paper status and only an explicit duplicate gesture prints again', async () => {
    paper.mockResolvedValue({ success: false, error: 'ACK lost' });
    const value = { ...snapshot(), state: 'confirmed' as const, result: paid };
    usePaymentStore.getState().beginAttempt(value);
    const first = renderHook(usePaymentFlowLogic, { wrapper });
    await waitFor(() => expect(usePrintJobs.getState().jobs[0]?.status).toBe('unknown')); first.unmount();
    const second = renderHook(usePaymentFlowLogic, { wrapper });
    await act(async () => { await Promise.resolve(); }); expect(paper).toHaveBeenCalledTimes(1);
    const job = usePrintJobs.getState().jobs[0]!; paper.mockResolvedValue({ success: true });
    await act(async () => { await runPrintJob(job.payload, { ip_address: '127.0.0.1', port: 9100 }, 1, job); });
    expect(paper.mock.calls[1]?.[1]).toMatchObject({ duplicate: true }); second.unmount();
  });
  it('never automatically prints an old confirmed attempt without the preparation marker', async () => {
    const value = snapshot(); delete value.stationPrinting;
    usePaymentStore.getState().beginAttempt({ ...value, state: 'confirmed', result: paid });
    const mounted = renderHook(usePaymentFlowLogic, { wrapper });
    await act(async () => { await Promise.resolve(); }); expect(paper).not.toHaveBeenCalled(); mounted.unmount();
  });
});
