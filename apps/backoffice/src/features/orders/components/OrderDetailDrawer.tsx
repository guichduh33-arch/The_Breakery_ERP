// apps/backoffice/src/features/orders/components/OrderDetailDrawer.tsx
//
// Tiroir de détail d'une commande (Sheet), ouvert depuis l'icône œil de la
// liste. C'est l'APERÇU CANONIQUE : il montre la même vérité que la page
// /backoffice/orders/:id (mêmes définitions de règlement et de totaux, même
// encre pour le total), il y renvoie d'un lien, et il porte les gestes métier
// EXISTANTS de la liste — Edit items et Void, aux mêmes gates et aux mêmes
// conditions de statut.
//
// Les MODALES ne vivent pas ici : la liste les possède déjà (EditOrderItemsModal,
// VoidOrderModal avec sa clé d'idempotence). Le tiroir remonte l'intention par
// callback — deux surfaces, un seul flux, une seule clé d'idempotence.

import { useState, type JSX } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@breakery/ui';
import {
  CalendarDays,
  Clock,
  CreditCard,
  Download,
  Edit3,
  ExternalLink,
  Hash,
  MapPin,
  PackageOpen,
  ReceiptText,
  Undo2,
  XCircle,
} from 'lucide-react';
import { cn } from '@breakery/ui';
// Formats partagés du BO (24 h, ADR-019 D5 : le fuseau ne se redéclare pas).
// Les montants passent par `formatCurrency`, qui pose lui-même le préfixe
// « Rp » — audit UX/UI 2026-08-13, lot 1.
import { formatCurrency, formatDateTimeShortWita, formatDateTimeWita } from '@breakery/utils';
import { TOOLBAR_BTN, TOOLBAR_BTN_SECONDARY } from '@/components/toolbarButton.js';
import { useOrderDetail, type OrderDetail } from '@/features/orders/hooks/useOrderDetail.js';
import { RefundOrderModalBo } from '@/features/orders/components/RefundOrderModalBo.js';
import { useReprintReceipt } from '@/features/orders/hooks/useReprintReceipt.js';
import {
  ORDER_STATUS_BADGE,
  isOrderDetailPaid,
  orderStatusBadgeTone,
  orderStatusLabel,
  orderTypeLabel,
} from '@/features/orders/statusMeta.js';
import { useAuthStore } from '@/stores/authStore.js';

export interface OrderDetailDrawerProps {
  orderId: string | null;
  onClose: () => void;
  /**
   * Ouvre l'édition d'items sur la surface appelante. Absent = le tiroir ne
   * propose pas le geste (aperçu strictement lecture seule).
   */
  onEditItems?: (orderId: string, orderNumber: string) => void;
  /** Ouvre l'annulation sur la surface appelante (PIN + idempotence côté modale). */
  onVoid?: (orderId: string, orderNumber: string) => void;
}

/** Statuts éditables — même liste que la liste (ADR-009 : jamais `'open'`). */
const EDITABLE_STATUSES = new Set(['draft', 'pending_payment']);
/** Statuts annulables — le void est la seule sortie de `completed` (ADR-009). */
const VOIDABLE_STATUSES = new Set(['paid', 'completed']);
/** Statuts remboursables — une commande portant l'argent (lot 6c). */
const REFUNDABLE_STATUSES = new Set(['paid', 'completed']);

const BTN_DANGER = `${TOOLBAR_BTN} border border-red bg-bg-elevated text-red-as-text hover:bg-red-soft`;

const KITCHEN_TONE: Record<string, string> = {
  new: 'bg-info-soft text-info',
  preparing: 'bg-warning-soft text-warning',
  ready: 'bg-success-soft text-success',
  served: 'bg-surface-4 text-text-muted',
};

const SECTION_LABEL = 'font-data text-xs font-semibold uppercase tracking-widest text-text-muted';

const fmtDateTime = formatDateTimeShortWita;
const fmtLogTime = formatDateTimeWita;

function InfoCell({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Hash;
  label: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="rounded-md bg-surface-inert p-3">
      <div className="flex items-center gap-1.5 font-data text-xs font-semibold uppercase tracking-widest text-text-muted">
        <Icon className="h-3 w-3" aria-hidden /> {label}
      </div>
      <div className="mt-1 text-sm text-text-primary">{children}</div>
    </div>
  );
}

function Body({ order }: { order: OrderDetail }): JSX.Element {
  const firstPayment = order.payments[0];
  // RÉGLÉ : définition UNIQUE, partagée avec la page détail. Le tiroir oubliait
  // `paid_at` et lisait « Unpaid » sur des règlements B2B (audit lot 6a).
  const isPaid = isOrderDetailPaid(order);
  // Une commande jamais envoyée au KDS porte le DEFAULT 'pending' de
  // `order_items.kitchen_status` sans qu'aucun cuisinier ne l'ait vu : afficher
  // ce badge ferait lire « impayé » là où il n'y a pas de cycle cuisine.
  const wentToKitchen = order.sent_to_kitchen_at != null;

  const activity: { key: string; title: string; at: string; tone: string; detail?: string }[] = [
    { key: 'created', title: 'Order created', at: order.created_at, tone: 'bg-info' },
    ...order.payments.map((p, i) => ({
      key: `pay-${p.id ?? i}`,
      title: 'Payment completed',
      at: p.paid_at,
      tone: 'bg-success',
      detail: `Method: ${p.method}`,
    })),
  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  return (
    <div className="flex-1 space-y-5 overflow-y-auto px-6 pb-8">
      {/* Info grid */}
      <div className="grid grid-cols-2 gap-3">
        <InfoCell icon={Hash} label="Transaction ID">
          <span className="font-mono text-xs">{order.id.slice(0, 8)} …</span>
        </InfoCell>
        <InfoCell icon={CalendarDays} label="Date & Time">{fmtDateTime(order.created_at)}</InfoCell>
        <InfoCell icon={PackageOpen} label="Type">{orderTypeLabel(order.order_type)}</InfoCell>
        {/* Fiche 02 D2.5 — table visible au BO ; l'historique des transferts se
            consulte dans le journal d'audit (action order.table_transfer). */}
        <InfoCell icon={MapPin} label="Table">
          {order.table_number ?? '—'}
        </InfoCell>
        <InfoCell icon={ReceiptText} label="Payment Status">
          {isPaid ? (
            <span className="font-medium text-success">Paid</span>
          ) : (
            <span className="font-medium text-warning">Unpaid</span>
          )}
        </InfoCell>
        <InfoCell icon={CreditCard} label="Payment Method">
          {firstPayment ? <span className="capitalize">{firstPayment.method}</span> : '—'}
        </InfoCell>
        <InfoCell icon={Clock} label="Payment Time">
          {firstPayment ? fmtDateTime(firstPayment.paid_at) : '—'}
        </InfoCell>
      </div>

      {/* Items */}
      <div className="rounded-md border border-border-subtle p-4">
        <h3 className={SECTION_LABEL}>Items ({order.items.length})</h3>
        <ul className="mt-2 divide-y divide-border-row">
          {order.items.map((it) => {
            const ks = (it.kitchen_status ?? '').toLowerCase();
            const tone = KITCHEN_TONE[ks] ?? 'bg-surface-4 text-text-muted';
            return (
              <li key={it.id} className={`flex items-center gap-3 py-2.5 ${it.is_cancelled ? 'opacity-50 line-through' : ''}`}>
                <span className="font-data text-sm tabular-nums text-text-secondary">{it.quantity}×</span>
                <span className="flex-1 text-sm text-text-primary">{it.name_snapshot}</span>
                {/* Le badge NOMME sa dimension : c'est le cycle CUISINE, pas
                    l'encaissement — et il ne se rend pas du tout si la
                    commande n'est jamais passée en cuisine. */}
                {wentToKitchen && it.kitchen_status && (
                  <span className={`inline-flex items-center rounded-sm px-1.5 py-0.5 font-data text-xs font-semibold uppercase tracking-widest ${tone}`}>
                    Kitchen: {ks}
                  </span>
                )}
                <span className="w-24 text-right font-data text-sm tabular-nums text-text-primary">{formatCurrency(it.line_total)}</span>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Totals — MÊME ordre et mêmes libellés que la page détail.
          NON-PKP (ADR-005) : la PB1 est INCLUSE dans le total. La base s'en
          déduit à l'affichage (`subtotal − tax_amount`) ; rien n'est recalculé
          côté serveur. Le total est en ENCRE : l'or est une encre de sens, pas
          un remplissage — la page l'affiche déjà ainsi. */}
      <div className="rounded-md border border-border-subtle p-4 text-sm">
        <Row label="Base (excl. PB1)" value={formatCurrency(order.subtotal - order.tax_amount)} muted />
        {order.discount_amount > 0 && <Row label="Discount" value={`− ${formatCurrency(order.discount_amount)}`} muted />}
        {order.promotions.map((promo, i) => (
          <Row key={i} label={promo.description} value={`− ${formatCurrency(promo.amount)}`} muted />
        ))}
        {/* Seule ligne fiscale du bloc : elle cesse d'être en creux. */}
        <Row label="PB1 (included)" value={formatCurrency(order.tax_amount)} />
        <div className="my-2 border-t border-border-subtle" />
        <div className="flex items-center justify-between">
          <span className="text-base font-semibold text-text-primary">Total (incl. PB1)</span>
          <span className="font-data text-lg font-semibold tabular-nums text-text-primary">{formatCurrency(order.total)}</span>
        </div>
        {firstPayment && (
          <>
            <Row label="Cash Received" value={formatCurrency(firstPayment.cash_received)} muted />
            <Row label="Change" value={formatCurrency(firstPayment.change_given)} muted />
          </>
        )}
      </div>

      {/* Activity log */}
      <div className="rounded-md border border-border-subtle p-4">
        <h3 className={SECTION_LABEL}>Activity</h3>
        <ol className="mt-2 space-y-3">
          {activity.map((ev) => (
            <li key={ev.key} className="flex gap-3">
              {/* Point d'état, pas une pastille décorative. */}
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${ev.tone}`} aria-hidden />
              <div className="flex-1">
                <div className="text-sm font-medium text-text-primary">{ev.title}</div>
                {ev.detail && (
                  <div className="mt-0.5 text-xs text-text-secondary">{ev.detail}</div>
                )}
                <div className="mt-0.5 font-data text-xs tabular-nums text-text-muted">{fmtLogTime(ev.at)}</div>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }): JSX.Element {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className={muted ? 'text-text-secondary' : 'text-text-primary'}>{label}</span>
      <span className="font-mono text-text-secondary">{value}</span>
    </div>
  );
}

export function OrderDetailDrawer({
  orderId, onClose, onEditItems, onVoid,
}: OrderDetailDrawerProps): JSX.Element {
  const { data, isLoading } = useOrderDetail(orderId ?? undefined);
  // Mêmes gates que la liste — la permission se lit à la source, elle ne se
  // transporte pas en prop (une prop peut mentir, le store non).
  const hasEditOpen = useAuthStore((s) => s.hasPermission('orders.edit_open'));
  const hasVoid     = useAuthStore((s) => s.hasPermission('orders.void'));
  const hasRefund   = useAuthStore((s) => s.hasPermission('orders.refund'));
  const hasReprint  = useAuthStore((s) => s.hasPermission('orders.reprint_receipt'));

  // Le refund est POSSÉDÉ par le tiroir (contrairement à Void/Edit, hissés vers
  // la liste) : aucune surface concurrente ne le déclenche, la modale vit donc
  // ici, en état local — zéro couplage à la page de liste.
  const [refundOpen, setRefundOpen] = useState(false);
  const reprint = useReprintReceipt();

  // Reste remboursable = le total moins ce qui est déjà remboursé.
  const canRefund =
    data !== undefined && hasRefund
    && REFUNDABLE_STATUSES.has(data.status)
    && data.total_refunded < data.total;
  // Le reçu duplicata n'a de sens que sur une commande qui a porté l'argent.
  const canReprint = data !== undefined && hasReprint && isOrderDetailPaid(data);

  // Les gestes sont des CLOSURES, pas des booléens : la garde et l'appel
  // partagent le même narrowing, personne ne réaffirme la condition en `!`.
  const editAction =
    data !== undefined && onEditItems !== undefined
      && hasEditOpen && EDITABLE_STATUSES.has(data.status)
      ? (): void => { onEditItems(data.id, data.order_number); }
      : null;
  const voidAction =
    data !== undefined && onVoid !== undefined
      && hasVoid && VOIDABLE_STATUSES.has(data.status)
      ? (): void => { onVoid(data.id, data.order_number); }
      : null;

  return (
    <>
    <Sheet open={orderId !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full max-w-md sm:max-w-lg" data-testid="order-detail-drawer">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Hash className="h-5 w-5 text-gold" aria-hidden />
            Order {data ? `#${data.order_number.replace(/^#+/, '')}` : ''}
            {data && (
              <span className={cn(ORDER_STATUS_BADGE, orderStatusBadgeTone(data.status))}>
                {orderStatusLabel(data.status)}
              </span>
            )}
          </SheetTitle>
          <SheetDescription className="sr-only">Order details and activity</SheetDescription>
        </SheetHeader>

        {isLoading || !data ? (
          <div className="px-6 py-12 text-center text-text-secondary">Loading…</div>
        ) : (
          <Body order={data} />
        )}

        {data !== undefined && (
          <SheetFooter className="sm:justify-between">
            {/* L'aperçu n'est jamais un cul-de-sac : il ouvre le document
                complet, et se ferme en y allant (deux surfaces empilées
                mentiraient sur ce qui a le focus). */}
            <Link
              to={`/backoffice/orders/${data.id}`}
              onClick={onClose}
              className={TOOLBAR_BTN_SECONDARY}
              data-testid="drawer-open-full-page"
            >
              <ExternalLink className="h-3.5 w-3.5 text-text-muted" aria-hidden />
              Open full page
            </Link>
            {(editAction !== null || voidAction !== null || canRefund || canReprint) && (
              <span className="flex flex-wrap justify-end gap-2">
                {canReprint && (
                  <button
                    type="button"
                    className={TOOLBAR_BTN_SECONDARY}
                    data-testid="drawer-reprint"
                    disabled={reprint.isPending}
                    onClick={() => {
                      reprint.reprint(data, {
                        onError: (e) => { toast.error(e.message || 'Could not generate the receipt'); },
                      });
                    }}
                  >
                    <Download className="h-3.5 w-3.5 text-text-muted" aria-hidden />
                    {reprint.isPending ? 'Preparing…' : 'Download receipt (PDF)'}
                  </button>
                )}
                {editAction !== null && (
                  <button
                    type="button"
                    className={TOOLBAR_BTN_SECONDARY}
                    data-testid="drawer-edit-items"
                    onClick={editAction}
                  >
                    <Edit3 className="h-3.5 w-3.5 text-text-muted" aria-hidden />
                    Edit items
                  </button>
                )}
                {canRefund && (
                  <button
                    type="button"
                    className={BTN_DANGER}
                    data-testid="drawer-refund"
                    onClick={() => { setRefundOpen(true); }}
                  >
                    <Undo2 className="h-3.5 w-3.5" aria-hidden />
                    Refund
                  </button>
                )}
                {voidAction !== null && (
                  <button
                    type="button"
                    className={BTN_DANGER}
                    data-testid="drawer-void"
                    onClick={voidAction}
                  >
                    <XCircle className="h-3.5 w-3.5" aria-hidden />
                    Void
                  </button>
                )}
              </span>
            )}
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
    {data !== undefined && (
      <RefundOrderModalBo
        open={refundOpen}
        order={data}
        onClose={() => { setRefundOpen(false); }}
      />
    )}
    </>
  );
}
