// S3-05 — écran : action « Cancel receipt » soumise à la permission, réception
// annulée affichée sans action, raison obligatoire, refus serveur traduit.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GoodsReceiptNotesCard } from '../components/GoodsReceiptNotesCard.js';
import type { PurchaseOrderDetail, GoodsReceiptNoteRow } from '../hooks/usePurchaseOrderDetail.js';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase.js', () => ({ supabase: { rpc } }));

const PRODUCT_ID = '11111111-1111-1111-1111-111111111111';

function grn(over: Partial<GoodsReceiptNoteRow>): GoodsReceiptNoteRow {
  return {
    id: 'grn-1', grn_number: 'GRN-0001', po_id: 'po-1', received_date: '2026-11-18T03:00:00Z',
    subtotal: 600000, vat_amount: 60000, total: 660000, payment_terms: 'credit',
    cancelled_at: null, cancelled_by: null, cancel_reason: null, cancel_idempotency_key: null,
    created_at: '2026-11-18T03:00:00Z', idempotency_key: null, metadata: {}, notes: null, received_by: null,
    ...over,
  };
}

function po(over: Partial<PurchaseOrderDetail> = {}): PurchaseOrderDetail {
  return {
    id: 'po-1', po_number: 'PO-1', status: 'partial', payment_terms: 'credit',
    financial_import_document_id: null,
    purchase_order_items: [{ product_id: PRODUCT_ID, products: { sku: 'FL', name: 'Flour', unit: 'kg' } }],
    goods_receipt_notes: [
      grn({}),
      grn({ id: 'grn-2', grn_number: 'GRN-0002', cancelled_at: '2026-11-19T03:00:00Z', cancel_reason: 'Duplicate entry' }),
    ],
    ...over,
  } as unknown as PurchaseOrderDetail;
}

function renderCard(p: PurchaseOrderDetail, canCancelReceipt: boolean): void {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <GoodsReceiptNotesCard po={p} canCancelReceipt={canCancelReceipt} />
    </QueryClientProvider>,
  );
}

describe('GoodsReceiptNotesCard — cancel receipt', () => {
  beforeEach(() => rpc.mockReset());

  it('offers Cancel receipt on active receipts only, with the permission', () => {
    renderCard(po(), true);
    expect(screen.getByRole('button', { name: 'Cancel receipt GRN-0001' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel receipt GRN-0002' })).not.toBeInTheDocument();
  });

  it('hides the action without the permission', () => {
    renderCard(po(), false);
    expect(screen.queryByRole('button', { name: /Cancel receipt/ })).not.toBeInTheDocument();
  });

  it('hides the action on a historical import order', () => {
    renderCard(po({ financial_import_document_id: 'doc-1' }), true);
    expect(screen.queryByRole('button', { name: /Cancel receipt/ })).not.toBeInTheDocument();
  });

  it('shows a cancelled receipt as such, with its date and reason', () => {
    renderCard(po(), true);
    const row = screen.getByTestId('grn-row-grn-2');
    expect(within(row).getByText('CANCELLED')).toBeInTheDocument();
    expect(within(row).getByText(/Cancelled .*Duplicate entry/)).toBeInTheDocument();
  });

  it('explains the order-level limit once every receipt is cancelled', () => {
    renderCard(po({ status: 'pending', goods_receipt_notes: [grn({ cancelled_at: '2026-11-19T03:00:00Z' })] }), true);
    expect(screen.getByRole('status')).toHaveTextContent(/can no longer be cancelled itself/);
    expect(screen.queryByRole('button', { name: /Cancel receipt/ })).not.toBeInTheDocument();
  });

  it('requires a reason of at least 3 characters before confirming', () => {
    renderCard(po(), true);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel receipt GRN-0001' }));
    const dialog = screen.getByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Cancel receipt' });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'ab' } });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'Wrong PO' } });
    expect(confirm).toBeEnabled();
  });

  it('shows the translated server refusal with the product name', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: `insufficient_stock_to_reverse: product=${PRODUCT_ID} stock=2.000 to_remove=10.000` },
    });
    renderCard(po(), true);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel receipt GRN-0001' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'Wrong PO' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel receipt' }));
    await waitFor(() => expect(within(dialog).getByRole('alert')).toHaveTextContent(/Flour has 2 in stock but 10/));
    expect(rpc).toHaveBeenCalledWith('cancel_goods_receipt_v1', expect.objectContaining({ p_grn_id: 'grn-1', p_reason: 'Wrong PO' }));
  });

  it('warns about the cash payment on a cash-on-delivery receipt', () => {
    renderCard(po({ payment_terms: 'cash', goods_receipt_notes: [grn({ payment_terms: 'cash' })] }), true);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel receipt GRN-0001' }));
    expect(within(screen.getByRole('dialog')).getByText(/paid on delivery/)).toBeInTheDocument();
  });
});
