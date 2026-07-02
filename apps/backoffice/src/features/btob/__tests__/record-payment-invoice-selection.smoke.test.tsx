// apps/backoffice/src/features/btob/__tests__/record-payment-invoice-selection.smoke.test.tsx
//
// Session 56 — DEV-S52-03 : targeted invoice allocation in RecordB2bPaymentModal.
//   (a) checking invoices B then A sends invoiceIds in check order (allocation
//       order), and the amount auto-fills with Σ outstanding of the selection.
//   (b) no invoice checked → no invoiceIds key sent (server FIFO).
//   (c) success → rp-success recap lists the returned allocations.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RecordB2bPaymentModal } from '@/features/btob/components/RecordB2bPaymentModal.js';

const mockRpc = vi.fn();

const CLIENTS = [
  { id: 'b1', name: 'Hotel Kuta', b2b_company_name: 'PT Kuta',
    b2b_current_balance: 800000, b2b_credit_limit: 5000000 },
];

const INVOICES = [
  { invoice_id: 'inv-a', order_number: 'ORD-A', customer_id: 'b1',
    b2b_company_name: 'PT Kuta', customer_name: 'Hotel Kuta',
    invoice_total: 500000, invoice_date: '2026-06-01T00:00:00Z', paid_at: null,
    order_status: 'completed', age_days: 30, is_unpaid: true,
    amount_paid: 0, outstanding: 500000 },
  { invoice_id: 'inv-b', order_number: 'ORD-B', customer_id: 'b1',
    b2b_company_name: 'PT Kuta', customer_name: 'Hotel Kuta',
    invoice_total: 300000, invoice_date: '2026-06-15T00:00:00Z', paid_at: null,
    order_status: 'completed', age_days: 15, is_unpaid: true,
    amount_paid: 0, outstanding: 300000 },
];

const SUCCESS_RESULT = {
  payment_id: 'pay-9', payment_number: 'BP-2026-0099',
  allocations: [
    { invoice_id: 'inv-b', amount_applied: 300000, fully_settled: true },
    { invoice_id: 'inv-a', amount_applied: 500000, fully_settled: true },
  ],
  allocation: [],
  je_id: 'je-9',
  customer_balance_after: 0,
  idempotent_replay: false,
};

interface RpcResult { data: unknown; error: { message: string } | null }

vi.mock('@/lib/supabase.js', () => {
  function tableData(table: string): RpcResult {
    if (table === 'view_b2b_invoices') return { data: INVOICES, error: null };
    return { data: CLIENTS, error: null };
  }
  function buildChain(table: string) {
    const result = tableData(table);
    type Resolver = (v: RpcResult) => unknown;
    const chain: Record<string, unknown> = {
      select: () => chain,
      is:     () => chain,
      eq:     () => chain,
      in:     () => chain,
      gte:    () => chain,
      gt:     () => chain,
      order:  () => chain,
      limit:  () => chain,
      then:   (resolve: Resolver) => resolve(result),
    };
    return chain;
  }
  return {
    supabase: {
      from: (table: string) => buildChain(table),
      rpc:  (fn: string, args: unknown) => {
        const out = mockRpc(fn, args) as RpcResult | undefined;
        return Promise.resolve(out ?? { data: SUCCESS_RESULT, error: null });
      },
    },
  };
});

if (typeof crypto.randomUUID !== 'function') {
  Object.defineProperty(globalThis.crypto, 'randomUUID', {
    value: () => '00000000-0000-0000-0000-000000000001',
  });
}

function newClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

function renderModal(): void {
  render(
    <QueryClientProvider client={newClient()}>
      <RecordB2bPaymentModal open={true} onClose={() => undefined} />
    </QueryClientProvider>,
  );
}

async function selectCustomer(): Promise<void> {
  await waitFor(() => {
    expect(screen.queryByRole('option', { name: 'PT Kuta' })).not.toBeNull();
  });
  fireEvent.change(screen.getByLabelText(/^customer$/i), { target: { value: 'b1' } });
}

describe('RecordB2bPaymentModal — invoice selection (S56 DEV-S52-03)', () => {
  beforeEach(() => mockRpc.mockReset());

  it('(a) checking B then A sends invoiceIds in check order and auto-fills the amount', async () => {
    renderModal();
    await selectCustomer();

    const checkboxB = await screen.findByTestId('rp-invoice-ORD-B');
    const checkboxA = await screen.findByTestId('rp-invoice-ORD-A');

    fireEvent.click(checkboxB);
    fireEvent.click(checkboxA);

    const amountInput = screen.getByLabelText(/^amount$/i) as HTMLInputElement;
    await waitFor(() => expect(amountInput.value).toBe('800000'));

    const submit = screen.getByRole('button', { name: /record payment/i });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('record_b2b_payment_v2', expect.objectContaining({
        p_customer_id:  'b1',
        p_invoice_ids:  ['inv-b', 'inv-a'],
      }));
    });

    await waitFor(() => {
      expect(screen.getByTestId('rp-success')).toBeInTheDocument();
    });
    expect(screen.getByText(/BP-2026-0099/)).toBeInTheDocument();
    expect(screen.getAllByText('settled').length).toBe(2);
  });

  it('(b) no invoice checked → no invoiceIds key sent (server FIFO)', async () => {
    renderModal();
    await selectCustomer();
    await screen.findByTestId('rp-invoice-ORD-B');

    fireEvent.change(screen.getByLabelText(/^amount$/i), { target: { value: '100000' } });

    const submit = screen.getByRole('button', { name: /record payment/i });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('record_b2b_payment_v2', expect.objectContaining({
        p_customer_id: 'b1',
        p_amount:      100000,
      }));
    });
    const [, callArgs] = mockRpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(callArgs).not.toHaveProperty('p_invoice_ids');
  });
});
