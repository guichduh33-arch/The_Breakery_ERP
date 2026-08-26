// apps/backoffice/src/pages/purchasing/PurchaseOrderDetailPage.tsx
//
// Session 14 / Phase 5.A — rewrite of the PO detail page to match the
// `PO page.jpg` + `13b-incoming-po-detail.jpg` reference family.
//
// Composition:
//   - Breadcrumbs (Purchasing › Purchase Orders › PO-####).
//   - Header row: PO number + status pill, action buttons
//     (Confirm/Receive, Cancel, Edit, Print). Le « Back » qui l'ouvrait est
//     parti au lot 9 : le fil d'Ariane est la seule sortie de la page.
//   - Two-column layout:
//       Left  — Order Information card (supplier, dates) + Ordered Items table
//               + Goods Receipt Notes table + Notes.
//       Right — Financial Summary card + Payment Status card.
//
// Receive + Cancel + Print are unchanged behaviourally — the existing dialogs
// and POPrintView component still drive those flows. The rewrite is
// presentation-only.

import { useState, type JSX } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
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
import { formatCurrency, formatQuantity } from '@breakery/utils';
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
  type UpdatePOErrorCode,
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
import { PageHeader, PAGE_TITLE_CLS } from '@/components/PageHeader.js';
import { RestrictedState } from '@/components/RestrictedState.js';
import { DetailPageSkeleton } from '@/components/DetailPageSkeleton.js';
import { QueryErrorBanner } from '@/components/QueryErrorBanner.js';
import { errorDetailText } from '@/components/errorDetailText.js';
import type { POStatus } from '@/features/purchasing/hooks/usePurchaseOrdersList.js';
import { TOOLBAR_BTN_PRIMARY, TOOLBAR_BTN_SECONDARY, TOOLBAR_ICON } from '@/components/toolbarButton.js';

/** Cellule numérique : mono tabulaire alignée à droite (The Mono-Carries-Data
 *  Rule). `tabular-nums` seul ne suffit pas — sans `font-data`, le chiffre sort
 *  dans la sans-serif de l'interface. */
const NUM_CELL = 'px-3 py-2 text-right font-data tabular-nums';

function fmtIdr(amount: number | string | null): string {
  return formatCurrency(Number(amount ?? 0));
}

// Quantités commandées / reçues. L'unité occupe sa PROPRE colonne dans la
// table des lignes : `formatQuantity` la reçoit donc à `null`, sinon chaque
// ligne l'écrirait deux fois. Le `?? 0` est conservé — une ligne sans réception
// vaut zéro reçu, ce n'est pas une valeur inconnue.
function fmtQty(quantity: number | string | null): string {
  return formatQuantity(quantity ?? 0, null);
}

/**
 * Le fil d'Ariane de la page — extrait pour être rendu AUSSI au-dessus des
 * états dégradés. Les trois branches (droit manquant, chargement, échec de
 * requête) rendaient une ligne de texte nue : plus de titre, plus de fil, plus
 * de bouton, et pour seule issue le Retour du navigateur. Un manager qui suit
 * un lien partagé vers un bon de commande qu'il ne peut pas lire doit au moins
 * savoir OÙ il est et pouvoir repartir.
 *
 * `label` remplace le numéro de PO quand on ne l'a pas encore (ou plus).
 */
function PoBreadcrumb({ label }: { label: string }): JSX.Element {
  return (
    <nav className="flex items-center gap-1 text-xs text-text-muted" aria-label="Breadcrumb">
      <Link to="/backoffice/purchasing" className="hover:text-text-primary">Purchasing</Link>
      <ChevronRight className="h-3 w-3 text-text-inert" aria-hidden />
      <Link to="/backoffice/purchasing/purchase-orders" className="hover:text-text-primary">Purchase Orders</Link>
      <ChevronRight className="h-3 w-3 text-text-inert" aria-hidden />
      <span className="font-mono text-text-secondary">{label}</span>
    </nav>
  );
}

/**
 * Coquille des états dégradés : fil d'Ariane, titre, puis le corps.
 *
 * LOT 9 — le « ← Back to purchase orders » qui suivait le titre a été retiré.
 * L'ossature commune (DESIGN.md § Page Archetypes) ne déclare QU'UN fil
 * d'Ariane ; le retour en doublait le geste avec un second vocabulaire. Le fil
 * reste rendu ici, donc l'écran dégradé garde bien une sortie — c'est la
 * condition à laquelle le retrait était subordonné.
 */
function PoDetailShell({ children }: { children: JSX.Element }): JSX.Element {
  return (
    <div className="space-y-6">
      <PoBreadcrumb label="—" />
      <PageHeader title="Purchase order" />
      {children}
    </div>
  );
}

export default function PurchaseOrderDetailPage(): JSX.Element {
  const { id }        = useParams<{ id: string }>();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canRead       = hasPermission('purchasing.po.read');
  const canReceive    = hasPermission('purchasing.po.receive');
  const canCancel     = hasPermission('purchasing.po.cancel');
  const canPay        = hasPermission('purchasing.po.pay');
  const canEdit       = hasPermission('purchasing.po.edit');

  const detail   = usePurchaseOrderDetail(id);
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
    return (
      <PoDetailShell>
        <RestrictedState what="this purchase order" permission="purchasing.po.read" />
      </PoDetailShell>
    );
  }
  if (detail.isLoading) return <DetailPageSkeleton label="Loading purchase order" blocks={3} />;
  // L'échec de requête passe par `QueryErrorBanner` — le geste que fait déjà
  // `OpnameDetailPage` : une phrase humaine, le message SERVEUR en diagnostic,
  // et un « Try again » câblé sur `refetch`. Avant, la page rendait « Failed to
  // load purchase order. » en rouge, sans détail ni moyen de réessayer : la
  // seule issue était de recharger l'onglet.
  if (detail.isError) {
    return (
      <PoDetailShell>
        <QueryErrorBanner
          detail={errorDetailText(detail.error)}
          onRetry={() => { void detail.refetch(); }}
          data-testid="po-detail-error"
        >
          This purchase order could not be loaded — nothing below is shown, so no
          figure here is a zero.
        </QueryErrorBanner>
      </PoDetailShell>
    );
  }
  const po = detail.data;
  // LOT 9 — cette branche-là n'avait AUCUN fil d'Ariane : son « ← Back to
  // purchase orders » était sa seule sortie, on ne pouvait donc pas le retirer
  // sec. Elle passe par la coquille commune, qui rend le fil ; le retour part
  // avec, et l'écran gagne au passage le titre qu'il n'avait pas.
  if (po === null || po === undefined) {
    return (
      <PoDetailShell>
        <EmptyState
          title="Purchase order not found"
          description="It may have been deleted, or you do not have access."
          size="md"
        />
      </PoDetailShell>
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
  // Fix (dev incident 2026-08-21): a cancelled PO still accepted a payment —
  // record_po_payment_v1 had no status guard, and this button was simply
  // enabled. The server now refuses it (record_po_payment_v2, po_cancelled).
  // The button itself must NOT disappear for a cancelled PO (an absent button
  // does not say why) — it stays rendered and DISABLED, same motif as `Edit`
  // below (disabled={!editable} + a visible reason). Only 'cancelled' disables
  // it here; a fully-paid PO still hides it entirely (unchanged from before).
  const payBlockedByCancel = status === 'cancelled';

  // Edit lock (D6): editable only while pending AND no GRN AND no payment.
  const hasGrn        = (po.goods_receipt_notes?.length ?? 0) > 0;
  const editable      = canEdit && status === 'pending' && !hasGrn && !hasPayments;

  async function handleReceive(args: {
    items: { poItemId: string; receivedQuantity: number }[];
    idempotencyKey: string;
  }): Promise<void> {
    setReceiveError(undefined);
    try {
      await receive.mutateAsync({
        poId:           po!.id,
        items:          args.items,
        idempotencyKey: args.idempotencyKey,
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
      const code = (e as { code?: UpdatePOErrorCode }).code;
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
          <button type="button" className={TOOLBAR_BTN_PRIMARY} onClick={() => window.print()}>
            <Printer className="h-3.5 w-3.5" aria-hidden /> Print
          </button>
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
        <PageHeader
          title={`Edit ${po.po_number}`}
          subtitle="Editing is locked once goods are received or any payment is recorded."
        />
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
      <PoBreadcrumb label={po.po_number} />

      {/* LOT 9 — un bouton « ← Back » de bandeau vivait ici, juste sous le fil
          d'Ariane, dont il doublait le geste avec un second vocabulaire. Le fil
          est la seule sortie (DESIGN.md § Page Archetypes : l'ossature commune
          n'en déclare qu'un). Il échappait aux relevés parce que son libellé est
          « Back » et non « Back to purchase orders ». */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className={`${PAGE_TITLE_CLS} tabular-nums`}>{po.po_number}</h1>
            <POStatusBadge status={status} />
          </div>
          <p className="mt-1 text-sm text-text-secondary">{po.suppliers?.name ?? '—'}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={TOOLBAR_BTN_SECONDARY} onClick={() => setShowPrint(true)}>
            <Printer className={TOOLBAR_ICON} aria-hidden /> Print
          </button>
          {canRcv && (
            <button type="button" className={TOOLBAR_BTN_PRIMARY} onClick={() => setShowReceive(true)}>
              <Truck className="h-3.5 w-3.5" aria-hidden /> Receive
            </button>
          )}
          {/* Le rouge sur la chaîne secondaire est le patron du bouton Waste
              (Inventory.tsx) : la famille TOOLBAR n'a pas de variante
              destructive, la teinte se compose (arbitré le 2026-08-19). */}
          {canCncl && (
            <button type="button" className={`${TOOLBAR_BTN_SECONDARY} text-red-as-text`} onClick={() => setShowCancel(true)}>
              <XCircle className="h-3.5 w-3.5" aria-hidden /> Cancel
            </button>
          )}
          {/* Session 46 — Edit is wired to update_purchase_order_v1, gated by
              purchasing.po.edit and locked once received or paid (D6). */}
          {canEdit && (
            <button
              type="button"
              className={TOOLBAR_BTN_SECONDARY}
              onClick={openEdit}
              disabled={!editable}
              title={editable ? undefined : 'Locked — PO already received or paid'}
            >
              <Pencil className={TOOLBAR_ICON} aria-hidden /> Edit
            </button>
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
            <SectionLabel as="h2" size="sm" id="po-ordered-items-heading" className="text-gold">Ordered Items</SectionLabel>
            <div className="overflow-x-auto rounded-md border border-border-subtle">
              <table className="w-full text-sm" aria-labelledby="po-ordered-items-heading">
                <thead className="bg-surface-inert">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-left">
                      <SectionLabel as="span" size="xs">Product</SectionLabel>
                    </th>
                    <th scope="col" className="px-3 py-2 text-right w-24">
                      <SectionLabel as="span" size="xs">Quantity</SectionLabel>
                    </th>
                    <th scope="col" className="px-3 py-2 text-right w-24">
                      <SectionLabel as="span" size="xs">Received</SectionLabel>
                    </th>
                    <th scope="col" className="px-3 py-2 text-left w-20">
                      <SectionLabel as="span" size="xs">Unit</SectionLabel>
                    </th>
                    <th scope="col" className="px-3 py-2 text-right w-28">
                      <SectionLabel as="span" size="xs">Unit price</SectionLabel>
                    </th>
                    <th scope="col" className="px-3 py-2 text-right w-32">
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
                      <td className={NUM_CELL}>{fmtQty(it.quantity)}</td>
                      <td className={NUM_CELL}>{fmtQty(it.received_quantity)}</td>
                      <td className="px-3 py-2 text-text-secondary">{it.unit}</td>
                      <td className={NUM_CELL}>{fmtIdr(it.unit_cost)}</td>
                      <td className={`${NUM_CELL} font-medium`}>{fmtIdr(it.subtotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card variant="default" padding="md" className="space-y-3">
            <SectionLabel as="h2" size="sm" id="po-grn-heading" className="text-gold">Goods Receipt Notes</SectionLabel>
            {po.goods_receipt_notes.length === 0 ? (
              <EmptyState
                title="No receipts recorded yet"
                description="The first GRN will appear here once goods have been received."
                size="sm"
              />
            ) : (
              <div className="overflow-x-auto rounded-md border border-border-subtle">
                <table className="w-full text-sm" aria-labelledby="po-grn-heading">
                  <thead className="bg-surface-inert">
                    <tr>
                      <th scope="col" className="px-3 py-2 text-left">
                        <SectionLabel as="span" size="xs">GRN</SectionLabel>
                      </th>
                      <th scope="col" className="px-3 py-2 text-left w-32">
                        <SectionLabel as="span" size="xs">Date</SectionLabel>
                      </th>
                      <th scope="col" className="px-3 py-2 text-right w-32">
                        <SectionLabel as="span" size="xs">Subtotal</SectionLabel>
                      </th>
                      <th scope="col" className="px-3 py-2 text-right w-32">
                        <SectionLabel as="span" size="xs">VAT</SectionLabel>
                      </th>
                      <th scope="col" className="px-3 py-2 text-right w-32">
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
              <Button
                type="button"
                variant="secondary"
                className="w-full"
                onClick={() => { setPayError(undefined); setShowPay(true); }}
                disabled={payBlockedByCancel}
                aria-describedby="po-payment-note"
              >
                <Wallet className="h-4 w-4" aria-hidden /> Record payment
              </Button>
            )}
            <p id="po-payment-note" className="text-xs text-text-muted">
              {payBlockedByCancel
                ? 'This purchase order is cancelled — no payment can be recorded.'
                : 'Payment is tracked independently from goods reception.'}
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
    return <Badge variant="outline" className="border-success text-success">PAID</Badge>;
  }
  if (status === 'partial') {
    return <Badge variant="outline" className="border-border-gold text-gold">PARTIAL</Badge>;
  }
  return <Badge variant="outline" className="border-danger text-danger">UNPAID</Badge>;
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }): JSX.Element {
  return (
    <div className="rounded-md bg-surface-inert px-3 py-2">
      <SectionLabel as="div" size="xs">{label}</SectionLabel>
      <div className={`mt-0.5 text-sm text-text-primary ${mono ? 'font-mono' : ''}`}>{value}</div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex items-center justify-between text-text-secondary">
      <span>{label}</span>
      <span className="font-data tabular-nums text-text-primary">{value}</span>
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
