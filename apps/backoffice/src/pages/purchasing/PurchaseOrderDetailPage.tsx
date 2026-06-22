// apps/backoffice/src/pages/purchasing/PurchaseOrderDetailPage.tsx
//
// Session 14 / Phase 5.A — rewrite of the PO detail page to match the
// `PO page.jpg` + `13b-incoming-po-detail.jpg` reference family.
//
// Composition:
//   - Breadcrumbs (Purchasing › Purchase Orders › PO-####).
//   - Header row: Back, PO number + status pill, action buttons
//     (Confirm/Receive, Cancel, Edit, Print).
//   - Two-column layout:
//       Left  — Order Information card (supplier, dates) + Ordered Items table
//               + Goods Receipt Notes table + Notes.
//       Right — Financial Summary card + Payment Status card.
//
// Receive + Cancel + Print are unchanged behaviourally — the existing dialogs
// and POPrintView component still drive those flows. The rewrite is
// presentation-only.

import { useState, type JSX } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle2,
  Pencil,
  Printer,
  Truck,
  Wallet,
  XCircle,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  SectionLabel,
} from '@breakery/ui';
import { formatIdr } from '@breakery/utils';
import { useAuthStore } from '@/stores/authStore.js';
import { usePurchaseOrderDetail } from '@/features/purchasing/hooks/usePurchaseOrderDetail.js';
import { useReceivePurchaseOrder } from '@/features/purchasing/hooks/useReceivePurchaseOrder.js';
import { useCancelPurchaseOrder } from '@/features/purchasing/hooks/useCancelPurchaseOrder.js';
import {
  usePoPayments,
  derivePaymentStatus,
  type PoPaymentStatus,
} from '@/features/purchasing/hooks/usePoPayments.js';
import { useRecordPoPayment } from '@/features/purchasing/hooks/useRecordPoPayment.js';
import {
  useUpdatePurchaseOrder,
  updatePoErrorMessage,
  type UpdatePOItemArg,
} from '@/features/purchasing/hooks/useUpdatePurchaseOrder.js';
import { useAllProductsForPO } from '@/features/purchasing/hooks/useAllProductsForPO.js';
import { useSuppliersList } from '@/features/suppliers/hooks/useSuppliersList.js';
import { POStatusBadge } from '@/features/purchasing/components/POStatusBadge.js';
import { ReceiveDialog } from '@/features/purchasing/components/ReceiveDialog.js';
import { CancelDialog } from '@/features/purchasing/components/CancelDialog.js';
import { RecordPaymentDialog } from '@/features/purchasing/components/RecordPaymentDialog.js';
import { POPrintView } from '@/features/purchasing/components/POPrintView.js';
import {
  POFormDraft,
  validatePOFormDraft,
  type POFormDraftValue,
} from '@/features/purchasing/components/POFormDraft.js';
import { useSections } from '@/features/inventory-transfers/hooks/useSections.js';
import type { POStatus } from '@/features/purchasing/hooks/usePurchaseOrdersList.js';

function fmtIdr(amount: number | string | null): string {
  return `Rp ${formatIdr(Number(amount ?? 0))}`;
}

function fmtNum(amount: number | string | null): string {
  return Number(amount ?? 0).toLocaleString('id-ID', { maximumFractionDigits: 2 });
}

export default function PurchaseOrderDetailPage(): JSX.Element {
  const navigate      = useNavigate();
  const { id }        = useParams<{ id: string }>();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canRead       = hasPermission('purchasing.po.read');
  const canReceive    = hasPermission('purchasing.po.receive');
  const canCancel     = hasPermission('purchasing.po.cancel');
  const canPay        = hasPermission('purchasing.po.pay');
  const canEdit       = hasPermission('purchasing.po.edit');

  const detail   = usePurchaseOrderDetail(id);
  const sections = useSections();
  const receive  = useReceivePurchaseOrder();
  const cancel   = useCancelPurchaseOrder();
  const payments = usePoPayments(id);
  const recordPayment = useRecordPoPayment();
  const updatePo = useUpdatePurchaseOrder();
  const products = useAllProductsForPO();
  const suppliers = useSuppliersList({ active: 'active' });

  const [showReceive, setShowReceive] = useState(false);
  const [showCancel,  setShowCancel]  = useState(false);
  const [showPrint,   setShowPrint]   = useState(false);
  const [showPay,     setShowPay]     = useState(false);
  const [showEdit,    setShowEdit]    = useState(false);
  const [editValue,   setEditValue]   = useState<POFormDraftValue | null>(null);
  const [receiveError, setReceiveError] = useState<string | undefined>(undefined);
  const [cancelError,  setCancelError]  = useState<string | undefined>(undefined);
  const [payError,     setPayError]     = useState<string | undefined>(undefined);
  const [editError,    setEditError]    = useState<string | undefined>(undefined);

  if (!canRead) {
    return <div className="text-text-secondary">You do not have permission to view this purchase order.</div>;
  }
  if (detail.isLoading) return <div className="text-text-secondary">Loading…</div>;
  if (detail.isError)    return <div className="text-danger">Failed to load purchase order.</div>;
  const po = detail.data;
  if (po === null || po === undefined) {
    return (
      <div className="space-y-4">
        <Link to="/backoffice/purchasing/purchase-orders" className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary">
          <ArrowLeft className="h-4 w-4" aria-hidden /> Back to purchase orders
        </Link>
        <EmptyState
          title="Purchase order not found"
          description="It may have been deleted, or you do not have access."
          size="md"
        />
      </div>
    );
  }

  const status   = po.status as POStatus;
  const canRcv   = canReceive && (status === 'pending' || status === 'partial');
  const canCncl  = canCancel  && status === 'pending'
                              && (po.goods_receipt_notes?.length ?? 0) === 0;

  // Payment status is DERIVED from the ledger, INDEPENDENT of goods reception (R3).
  const totalDue      = Number(po.total_amount ?? 0);
  const totalPaid     = payments.data?.totalPaid ?? 0;
  const remainingDue  = Math.max(0, Math.round((totalDue - totalPaid) * 100) / 100);
  const paymentStatus: PoPaymentStatus = derivePaymentStatus(totalPaid, totalDue);
  const hasPayments   = (payments.data?.payments.length ?? 0) > 0;
  const canRecordPay  = canPay && paymentStatus !== 'paid' && totalDue > 0;

  // Edit lock (D6): editable only while pending AND no GRN AND no payment.
  const hasGrn        = (po.goods_receipt_notes?.length ?? 0) > 0;
  const editable      = canEdit && status === 'pending' && !hasGrn && !hasPayments;

  async function handleReceive(args: {
    sectionId: string;
    items: { poItemId: string; receivedQuantity: number }[];
  }): Promise<void> {
    setReceiveError(undefined);
    try {
      await receive.mutateAsync({
        poId:       po!.id,
        sectionId:  args.sectionId,
        items:      args.items,
      });
      setShowReceive(false);
    } catch (e) {
      setReceiveError(e instanceof Error ? e.message : 'Unknown error');
    }
  }

  async function handleCancel(reason: string): Promise<void> {
    setCancelError(undefined);
    try {
      await cancel.mutateAsync({ poId: po!.id, reason });
      setShowCancel(false);
    } catch (e) {
      setCancelError(e instanceof Error ? e.message : 'Unknown error');
    }
  }

  async function handleRecordPayment(args: {
    amount: number; method: 'cash' | 'transfer' | 'card' | 'qris' | 'edc';
    reference?: string; idempotencyKey: string;
  }): Promise<void> {
    setPayError(undefined);
    try {
      await recordPayment.mutateAsync({ poId: po!.id, ...args });
      setShowPay(false);
    } catch (e) {
      setPayError(e instanceof Error ? e.message : 'Unknown error');
    }
  }

  function openEdit(): void {
    setEditError(undefined);
    const vatRate = Number(po!.subtotal) > 0
      ? Math.round((Number(po!.vat_amount) / Number(po!.subtotal)) * 10000) / 10000
      : 0.11;
    setEditValue({
      supplierId:   po!.supplier_id,
      expectedDate: po!.expected_date ?? '',
      orderDate:    po!.order_date ?? '',
      paymentTerms: (po!.payment_terms === 'cash' ? 'cash' : 'credit'),
      vatRate,
      notes:        po!.notes ?? '',
      items: po!.purchase_order_items.map((it) => ({
        productId:        it.product_id,
        quantity:         Number(it.quantity),
        unit:             it.unit ?? '',
        unitFactorToBase: Number(it.unit_factor_to_base ?? 1),
        unitCost:         Number(it.unit_cost),
        notes:            it.notes ?? '',
      })),
    });
    setShowEdit(true);
  }

  async function handleEditSubmit(): Promise<void> {
    if (editValue === null) return;
    setEditError(undefined);
    const validation = validatePOFormDraft(editValue);
    if (validation !== undefined) { setEditError(validation); return; }
    const items: UpdatePOItemArg[] = editValue.items.map((it) => ({
      product_id:           it.productId,
      quantity:             it.quantity,
      unit_factor_to_base:  it.unitFactorToBase,
      unit_cost:            it.unitCost,
      ...(it.unit.trim()  !== '' ? { unit:  it.unit.trim() }  : {}),
      ...(it.notes.trim() !== '' ? { notes: it.notes.trim() } : {}),
    }));
    try {
      await updatePo.mutateAsync({
        poId:         po!.id,
        supplierId:   editValue.supplierId,
        expectedDate: editValue.expectedDate !== '' ? editValue.expectedDate : null,
        paymentTerms: editValue.paymentTerms,
        notes:        editValue.notes,
        items,
      });
      setShowEdit(false);
      setEditValue(null);
    } catch (e) {
      const code = (e as { code?: import('@/features/purchasing/hooks/useUpdatePurchaseOrder.js').UpdatePOErrorCode }).code;
      setEditError(code !== undefined ? updatePoErrorMessage(code) : (e instanceof Error ? e.message : 'Unknown error'));
    }
  }

  if (showPrint) {
    return (
      <div className="space-y-3">
        <div className="flex gap-2 print:hidden">
          <Button type="button" variant="ghost" onClick={() => setShowPrint(false)}>
            <ArrowLeft className="h-4 w-4" aria-hidden /> Back
          </Button>
          <Button type="button" variant="gold" onClick={() => window.print()}>
            <Printer className="h-4 w-4" aria-hidden /> Print
          </Button>
        </div>
        <POPrintView po={po} />
      </div>
    );
  }

  if (showEdit && editValue !== null) {
    return (
      <div className="space-y-4 max-w-5xl">
        <Button
          type="button" variant="ghost" size="sm"
          onClick={() => { setShowEdit(false); setEditValue(null); }}
          disabled={updatePo.isPending}
        >
          <ArrowLeft className="h-4 w-4" aria-hidden /> Back to order
        </Button>
        <header>
          <h1 className="font-display text-3xl text-text-primary">Edit {po.po_number}</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Editing is locked once goods are received or any payment is recorded.
          </p>
        </header>
        <POFormDraft
          value={editValue}
          onChange={setEditValue}
          suppliers={(suppliers.data ?? []).map((s) => ({ id: s.id, code: s.code, name: s.name }))}
          products={(products.data ?? [])}
          onSubmit={() => { void handleEditSubmit(); }}
          submitting={updatePo.isPending}
          submitLabel="Save changes"
          {...(editError !== undefined ? { error: editError } : {})}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <nav className="flex items-center gap-2 text-xs text-text-secondary" aria-label="Breadcrumb">
        <Link to="/backoffice/purchasing" className="hover:text-text-primary">Purchasing</Link>
        <span aria-hidden>›</span>
        <Link to="/backoffice/purchasing/purchase-orders" className="hover:text-text-primary">Purchase Orders</Link>
        <span aria-hidden>›</span>
        <span className="text-text-primary font-mono">{po.po_number}</span>
      </nav>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Button type="button" variant="ghost" size="sm" onClick={() => navigate('/backoffice/purchasing/purchase-orders')}>
            <ArrowLeft className="h-4 w-4" aria-hidden /> Back
          </Button>
          <div className="mt-2 flex items-center gap-3">
            <h1 className="font-display text-3xl text-text-primary tabular-nums">{po.po_number}</h1>
            <POStatusBadge status={status} />
          </div>
          <p className="mt-1 text-sm text-text-secondary">{po.suppliers?.name ?? '—'}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="ghost" onClick={() => setShowPrint(true)}>
            <Printer className="h-4 w-4" aria-hidden /> Print
          </Button>
          {canRcv && (
            <Button type="button" variant="gold" onClick={() => setShowReceive(true)}>
              <Truck className="h-4 w-4" aria-hidden /> Receive
            </Button>
          )}
          {canCncl && (
            <Button type="button" variant="ghostDestructive" onClick={() => setShowCancel(true)}>
              <XCircle className="h-4 w-4" aria-hidden /> Cancel
            </Button>
          )}
          {/* Session 46 — Edit is wired to update_purchase_order_v1, gated by
              purchasing.po.edit and locked once received or paid (D6). */}
          {canEdit && (
            <Button
              type="button"
              variant="ghost"
              onClick={openEdit}
              disabled={!editable}
              title={editable ? undefined : 'Locked — PO already received or paid'}
            >
              <Pencil className="h-4 w-4" aria-hidden /> Edit
            </Button>
          )}
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-6">
          <Card variant="default" padding="md" className="space-y-4">
            <SectionLabel as="h2" size="sm" className="text-gold">Order Information</SectionLabel>
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Supplier"          value={po.suppliers?.name ?? '—'} mono />
              <Field label="Order date"        value={po.order_date ?? '—'} />
              <Field label="Expected delivery" value={po.expected_date ?? '—'} />
              <Field label="Actual delivery"   value={po.received_date ?? '—'} />
              <Field label="Payment terms"     value={po.payment_terms === 'cash' ? 'Cash on delivery' : 'Credit'} />
              {po.cancel_reason !== null && po.cancel_reason !== '' && (
                <Field label="Cancel reason"   value={po.cancel_reason} />
              )}
            </dl>
          </Card>

          <Card variant="default" padding="md" className="space-y-3">
            <SectionLabel as="h2" size="sm" className="text-gold">Ordered Items</SectionLabel>
            <div className="overflow-x-auto rounded-md border border-border-subtle">
              <table className="w-full text-sm">
                <thead className="bg-bg-base/40">
                  <tr>
                    <th className="px-3 py-2 text-left">
                      <SectionLabel as="span" size="xs">Product</SectionLabel>
                    </th>
                    <th className="px-3 py-2 text-right w-24">
                      <SectionLabel as="span" size="xs">Quantity</SectionLabel>
                    </th>
                    <th className="px-3 py-2 text-right w-24">
                      <SectionLabel as="span" size="xs">Received</SectionLabel>
                    </th>
                    <th className="px-3 py-2 text-left w-20">
                      <SectionLabel as="span" size="xs">Unit</SectionLabel>
                    </th>
                    <th className="px-3 py-2 text-right w-28">
                      <SectionLabel as="span" size="xs">Unit price</SectionLabel>
                    </th>
                    <th className="px-3 py-2 text-right w-32">
                      <SectionLabel as="span" size="xs">Subtotal</SectionLabel>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {po.purchase_order_items.map((it) => (
                    <tr key={it.id} className="border-t border-border-subtle">
                      <td className="px-3 py-2">
                        <span className="text-text-primary">{it.products?.name ?? '?'}</span>{' '}
                        <span className="text-text-secondary text-xs">({it.products?.sku ?? '—'})</span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtNum(it.quantity)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtNum(it.received_quantity)}</td>
                      <td className="px-3 py-2 text-text-secondary">{it.unit}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtIdr(it.unit_cost)}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">{fmtIdr(it.subtotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card variant="default" padding="md" className="space-y-3">
            <SectionLabel as="h2" size="sm" className="text-gold">Goods Receipt Notes</SectionLabel>
            {po.goods_receipt_notes.length === 0 ? (
              <EmptyState
                title="No receipts recorded yet"
                description="The first GRN will appear here once goods have been received."
                size="sm"
              />
            ) : (
              <div className="overflow-x-auto rounded-md border border-border-subtle">
                <table className="w-full text-sm">
                  <thead className="bg-bg-base/40">
                    <tr>
                      <th className="px-3 py-2 text-left">
                        <SectionLabel as="span" size="xs">GRN</SectionLabel>
                      </th>
                      <th className="px-3 py-2 text-left w-32">
                        <SectionLabel as="span" size="xs">Date</SectionLabel>
                      </th>
                      <th className="px-3 py-2 text-right w-32">
                        <SectionLabel as="span" size="xs">Subtotal</SectionLabel>
                      </th>
                      <th className="px-3 py-2 text-right w-32">
                        <SectionLabel as="span" size="xs">VAT</SectionLabel>
                      </th>
                      <th className="px-3 py-2 text-right w-32">
                        <SectionLabel as="span" size="xs">Total</SectionLabel>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {po.goods_receipt_notes.map((g) => (
                      <tr key={g.id} className="border-t border-border-subtle">
                        <td className="px-3 py-2 font-mono text-xs">{g.grn_number}</td>
                        <td className="px-3 py-2 text-text-secondary tabular-nums">{g.received_date}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmtIdr(g.subtotal)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmtIdr(g.vat_amount)}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-medium">{fmtIdr(g.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {po.notes !== null && po.notes !== '' && (
            <Card variant="default" padding="md" className="space-y-2">
              <SectionLabel as="h2" size="sm" className="text-gold">Notes</SectionLabel>
              <p className="text-sm text-text-secondary whitespace-pre-wrap">{po.notes}</p>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card variant="default" padding="md" className="space-y-4">
            <SectionLabel as="h2" size="sm" className="text-gold">Financial Summary</SectionLabel>
            <dl className="space-y-2 text-sm">
              <SummaryRow label="Subtotal" value={fmtIdr(po.subtotal)} />
              <SummaryRow label="Tax"      value={fmtIdr(po.vat_amount)} />
            </dl>
            <div className="flex items-baseline justify-between border-t border-border-subtle pt-3">
              <SectionLabel as="span" size="sm">Total</SectionLabel>
              <span className="font-mono text-xl tabular-nums text-gold">{fmtIdr(po.total_amount)}</span>
            </div>
          </Card>

          <Card variant="default" padding="md" className="space-y-3">
            <div className="flex items-center justify-between">
              <SectionLabel as="h2" size="sm" className="text-gold">Payment Status</SectionLabel>
              <PaymentStatusBadge status={paymentStatus} />
            </div>
            <dl className="space-y-2 text-sm">
              <SummaryRow label="Total due"  value={fmtIdr(totalDue)} />
              <SummaryRow label="Paid"       value={fmtIdr(totalPaid)} />
              <SummaryRow label="Remaining"  value={fmtIdr(remainingDue)} />
            </dl>

            {payments.data !== undefined && payments.data.payments.length > 0 && (
              <div className="space-y-1 border-t border-border-subtle pt-3">
                <SectionLabel as="div" size="xs">Payment history</SectionLabel>
                <ul className="space-y-1.5">
                  {payments.data.payments.map((p) => (
                    <li key={p.id} className="flex items-center justify-between text-xs">
                      <span className="text-text-secondary tabular-nums">
                        {p.paid_at.slice(0, 10)} · <span className="uppercase">{p.method}</span>
                        {p.reference !== null && p.reference !== '' && (
                          <span className="text-text-muted"> · {p.reference}</span>
                        )}
                      </span>
                      <span className="tabular-nums text-text-primary">{fmtIdr(p.amount)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {canRecordPay && (
              <Button type="button" variant="gold" className="w-full" onClick={() => { setPayError(undefined); setShowPay(true); }}>
                <Wallet className="h-4 w-4" aria-hidden /> Record payment
              </Button>
            )}
            <p className="text-xs text-text-muted">
              Payment is tracked independently from goods reception.
            </p>
          </Card>

          <Card variant="default" padding="md" className="space-y-2">
            <SectionLabel as="h2" size="sm" className="text-gold">Status Timeline</SectionLabel>
            <ul className="space-y-1.5 text-xs">
              <TimelineItem reached={true} label="Drafted" date={po.created_at?.slice(0, 10) ?? '—'} />
              <TimelineItem reached={status !== 'draft'} label="Confirmed / Sent" date={po.order_date ?? '—'} />
              <TimelineItem reached={status === 'partial' || status === 'received'} label="Receiving" date={po.received_date ?? po.expected_date ?? '—'} />
              <TimelineItem reached={status === 'received'} label="Received" date={po.received_date ?? '—'} />
              {status === 'cancelled' && (
                <TimelineItem reached={true} cancelled label="Cancelled" date={po.cancelled_at?.slice(0, 10) ?? '—'} />
              )}
            </ul>
          </Card>
        </div>
      </div>

      {showReceive && (
        <ReceiveDialog
          po={po}
          sections={(sections.data ?? []).map((s) => ({ id: s.id, code: s.code, name: s.name }))}
          onCancel={() => setShowReceive(false)}
          onConfirm={handleReceive}
          submitting={receive.isPending}
          {...(receiveError !== undefined ? { error: receiveError } : {})}
        />
      )}
      {showCancel && (
        <CancelDialog
          poNumber={po.po_number}
          onCancel={() => setShowCancel(false)}
          onConfirm={handleCancel}
          submitting={cancel.isPending}
          {...(cancelError !== undefined ? { error: cancelError } : {})}
        />
      )}
      {showPay && (
        <RecordPaymentDialog
          poNumber={po.po_number}
          remainingDue={remainingDue}
          onCancel={() => setShowPay(false)}
          onConfirm={handleRecordPayment}
          submitting={recordPayment.isPending}
          {...(payError !== undefined ? { error: payError } : {})}
        />
      )}
    </div>
  );
}

function PaymentStatusBadge({ status }: { status: PoPaymentStatus }): JSX.Element {
  if (status === 'paid') {
    return <Badge variant="outline" className="border-success/40 text-success">PAID</Badge>;
  }
  if (status === 'partial') {
    return <Badge variant="outline" className="border-gold/40 text-gold">PARTIAL</Badge>;
  }
  return <Badge variant="outline" className="border-danger/40 text-danger">UNPAID</Badge>;
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }): JSX.Element {
  return (
    <div className="rounded-md bg-bg-base/40 px-3 py-2">
      <SectionLabel as="div" size="xs">{label}</SectionLabel>
      <div className={`mt-0.5 text-sm text-text-primary ${mono ? 'font-mono' : ''}`}>{value}</div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex items-center justify-between text-text-secondary">
      <span>{label}</span>
      <span className="tabular-nums text-text-primary">{value}</span>
    </div>
  );
}

function TimelineItem({
  reached,
  cancelled = false,
  label,
  date,
}: {
  reached: boolean;
  cancelled?: boolean;
  label: string;
  date: string;
}): JSX.Element {
  return (
    <li className="flex items-center gap-2">
      {cancelled ? (
        <XCircle className="h-3.5 w-3.5 text-danger" aria-hidden />
      ) : (
        <CheckCircle2
          className={`h-3.5 w-3.5 ${reached ? 'text-success' : 'text-text-muted'}`}
          aria-hidden
        />
      )}
      <span className={reached ? 'text-text-primary' : 'text-text-muted'}>{label}</span>
      <span className="ml-auto text-text-muted tabular-nums">{date}</span>
    </li>
  );
}
