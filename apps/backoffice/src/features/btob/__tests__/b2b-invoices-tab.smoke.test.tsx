// apps/backoffice/src/features/btob/__tests__/b2b-invoices-tab.smoke.test.tsx
//
// Session 56 — DEV-S52-03 smoke: B2bInvoicesTab + CancelB2bOrderModal.
//   (a) two invoice rows render with outstanding + status badges.
//   (b) Cancel button only appears on the b2b_pending / unpaid invoice, and
//       only when canCancel is true.
//   (c) clicking Cancel opens the modal; reason < 3 chars keeps confirm disabled.
//   (d) Record payment on an invoices-tab row calls onRecord(customer_id, [invoice_id]).
// Session 68 — (e) Invoice PDF button: renders invoice_number, calls
//   get_b2b_invoice_v1 then generate-pdf, opens the signed URL.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { B2bInvoicesTab } from '@/features/btob/components/B2bInvoicesTab.js';

const mockRpc = vi.fn();

const CUSTOMERS = [
  { id: 'b1', name: 'Hotel Kuta', b2b_company_name: 'PT Kuta', b2b_credit_limit: 1000000, b2b_current_balance: 250000 },
];

const INVOICES = [
  {
    invoice_id: 'inv-1', order_number: 'B2B-0001', invoice_number: null, customer_id: 'b1',
    b2b_company_name: 'PT Kuta', customer_name: 'Hotel Kuta',
    invoice_total: 500000, invoice_date: '2026-06-01T00:00:00Z', paid_at: null,
    order_status: 'b2b_pending', age_days: 30, is_unpaid: true,
    amount_paid: 0, outstanding: 500000,
  },
  {
    invoice_id: 'inv-2', order_number: 'B2B-0002', invoice_number: null, customer_id: 'b1',
    b2b_company_name: 'PT Kuta', customer_name: 'Hotel Kuta',
    invoice_total: 300000, invoice_date: '2026-06-10T00:00:00Z', paid_at: null,
    order_status: 'b2b_pending', age_days: 21, is_unpaid: true,
    amount_paid: 100000, outstanding: 200000,
  },
  {
    invoice_id: 'inv-3', order_number: 'B2B-20260708-0001', invoice_number: 'INV/2026/00001', customer_id: 'b1',
    b2b_company_name: 'PT Kuta', customer_name: 'Hotel Kuta',
    invoice_total: 50000, invoice_date: '2026-07-08T00:00:00Z', paid_at: '2026-07-08T00:00:00Z',
    order_status: 'paid', age_days: 0, is_unpaid: false,
    amount_paid: 50000, outstanding: 0,
  },
];

interface RpcResult { data: unknown; error: { message: string } | null }

const GET_B2B_INVOICE_PAYLOAD = {
  invoice:  {
    invoice_number: 'INV/2026/00001', order_number: 'B2B-20260708-0001',
    invoice_date: '2026-07-08', due_date: '2026-07-15', status: 'b2b_pending',
    subtotal: 45000, tax_amount: 5000, total: 50000, notes: null,
  },
  customer: { company_name: 'PT Kuta', tax_id: null, name: 'Hotel Kuta', phone: null, email: null, payment_terms_days: 7 },
  lines:    [{ name: 'Croissant', quantity: 10, unit_price: 5000, line_total: 50000 }],
  payment:  { amount_paid: 0, outstanding: 50000 },
};

vi.mock('@/lib/supabase.js', () => {
  function tableData(table: string): RpcResult {
    if (table === 'view_b2b_invoices') return { data: INVOICES,  error: null };
    if (table === 'customers')         return { data: CUSTOMERS, error: null };
    return { data: [], error: null };
  }
  function buildChain(table: string) {
    const result = tableData(table);
    type Resolver = (v: RpcResult) => unknown;
    const chain: Record<string, unknown> = {
      select: () => chain,
      is:     () => chain,
      eq:     () => chain,
      in:     () => chain,
      gt:     () => chain,
      gte:    () => chain,
      order:  () => chain,
      limit:  () => chain,
      then:   (resolve: Resolver) => resolve(result),
    };
    return chain;
  }
  return {
    supabaseUrl: 'http://test.local',
    supabase: {
      from: (table: string) => buildChain(table),
      rpc:  (fn: string, args: unknown) => {
        const out = mockRpc(fn, args) as RpcResult | undefined;
        if (out !== undefined) return Promise.resolve(out);
        if (fn === 'get_b2b_invoice_v1') return Promise.resolve({ data: GET_B2B_INVOICE_PAYLOAD, error: null });
        return Promise.resolve({
          data: {
            order_id: 'inv-1', order_number: 'B2B-0001',
            reversed_je_id: 'je-1', balance_after: 0, idempotent_replay: false,
          },
          error: null,
        });
      },
    },
  };
});

vi.mock('@/lib/accessToken.js', () => ({ getAccessToken: () => Promise.resolve('test-token') }));

const fetchMock = vi.fn();
Object.defineProperty(globalThis, 'fetch', { value: fetchMock, writable: true });

if (typeof crypto.randomUUID !== 'function') {
  Object.defineProperty(globalThis.crypto, 'randomUUID', {
    value: () => '00000000-0000-0000-0000-000000000001',
  });
}

function newClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

function renderTab(props: Partial<{ canRecord: boolean; canCancel: boolean; onRecord: (customerId: string, invoiceIds?: string[]) => void }> = {}) {
  const onRecord = props.onRecord ?? vi.fn();
  render(
    <QueryClientProvider client={newClient()}>
      <B2bInvoicesTab
        search=""
        canRecord={props.canRecord ?? true}
        canCancel={props.canCancel ?? true}
        onRecord={onRecord}
      />
    </QueryClientProvider>,
  );
  return { onRecord };
}

describe('B2bInvoicesTab (S56 DEV-S52-03)', () => {
  beforeEach(() => {
    mockRpc.mockReset();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ signed_url: 'https://example.test/invoice.pdf', storage_path: 'b2b-invoices/x', expires_at: 'z' }),
    });
  });

  it('(a) renders both invoice rows with outstanding + status badges', async () => {
    renderTab();
    await waitFor(() => {
      expect(screen.getByText('B2B-0001')).toBeInTheDocument();
      expect(screen.getByText('B2B-0002')).toBeInTheDocument();
    });
    expect(screen.getByText('unpaid')).toBeInTheDocument();
    expect(screen.getByText('partial')).toBeInTheDocument();
  });

  it('(b) Cancel button only appears on the unpaid b2b_pending invoice, gated by canCancel', async () => {
    renderTab({ canCancel: true });
    await waitFor(() => expect(screen.getByText('B2B-0001')).toBeInTheDocument());
    expect(screen.getByTestId('inv-cancel-B2B-0001')).toBeInTheDocument();
    expect(screen.queryByTestId('inv-cancel-B2B-0002')).toBeNull();
  });

  it('(b2) Cancel button hidden entirely when canCancel is false', async () => {
    renderTab({ canCancel: false });
    await waitFor(() => expect(screen.getByText('B2B-0001')).toBeInTheDocument());
    expect(screen.queryByTestId('inv-cancel-B2B-0001')).toBeNull();
  });

  it('(c) clicking Cancel opens the modal; reason < 3 chars keeps confirm disabled', async () => {
    renderTab();
    await waitFor(() => expect(screen.getByTestId('inv-cancel-B2B-0001')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('inv-cancel-B2B-0001'));

    const confirm = await screen.findByTestId('cb2b-confirm');
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByTestId('cb2b-reason'), { target: { value: 'ab' } });
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByTestId('cb2b-reason'), { target: { value: 'abc' } });
    expect(confirm).toBeEnabled();
  });

  it('(d) Record payment passes (customer_id, [invoice_id]) to onRecord', async () => {
    const { onRecord } = renderTab();
    await waitFor(() => expect(screen.getByTestId('inv-record-B2B-0001')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('inv-record-B2B-0001'));
    expect(onRecord).toHaveBeenCalledWith('b1', ['inv-1']);
  });

  it('(e) Invoice PDF button renders invoice_number and downloads via get_b2b_invoice_v1 + generate-pdf', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    renderTab();
    await waitFor(() => expect(screen.getByTestId('inv-pdf-B2B-20260708-0001')).toBeInTheDocument());
    expect(screen.getByText('INV/2026/00001')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('inv-pdf-B2B-20260708-0001'));

    await waitFor(() => expect(mockRpc).toHaveBeenCalledWith('get_b2b_invoice_v1', { p_order_id: 'inv-3' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      'http://test.local/functions/v1/generate-pdf',
      expect.objectContaining({ method: 'POST' }),
    ));
    const sentBody = JSON.parse((fetchMock.mock.calls[0]?.[1] as { body: string }).body) as Record<string, unknown>;
    expect(sentBody).toMatchObject({ template: 'b2b_invoice', filename: 'invoice-INV-2026-00001' });
    await waitFor(() => expect(openSpy).toHaveBeenCalledWith('https://example.test/invoice.pdf', '_blank', 'noopener'));
    openSpy.mockRestore();
  });
});
