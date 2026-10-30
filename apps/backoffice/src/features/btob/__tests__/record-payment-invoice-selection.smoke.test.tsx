// apps/backoffice/src/features/btob/__tests__/record-payment-invoice-selection.smoke.test.tsx
//
// Session 56 — DEV-S52-03 : targeted invoice allocation in RecordB2bPaymentModal.
//   (a) checking invoices B then A sends invoiceIds in check order (allocation
//       order), and the amount auto-fills with Σ outstanding of the selection.
//   (b) no invoice checked → no invoiceIds key sent (server FIFO).
//   (c) success → rp-success recap lists the returned allocations.
//   (d) classify() mappe le refus P0011 sur 'payment_not_fully_allocated'.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RecordB2bPaymentModal } from '@/features/btob/components/RecordB2bPaymentModal.js';
import { classify } from '@/features/btob/hooks/useRecordB2bPayment.js';
import { deferred, financialTestAuth, installFinancialBrowser, resetFinancialSession } from '@/lib/__tests__/financialAttemptTestUtils.js';
import { readFinancialSlot } from '@/lib/pendingFinancialAttempts.js';
vi.mock('@/stores/authStore.js', async () => ({ useAuthStore: (await import('@/lib/__tests__/financialAttemptTestUtils.js')).financialTestAuth }));

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
  allocation: [
    { invoice_id: 'inv-b', amount_applied: 300000, fully_settled: true },
    { invoice_id: 'inv-a', amount_applied: 500000, fully_settled: true },
  ],
  je_id: 'je-9',
  customer_balance_after: 0,
  allocated_total: 800000,
  unallocated: 0,
  idempotent_replay: false,
};

interface RpcResult { data: unknown; error: { message: string; code?: string } | null }

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
      maybeSingle: () => {
        const args = mockRpc.mock.calls.at(-1)?.[1] as Record<string, unknown>;
        return Promise.resolve({ data: { id: 'pay-9', payment_number: 'BP-2026-0099',
          customer_id: args.p_customer_id, idempotency_key: args.p_idempotency_key,
          amount: args.p_amount, method: args.p_method, journal_entry_id: 'je-9' }, error: null });
      },
      then:   (resolve: Resolver) => resolve(result),
    };
    return chain;
  }
  return {
    supabase: {
      from: (table: string) => buildChain(table),
      rpc:  (fn: string, args: unknown) => {
        const out = mockRpc(fn, args) as RpcResult | undefined;
        const amount = (args as Record<string, unknown>).p_amount as number;
        const allocations = amount === 800000 ? SUCCESS_RESULT.allocations
          : [{ invoice_id: 'inv-a', amount_applied: amount, fully_settled: false }];
        return Promise.resolve(out ?? { data: { ...SUCCESS_RESULT, allocations, allocation: allocations,
          allocated_total: amount, customer_balance_after: 800000 - amount }, error: null });
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

function renderModal(client: QueryClient = newClient()) {
  return render(
    <QueryClientProvider client={client}>
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
  beforeEach(() => { mockRpc.mockReset(); installFinancialBrowser(); resetFinancialSession(); });

  it('(a) checking B then A sends invoiceIds in check order and auto-fills the amount', async () => {
    renderModal();
    await selectCustomer();

    const checkboxB = await screen.findByTestId('rp-invoice-ORD-B');
    const checkboxA = await screen.findByTestId('rp-invoice-ORD-A');

    fireEvent.click(checkboxB);
    fireEvent.click(checkboxA);

    const amountInput = screen.getByLabelText<HTMLInputElement>(/^amount$/i);
    await waitFor(() => expect(amountInput.value).toBe('800000'));

    const submit = screen.getByRole('button', { name: /record payment/i });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('record_b2b_payment_v5', expect.objectContaining({
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
      expect(mockRpc).toHaveBeenCalledWith('record_b2b_payment_v5', expect.objectContaining({
        p_customer_id: 'b1',
        p_amount:      100000,
      }));
    });
    const [, callArgs] = mockRpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(callArgs).not.toHaveProperty('p_invoice_ids');
  });

  it('sends a store-credit settlement through the current RPC', async () => {
    const client = newClient();
    client.setQueryData(['customer-detail', 'b1'], { store_credit_balance: 100000 });
    client.setQueryData(['store-credit-history', 'b1'], []);
    client.setQueryData(['customer-detail', 'b2'], { store_credit_balance: 50000 });
    client.setQueryData(['store-credit-history', 'b2'], []);
    renderModal(client);
    await selectCustomer();
    fireEvent.change(screen.getByLabelText(/^amount$/i), { target: { value: '100000' } });
    fireEvent.change(screen.getByLabelText(/^method$/i), { target: { value: 'store_credit' } });
    fireEvent.click(screen.getByRole('button', { name: /record payment/i }));

    await waitFor(() => expect(mockRpc).toHaveBeenCalledWith('record_b2b_payment_v5',
      expect.objectContaining({ p_customer_id: 'b1', p_amount: 100000, p_method: 'store_credit' })));
    expect(await screen.findByTestId('rp-success')).toBeInTheDocument();
    expect(client.getQueryState(['customer-detail', 'b1'])?.isInvalidated).toBe(true);
    expect(client.getQueryState(['store-credit-history', 'b1'])?.isInvalidated).toBe(true);
    expect(client.getQueryState(['customer-detail', 'b2'])?.isInvalidated).toBe(false);
    expect(client.getQueryState(['store-credit-history', 'b2'])?.isInvalidated).toBe(false);
  });

  it('shows insufficient credit without presenting a successful settlement', async () => {
    mockRpc.mockReturnValue({ data: null, error: {
      message: 'Insufficient store credit balance (available: 0, requested: 100000)',
    } });
    renderModal();
    await selectCustomer();
    fireEvent.change(screen.getByLabelText(/^amount$/i), { target: { value: '100000' } });
    fireEvent.change(screen.getByLabelText(/^method$/i), { target: { value: 'store_credit' } });
    fireEvent.click(screen.getByRole('button', { name: /record payment/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Insufficient store credit balance');
    expect(screen.queryByTestId('rp-success')).not.toBeInTheDocument();
  });
});

const scope = { environment: import.meta.env.VITE_SUPABASE_URL as string, profileId: 'profile-a', operation: 'payment' as const, target: 'b1' };
describe('durable B2B recovery with real payment hook and modal', () => {
  beforeEach(() => { mockRpc.mockReset(); installFinancialBrowser(); resetFinancialSession(); });

  it('replays a committed store-credit settlement after reload when balance is zero and invoices vanished', async () => {
    const ledger = new Map<string, unknown>();
    mockRpc.mockImplementation((_fn: string, args: Record<string, unknown>) => {
      const key = args.p_idempotency_key as string;
      expect(readFinancialSlot(scope)?.status).toBe('pending');
      if (!ledger.has(key)) { ledger.set(key, args); throw new Error('Committed response lost'); }
      return { data: { ...SUCCESS_RESULT, idempotent_replay: true }, error: null };
    });
    const first = renderModal(); await selectCustomer();
    fireEvent.click(await screen.findByTestId('rp-invoice-ORD-B'));
    fireEvent.click(screen.getByTestId('rp-invoice-ORD-A'));
    fireEvent.change(screen.getByLabelText(/^method$/i), { target: { value: 'store_credit' } });
    fireEvent.change(screen.getByLabelText(/^reference$/i), { target: { value: 'Agreed credit settlement' } });
    fireEvent.click(screen.getByRole('button', { name: /record payment/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Committed response lost');
    const original: unknown = mockRpc.mock.calls[0]?.[1];
    expect(screen.getByLabelText(/^customer$/i)).toBeDisabled();
    expect(screen.getByLabelText(/^amount$/i)).toBeDisabled();
    first.unmount();
    const savedInvoices = INVOICES.splice(0);
    CLIENTS[0]!.b2b_current_balance = 0;
    try {
      renderModal();
      fireEvent.click(await screen.findByRole('button', { name: /Check pending payment for PT Kuta/ }));
      expect(screen.getByLabelText(/^amount$/i)).toHaveValue(800000);
      expect(screen.getByLabelText(/^method$/i)).toHaveValue('store_credit');
      expect(screen.getByText(/Saved invoice selection: inv-b, inv-a/)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Check pending payment' }));
      expect(await screen.findByTestId('rp-success')).toHaveTextContent('BP-2026-0099');
      expect(mockRpc.mock.calls[1]?.[1]).toEqual(original);
      expect(ledger.size).toBe(1);
      expect(readFinancialSlot(scope)?.status).toBe('resolved');
    } finally { INVOICES.push(...savedInvoices); CLIENTS[0]!.b2b_current_balance = 800000; }
  });

  it('keeps UNKNOWN after a proven overpayment refusal and rejects malformed 2xx responses', async () => {
    mockRpc.mockReturnValueOnce({ data: { payment_number: 'incomplete' }, error: null })
      .mockReturnValueOnce({ data: null, error: { code: 'P0011', message: 'overpayment_not_allowed (balance: 0, amount: 100000)' } });
    renderModal(); await selectCustomer();
    fireEvent.change(screen.getByLabelText(/^amount$/i), { target: { value: '100000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('invalid');
    const pending = readFinancialSlot(scope);
    fireEvent.click(screen.getByRole('button', { name: 'Check pending payment' }));
    await waitFor(() => expect(mockRpc).toHaveBeenCalledTimes(2));
    expect(readFinancialSlot(scope)).toEqual(pending);
    expect(screen.getByLabelText(/^amount$/i)).toBeDisabled();
    expect(screen.queryByTestId('rp-success')).not.toBeInTheDocument();
  });

  it('does not render an old success or invalidate the new operator cache after a session change', async () => {
    const response = deferred<RpcResult>(); mockRpc.mockReturnValue(response.promise);
    const client = newClient(); renderModal(client); await selectCustomer();
    fireEvent.change(screen.getByLabelText(/^amount$/i), { target: { value: '100000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }));
    await waitFor(() => expect(mockRpc).toHaveBeenCalledTimes(1));
    act(() => financialTestAuth.setState({ user: { ...financialTestAuth.getState().user, id: 'profile-b' }, sessionToken: 'session-b' }));
    await selectCustomer();
    fireEvent.change(screen.getByLabelText(/^amount$/i), { target: { value: '200000' } });
    client.setQueryData(['customer-detail', 'b1'], { operator: 'B' });
    await act(async () => { response.resolve({ data: SUCCESS_RESULT, error: null }); await response.promise; });
    await waitFor(() => expect(readFinancialSlot(scope)?.status).toBe('pending'));
    expect(screen.queryByTestId('rp-success')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^amount$/i)).toHaveValue(200000);
    expect(client.getQueryState(['customer-detail', 'b1'])?.isInvalidated).toBe(false);
  });

  it('selecting another customer never reuses the first customer pending payload', async () => {
    mockRpc.mockImplementation(() => { throw new Error('Unknown result'); });
    const view = renderModal(); await selectCustomer();
    fireEvent.change(screen.getByLabelText(/^amount$/i), { target: { value: '100000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }));
    await screen.findByRole('alert'); view.unmount();
    CLIENTS.push({ ...CLIENTS[0]!, id: 'b2', name: 'Other hotel', b2b_company_name: 'PT Other' });
    try {
      renderModal();
      await screen.findByRole('option', { name: 'PT Other' });
      fireEvent.change(screen.getByLabelText(/^customer$/i), { target: { value: 'b2' } });
      expect(screen.getByLabelText(/^amount$/i)).toHaveValue(null);
      expect(screen.getByLabelText(/^customer$/i)).toBeEnabled();
      fireEvent.change(screen.getByLabelText(/^amount$/i), { target: { value: '50000' } });
      fireEvent.click(screen.getByRole('button', { name: 'Record payment' }));
      await waitFor(() => expect(mockRpc).toHaveBeenCalledTimes(2));
      expect(mockRpc.mock.calls[1]?.[1]).toMatchObject({ p_customer_id: 'b2', p_amount: 50000 });
      const firstArgs = mockRpc.mock.calls[0]?.[1] as Record<string, unknown>;
      const nextArgs = mockRpc.mock.calls[1]?.[1] as Record<string, unknown>;
      expect(nextArgs.p_idempotency_key).not.toBe(firstArgs.p_idempotency_key);
    } finally { CLIENTS.pop(); }
  });
});

describe('useRecordB2bPayment.classify', () => {
  it('reconnaît le refus de reliquat non alloué (P0011)', () => {
    expect(
      classify('payment_not_fully_allocated (unallocated: 50000, amount: 150000)'),
    ).toBe('payment_not_fully_allocated');
  });

  it('reconnaît un solde d’avoir insuffisant (P0016)', () => {
    expect(classify('Insufficient store credit balance (available: 0, requested: 100000)'))
      .toBe('insufficient_store_credit');
  });
});
