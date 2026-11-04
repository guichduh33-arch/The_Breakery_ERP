import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import type { ReactNode } from 'react';
import { usePoInvoice } from '../hooks/usePoInvoice.js';
import { PoInvoiceUploader } from '../components/PoInvoiceUploader.js';
import { PoInvoicePanel } from '../components/PoInvoicePanel.js';
import type { PurchaseOrderDetail } from '../hooks/usePurchaseOrderDetail.js';
import { invoiceFileDigest } from '@/lib/invoiceFiles.js';
import { deferred, financialTestAuth, installFinancialBrowser, resetFinancialSession } from '@/lib/__tests__/financialAttemptTestUtils.js';
import { readFinancialSlot } from '@/lib/pendingFinancialAttempts.js';

const { rpc, upload, download } = vi.hoisted(() => ({ rpc: vi.fn(), upload: vi.fn(), download: vi.fn() }));
vi.mock('@/lib/supabase.js', () => ({ supabase: { rpc, functions: { invoke: download }, storage: { from: () => ({ upload }) } } }));
vi.mock('@/stores/authStore.js', async () => ({ useAuthStore: (await import('@/lib/__tests__/financialAttemptTestUtils.js')).financialTestAuth }));
const poId = '00000000-0000-4000-8000-000000000001';
const scope = { environment: import.meta.env.VITE_SUPABASE_URL as string, profileId: 'profile-a', operation: 'po_invoice' as const, target: poId };
function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}
function file(content = 'invoice', type = 'application/pdf') {
  const f = new File([content], 'untrusted.exe', { type });
  Object.defineProperty(f, 'arrayBuffer', { configurable: true, value: () => Promise.resolve(new TextEncoder().encode(content).buffer) });
  return f;
}
async function snapshot(f: File) { return { poId, expectedPath: null, kind: 'attach' as const, mime: 'application/pdf' as const, size: f.size, sha256: await invoiceFileDigest(f) }; }
const po = { id: poId, status: 'pending', invoice_path: 'purchase-orders/' + poId + '/invoice.pdf', invoice_exempt: false } as PurchaseOrderDetail;
describe('purchase invoice durable recovery', () => {
  beforeEach(() => {
    vi.restoreAllMocks(); installFinancialBrowser(); resetFinancialSession(); rpc.mockReset(); upload.mockReset(); download.mockReset();
    vi.stubGlobal('crypto', webcrypto);
    rpc.mockImplementation((_name: string, args: Record<string, unknown>) => Promise.resolve({
      data: { po_id: args.p_po_id, invoice_path: args.p_storage_path ?? null, applied: true, idempotent_replay: false }, error: null,
    }));
    upload.mockResolvedValue({ data: {}, error: null });
  });
  it('checks first and uploads only the missing object with a durable UUID and no upsert', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0002', message: 'invoice_object_not_found' } });
    const selected = file(), input = await snapshot(selected);
    const view = renderHook(() => usePoInvoice(poId), { wrapper });
    await act(async () => { await view.result.current.submit(input, selected); });
    expect(rpc).toHaveBeenCalledTimes(2); expect(upload).toHaveBeenCalledOnce();
    expect(upload.mock.calls[0]![0]).toMatch(new RegExp('^purchase-orders/' + poId + '/[a-f0-9-]+[.]pdf$'));
    expect(upload.mock.calls[0]![2]).toEqual({ upsert: false, contentType: 'application/pdf' });
    expect(rpc.mock.calls[1]).toEqual(rpc.mock.calls[0]); expect(readFinancialSlot(scope)?.status).toBe('resolved');
  });
  it('replays an upload whose response was lost after reopening without another upload', async () => {
    rpc.mockRejectedValueOnce(new TypeError('Response lost')); const input = await snapshot(file());
    const first = renderHook(() => usePoInvoice(poId), { wrapper });
    await act(async () => { await first.result.current.submit(input); }); first.unmount();
    const next = renderHook(() => usePoInvoice(poId), { wrapper });
    await act(async () => { await next.result.current.submit(input); });
    expect(rpc.mock.calls[1]).toEqual(rpc.mock.calls[0]); expect(upload).not.toHaveBeenCalled(); expect(readFinancialSlot(scope)?.status).toBe('resolved');
  });
  it('rejects a changed reselected file without another request', async () => {
    rpc.mockRejectedValueOnce(new Error('Response lost')); const input = await snapshot(file());
    const view = renderHook(() => usePoInvoice(poId), { wrapper });
    await act(async () => { await view.result.current.submit(input); });
    await act(async () => { await view.result.current.submit(input, file('changed')); });
    expect(rpc).toHaveBeenCalledOnce(); expect(readFinancialSlot(scope)?.status).toBe('pending');
  });
  it('rejects a PNG before persisting an attempt', async () => {
    render(<PoInvoiceUploader poId={poId} value={null} editable removable onBusyChange={vi.fn()} />, { wrapper });
    fireEvent.change(screen.getByLabelText('Invoice file'), { target: { files: [file('png', 'image/png')] } });
    expect(await screen.findByRole('alert')).toHaveTextContent('JPEG or PDF'); expect(rpc).not.toHaveBeenCalled(); expect(localStorage.length).toBe(0);
  });
  it('freezes an existing invoice after partial payment and all invoices after full payment', () => {
    const view = render(<PoInvoicePanel po={po} hasPayments fullyPaid={false} paymentsKnown onBusyChange={vi.fn()} />, { wrapper });
    expect(screen.queryByLabelText('Invoice file')).not.toBeInTheDocument(); expect(screen.queryByText('Remove invoice')).not.toBeInTheDocument();
    view.rerender(<PoInvoicePanel po={{ ...po, invoice_path: null }} hasPayments fullyPaid paymentsKnown onBusyChange={vi.fn()} />);
    expect(screen.queryByLabelText('Invoice file')).not.toBeInTheDocument();
  });
  it('permits a missing invoice after partial payment', () => {
    render(<PoInvoicePanel po={{ ...po, invoice_path: null }} hasPayments fullyPaid={false} paymentsKnown onBusyChange={vi.fn()} />, { wrapper });
    expect(screen.getByLabelText('Invoice file')).toBeInTheDocument(); expect(screen.queryByText('Remove invoice')).not.toBeInTheDocument();
  });
  it('downloads privately and revokes the temporary URL', async () => {
    const create = vi.fn(() => 'blob:private-invoice'), revoke = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create }); Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    download.mockResolvedValue({ data: new Blob(['private']), error: null });
    render(<PoInvoicePanel po={po} hasPayments={false} fullyPaid={false} paymentsKnown onBusyChange={vi.fn()} />, { wrapper });
    expect(screen.queryByRole('link')).not.toBeInTheDocument(); fireEvent.click(screen.getByText('Download invoice'));
    await waitFor(() => expect(click).toHaveBeenCalledOnce());
    expect(download).toHaveBeenCalledWith('download-po-invoice', { body: { po_id: poId }, headers: { 'x-session-token': 'session-a-secret' } }); expect(revoke).toHaveBeenCalledWith('blob:private-invoice');
  });
  it('discards a download when the session changes during IO', async () => {
    const response = deferred<{ data: Blob; error: null }>(); download.mockReturnValue(response.promise);
    const create = vi.fn(); Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create });
    render(<PoInvoicePanel po={po} hasPayments={false} fullyPaid={false} paymentsKnown onBusyChange={vi.fn()} />, { wrapper });
    fireEvent.click(screen.getByText('Download invoice')); act(() => { financialTestAuth.setState({ sessionToken: 'new-session' }); });
    await act(async () => { response.resolve({ data: new Blob(['private']), error: null }); await response.promise; }); expect(create).not.toHaveBeenCalled();
  });
});
