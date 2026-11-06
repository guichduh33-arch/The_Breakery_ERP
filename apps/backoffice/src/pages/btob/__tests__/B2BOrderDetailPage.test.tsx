import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import B2BOrderDetailPage from '../B2BOrderDetailPage.js';
import { deferred, financialTestAuth, installFinancialBrowser, resetFinancialSession } from '@/lib/__tests__/financialAttemptTestUtils.js';
import { runFinancialAttempt } from '@/lib/pendingFinancialAttempts.js';

const { state, rpc, generatePdf, openPdf } = vi.hoisted(() => ({
  state: { delivered: false, paid: false, partial: false, missing: false, error: false, allowed: true,
    exportAllowed: true, missingInvoiceNumber: false },
  rpc: vi.fn(),
  generatePdf: vi.fn(),
  openPdf: vi.fn(),
}));
vi.mock('@/features/reports/hooks/useGeneratePdf.js', () => ({
  useGeneratePdf: () => ({ mutateAsync: generatePdf }),
}));
vi.mock('@/stores/authStore.js', async () => ({ useAuthStore: (await import('@/lib/__tests__/financialAttemptTestUtils.js')).financialTestAuth }));
vi.mock('@/features/btob/components/B2bOrderItemsPanel.js', () => ({
  B2bOrderItemsPanel: ({ orderId }: { orderId: string }) => <div>Items for {orderId}</div>,
}));
vi.mock('@/features/btob/components/EditB2bOrderDialog.js', () => ({
  EditB2bOrderDialog: () => <div role="dialog">Edit B2B items</div>,
}));
vi.mock('@/features/btob/components/RecordB2bPaymentModal.js', () => ({
  RecordB2bPaymentModal: ({ initialInvoiceIds }: { initialInvoiceIds: string[] }) => (
    <div role="dialog">Payment for {initialInvoiceIds.join(',')}</div>
  ),
}));
vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc,
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: () => Promise.resolve({
          data: state.missing
            ? null
            : {
                invoice_id: 'o1',
                order_number: 'BO-001',
                invoice_number: state.missingInvoiceNumber ? null : 'INV/001',
                customer_id: 'c1',
                customer_name: 'Hotel',
                invoice_date: '2026-09-10',
                pickup_date: '2026-09-15',
                invoice_total: 100,
                amount_paid: state.paid ? 100 : state.partial ? 25 : 0,
                order_status: state.paid ? 'paid' : 'b2b_pending',
                paid_at: state.paid ? '2026-09-15' : null,
                outstanding: state.paid ? 0 : 100,
                b2b_delivered_at: state.delivered ? '2026-09-15' : null,
              },
          error: state.error ? { message: 'Connection failed' } : null,
        }),
      };
      return chain;
    },
  },
}));

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/backoffice/b2b/orders/o1?payment=unpaid']}>
        <Routes>
          <Route path="/backoffice/b2b/orders/:orderId" element={<B2BOrderDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('B2B order detail', () => {
  beforeEach(() => {
    installFinancialBrowser(); resetFinancialSession();
    financialTestAuth.setState({ hasPermission: (permission) => state.allowed
      && (permission !== 'reports.export' || state.exportAllowed) });
    Object.assign(state, {
      delivered: false,
      paid: false,
      partial: false,
      missing: false,
      error: false,
      allowed: true,
      exportAllowed: true,
      missingInvoiceNumber: false,
    });
    rpc.mockReset();
    rpc.mockResolvedValue({ data: { order_number: 'BO-001', lines: [] }, error: null });
    generatePdf.mockReset();
    generatePdf.mockResolvedValue({ signed_url: 'https://example.test/invoice.pdf' });
    openPdf.mockReset();
    openPdf.mockReturnValue(null);
    vi.spyOn(window, 'open').mockImplementation(openPdf);
  });
  afterEach(() => { vi.restoreAllMocks(); });
  it.each([false, true])('opens the invoice PDF without changing payment when paid=%s', async (paid) => {
    state.paid = paid;
    setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Print PDF' }));
    await waitFor(() => expect(openPdf).toHaveBeenCalledWith('https://example.test/invoice.pdf', '_blank', 'noopener'));
    expect(rpc.mock.calls).toEqual([['get_b2b_invoice_v3', { p_order_id: 'o1' }]]);
    expect(generatePdf).toHaveBeenCalledWith({ template: 'b2b_invoice',
      data: { order_number: 'BO-001', lines: [] }, filename: 'invoice-INV-001' });
  });
  it('uses the order number when no invoice number is assigned', async () => {
    state.missingInvoiceNumber = true;
    setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Print PDF' }));
    await waitFor(() => expect(generatePdf).toHaveBeenCalledWith(expect.objectContaining({ filename: 'invoice-BO-001' })));
  });
  it('disables PDF export independently from payment permissions', async () => {
    state.exportAllowed = false;
    setup();
    const print = await screen.findByRole('button', { name: 'Print PDF' });
    expect(print).toBeDisabled();
    expect(print).toHaveAttribute('title', 'You do not have permission to export B2B invoices.');
    expect(screen.getByRole('button', { name: 'Record payment' })).toBeEnabled();
    fireEvent.click(print);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('prevents another export while preparing the PDF', async () => {
    const pending = deferred<{ signed_url: string }>();
    generatePdf.mockReturnValueOnce(pending.promise);
    setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Print PDF' }));
    const preparing = await screen.findByRole('button', { name: 'Preparing PDF…' });
    expect(preparing).toBeDisabled();
    expect(preparing).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(preparing);
    expect(generatePdf).toHaveBeenCalledTimes(1);
    await act(async () => {
      pending.resolve({ signed_url: 'https://example.test/invoice.pdf' });
      await pending.promise;
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Print PDF' })).toBeEnabled());
  });
  it('shows export errors and allows a new attempt', async () => {
    generatePdf.mockRejectedValueOnce(new Error('PDF unavailable'));
    setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Print PDF' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not generate the invoice PDF. Please try again.');
    expect(openPdf).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Print PDF' }));
    await waitFor(() => expect(openPdf).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('opens directly with items, actions and a return link preserving filters', async () => {
    setup();
    expect(await screen.findByRole('heading', { name: 'BO-001' })).toBeInTheDocument();
    expect(screen.getByText('Items for o1')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Back to B2B orders/ })).toHaveAttribute(
      'href',
      '/backoffice/b2b/orders?payment=unpaid',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Payment for o1');
  });
  it('refreshes delivery status after confirming pickup without marking the order paid', async () => {
    rpc.mockImplementation(() => {
      state.delivered = true;
      return Promise.resolve({ data: { order_id: 'o1' }, error: null });
    });
    setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Mark delivered' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Mark delivered' }).at(-1)!);
    await waitFor(() => {
      expect(screen.getByText('Delivered')).toBeInTheDocument();
    });
    expect(screen.getByText('Unpaid')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark delivered' })).not.toBeInTheDocument();
  });
  it('disables writes for a reader without permissions', async () => {
    state.allowed = false;
    setup();
    expect(await screen.findByRole('button', { name: 'Mark delivered' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Record payment' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Edit order' })).toBeDisabled();
  });
  it('opens editing for an unpaid and uncollected order', async () => {
    setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit order' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Edit B2B items');
  });
  it.each(['paid', 'partial', 'delivered'] as const)('does not offer editing after %s', async (flag) => {
    state[flag] = true;
    setup();
    await screen.findByRole('heading', { name: 'BO-001' });
    expect(screen.queryByRole('button', { name: 'Edit order' })).not.toBeInTheDocument();
  });
  it('shows a missing order without offering actions', async () => {
    state.missing = true;
    setup();
    expect(await screen.findByText('Order not found or no longer available.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record payment' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Print PDF' })).not.toBeInTheDocument();
  });
  it('shows a retry on a read error', async () => {
    state.error = true;
    setup();
    expect(await screen.findByRole('alert')).toHaveTextContent('Connection failed');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
  it('keeps Check pending payment available after the invoice becomes fully settled', async () => {
    state.paid = true;
    await runFinancialAttempt({ scope: { environment: import.meta.env.VITE_SUPABASE_URL as string,
      profileId: 'profile-a', operation: 'payment', target: 'c1' }, expectedRevision: null,
      payload: { customerId: 'c1', amount: 100, method: 'store_credit', invoiceIds: ['o1'] },
      current: () => true, send: () => Promise.reject(new Error('Lost response')) }).catch(() => undefined);
    setup(); fireEvent.click(await screen.findByRole('button', { name: 'Check pending payment' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Payment for o1');
  });
});
