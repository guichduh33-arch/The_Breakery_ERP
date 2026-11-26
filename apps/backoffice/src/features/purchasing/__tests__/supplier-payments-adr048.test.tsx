// ADR-048 — paiements fournisseurs : règlement groupé, contre-passation sous PIN
// du super admin, historique détaillé du bon. Contrats d'appel des RPC, lecture
// des réponses et règles d'affichage.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('@/lib/supabase.js', () => ({ supabase: { rpc: mocks.rpc, from: mocks.from } }));

import { useAuthStore } from '@/stores/authStore.js';
import { buildPoActivity, type PoAuditRow } from '../poActivity.js';
import { PoPaymentsCard } from '../components/PoPaymentsCard.js';
import { ReversePaymentDialog } from '../components/ReversePaymentDialog.js';
import { reverseCodeOf } from '../hooks/useReversePoPayment.js';
import type { PoPaymentRow } from '../hooks/usePoPayments.js';
import {
  SupplierGroupPaymentDialog,
  allocate,
  payablePos,
} from '@/features/suppliers/components/SupplierGroupPaymentDialog.js';
import type { SupplierPOListRow } from '@/features/suppliers/hooks/useSupplierPurchases.js';

function wrap(children: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function setUser(role: string, permissions: string[] = []): void {
  useAuthStore.setState({ permissions, user: { id: 'u1', role_code: role } as never });
}

const pay = (over: Partial<PoPaymentRow>): PoPaymentRow => ({
  id: 'p1', amount: 100_000, method: 'transfer', paid_at: '2026-11-20T01:30:00Z', reference: null,
  paid_by: null, payment_group_id: null, reversal_of_id: null, reversal_reason: null, ...over,
});

const cardProps = {
  poId: 'po-1', poNumber: 'PO-1', totalDue: 100_000, totalPaid: 0, remainingDue: 100_000,
  paymentStatus: 'unpaid' as const, canRecordPay: false, payBlockedByCancel: false,
  invoiceBlocked: false, onRecordPayment: vi.fn(),
};

beforeEach(() => { vi.clearAllMocks(); setUser('MANAGER'); });

describe('PO payment history', () => {
  it('shows Reverse to the super admin only, never on a reversal or a reversed payment', () => {
    const rows = [
      pay({ id: 'p1' }),
      pay({ id: 'r1', amount: -100_000, reversal_of_id: 'p1', reversal_reason: 'typed twice' }),
      pay({ id: 'p2', amount: 40_000 }),
    ];
    const { unmount } = render(wrap(<PoPaymentsCard {...cardProps} payments={rows} />));
    expect(screen.queryAllByTestId('po-payment-reverse')).toHaveLength(0);
    unmount();

    setUser('SUPER_ADMIN');
    render(wrap(<PoPaymentsCard {...cardProps} payments={rows} />));
    // p1 est contre-passé, r1 est une contre-passation : seul p2 se contre-passe.
    expect(screen.getAllByTestId('po-payment-reverse')).toHaveLength(1);
    expect(screen.getByText('REVERSAL')).toBeInTheDocument();
    expect(screen.getByText('REVERSED')).toBeInTheDocument();
    expect(screen.getByText(/Reason: typed twice/)).toBeInTheDocument();
  });
});

describe('ReversePaymentDialog', () => {
  const PAYMENT = { id: 'p1', amount: 120_000, method: 'transfer', paidAt: '2026-11-20T01:30:00Z', groupSize: 2, groupTotal: 120_000 };

  it('announces a grouped reversal and needs a reason and a 6-digit PIN', () => {
    render(wrap(<ReversePaymentDialog poNumber="PO-1" payment={PAYMENT} poIds={['po-1', 'po-2']} onClose={vi.fn()} />));
    expect(screen.getByTestId('reverse-payment-group')).toHaveTextContent(/2 purchase orders/);
    const submit = screen.getByTestId('reverse-payment-submit');
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByTestId('reverse-payment-reason'), { target: { value: 'ok' } });
    fireEvent.change(screen.getByTestId('reverse-payment-pin'), { target: { value: '246810' } });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByTestId('reverse-payment-reason'), { target: { value: 'Transfer typed twice' } });
    expect(submit).toBeEnabled();
  });

  it('sends the PIN as an argument with a stable key, and shows a wrong PIN', async () => {
    mocks.rpc.mockResolvedValue({ data: { ok: false, error: 'invalid_pin' }, error: null });
    const onClose = vi.fn();
    render(wrap(<ReversePaymentDialog poNumber="PO-1" payment={{ ...PAYMENT, groupSize: 1 }} poIds={['po-1']} onClose={onClose} />));
    fireEvent.change(screen.getByTestId('reverse-payment-reason'), { target: { value: 'Transfer typed twice' } });
    fireEvent.change(screen.getByTestId('reverse-payment-pin'), { target: { value: '000000' } });
    fireEvent.click(screen.getByTestId('reverse-payment-submit'));
    await waitFor(() => expect(screen.getByTestId('reverse-payment-error')).toHaveTextContent('Wrong PIN'));
    expect(onClose).not.toHaveBeenCalled();
    const [fn, args] = mocks.rpc.mock.calls[0]!;
    expect(fn).toBe('reverse_po_payment_v1');
    expect(args).toMatchObject({ p_payment_id: 'p1', p_reason: 'Transfer typed twice', p_manager_pin: '000000' });

    mocks.rpc.mockResolvedValue({ data: { ok: true, lines: [{ reversal_id: 'r1' }] }, error: null });
    fireEvent.change(screen.getByTestId('reverse-payment-pin'), { target: { value: '246810' } });
    fireEvent.click(screen.getByTestId('reverse-payment-submit'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mocks.rpc.mock.calls[1]![1].p_idempotency_key).toBe(args.p_idempotency_key);
  });

  it('reads the server code at the head of the message', () => {
    expect(reverseCodeOf('period_locked: date 2026-10-17 falls in closed period')).toBe('period_locked');
    expect(reverseCodeOf('payment_already_reversed')).toBe('payment_already_reversed');
    expect(reverseCodeOf('something else')).toBe('unknown');
  });
});

const po = (over: Partial<SupplierPOListRow>): SupplierPOListRow => ({
  id: 'a', po_number: 'PO-A', order_date: '2026-11-01', created_at: '2026-11-01T00:00:00Z',
  status: 'received', total_amount: 100_000, paid_amount: 0, is_historical_import: false,
  deleted_at: null, invoice_exempt: false, invoice_path: 'purchase-orders/a/inv.pdf', item_count: 1,
  ...over,
} as unknown as SupplierPOListRow);

describe('grouped supplier payment', () => {
  const rows = [
    po({ id: 'b', po_number: 'PO-B', order_date: '2026-11-10', total_amount: 50_000, invoice_path: 'purchase-orders/b/inv.pdf' }),
    po({ id: 'a', po_number: 'PO-A', order_date: '2026-11-01' }),
    po({ id: 'c', po_number: 'PO-C', status: 'cancelled' }),
    po({ id: 'd', po_number: 'PO-D', total_amount: 10_000, paid_amount: 10_000 }),
    po({ id: 'e', po_number: 'PO-E', invoice_path: null }),
  ];

  it('lists only orders with something left to pay, oldest first', () => {
    expect(payablePos(rows).map((p) => p.poNumber)).toEqual(['PO-A', 'PO-E', 'PO-B']);
    expect(payablePos(rows).find((p) => p.poNumber === 'PO-E')?.hasInvoice).toBe(false);
  });

  it('splits the amount from the oldest order, like the server', () => {
    const pick = payablePos(rows).filter((p) => p.id === 'a' || p.id === 'b');
    expect([...allocate(pick, 120_000)]).toEqual([['a', 100_000], ['b', 20_000]]);
  });

  it('sends one grouped payment with the real date', async () => {
    mocks.rpc.mockResolvedValue({ data: { payment_group_id: 'g', amount_paid: 120_000, lines: [{ po_id: 'a' }, { po_id: 'b' }], idempotent_replay: false }, error: null });
    const onClose = vi.fn();
    render(wrap(<SupplierGroupPaymentDialog supplierId="sup-1" supplierName="Acme" rows={rows} onClose={onClose} />));
    const boxes = screen.getAllByRole('checkbox');
    // PO-E n'a pas de facture : il ne se coche pas.
    expect(boxes[1]).toBeDisabled();
    fireEvent.click(boxes[0]!);
    fireEvent.click(boxes[2]!);
    fireEvent.change(screen.getByTestId('group-pay-amount'), { target: { value: '120000' } });
    const submit = screen.getByTestId('group-pay-submit');
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Paid at/i), { target: { value: '2026-11-21T10:00' } });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const [fn, args] = mocks.rpc.mock.calls[0]!;
    expect(fn).toBe('record_supplier_payment_v2');
    expect(args).toMatchObject({ p_supplier_id: 'sup-1', p_po_ids: ['a', 'b'], p_amount: 120_000, p_paid_at: '2026-11-21T10:00', p_method: 'transfer' });
  });

  it('refuses an amount above what is left on the selected orders', () => {
    render(wrap(<SupplierGroupPaymentDialog supplierId="sup-1" supplierName="Acme" rows={rows} onClose={vi.fn()} />));
    fireEvent.click(screen.getAllByRole('checkbox')[0]!);
    fireEvent.change(screen.getByTestId('group-pay-amount'), { target: { value: '100001' } });
    fireEvent.change(screen.getByLabelText(/Paid at/i), { target: { value: '2026-11-21T10:00' } });
    expect(screen.getByText(/exceeds the total left/i)).toBeInTheDocument();
    expect(screen.getByTestId('group-pay-submit')).toBeDisabled();
  });
});

describe('PO activity log', () => {
  const row = (over: Partial<PoAuditRow>): PoAuditRow => ({
    id: 1, action: 'purchase_order.create', created_at: '2026-11-20T01:00:00Z',
    metadata: null, payload: null, actor: { full_name: 'Mamat' }, ...over,
  });

  it('labels every purchasing action, most recent first, with its details', () => {
    const events = buildPoActivity([
      row({ id: 1, metadata: { total_amount: 129_900, item_count: 1, payment_terms: 'credit' } }),
      row({ id: 2, action: 'po.payment_recorded', created_at: '2026-11-21T01:00:00Z',
        metadata: { amount: 50_000, method: 'transfer', paid_at: '2026-11-19T02:00:00Z', payment_group_id: 'g' } }),
      row({ id: 3, action: 'po.payment_reversed', created_at: '2026-11-22T01:00:00Z', actor: null,
        metadata: { reason: 'typed twice' }, payload: { amount: 50_000, method: 'transfer', paid_at: '2026-11-19T02:00:00Z' } }),
      row({ id: 4, action: 'po.some_future_action', created_at: '2026-11-19T01:00:00Z' }),
    ]);
    expect(events.map((e) => e.action)).toEqual(['Payment reversed', 'Payment recorded', 'Order created', 'Some future action']);
    expect(events[0]!.detail).toMatch(/Reason: typed twice/);
    expect(events[0]!.person).toBeNull();
    expect(events[1]!.detail).toMatch(/Bank transfer/);
    expect(events[1]!.detail).toMatch(/grouped payment/);
    expect(events[2]!.detail).toMatch(/Credit/);
  });
});
