// apps/backoffice/src/features/orders/components/OrderDetailDrawer.tsx
//
// Rich order detail drawer (Sheet) opened from the Live Orders list "Details"
// button. Read-only — reuses useOrderDetail. Mirrors the reference design:
// info grid, items with per-item kitchen status, totals, and an activity log
// synthesised from order creation + payment events.

import type { JSX } from 'react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@breakery/ui';
import {
  CalendarDays,
  Clock,
  CreditCard,
  Hash,
  MapPin,
  PackageOpen,
  ReceiptText,
} from 'lucide-react';
import { cn } from '@breakery/ui';
// Formats partagés du BO (24 h, ADR-019 D5 : le fuseau ne se redéclare pas) —
// le format id-ID local (« Rp 12.000 ») divergeait du reste de l'app.
import { formatIdr, formatDateTimeShortWita, formatDateTimeWita } from '@breakery/utils';
import { useOrderDetail, type OrderDetail } from '@/features/orders/hooks/useOrderDetail.js';
import {
  ORDER_STATUS_BADGE,
  isSettledStatus,
  orderStatusBadgeTone,
  orderStatusLabel,
  orderTypeLabel,
} from '@/features/orders/statusMeta.js';

export interface OrderDetailDrawerProps {
  orderId: string | null;
  onClose: () => void;
}

const KITCHEN_TONE: Record<string, string> = {
  new: 'bg-info-soft text-info',
  preparing: 'bg-warning-soft text-warning',
  ready: 'bg-success-soft text-success',
  served: 'bg-surface-4 text-text-muted',
};

const SECTION_LABEL = 'font-data text-[11px] font-semibold uppercase tracking-widest text-text-muted';

function rp(n: number | null): string {
  const s = formatIdr(Number(n ?? 0));
  // Les cellules du tiroir préfixent déjà « Rp » : on garde le seul nombre.
  return s.replace(/^Rp\s*/, '');
}

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
      <div className="flex items-center gap-1.5 font-data text-[10px] font-semibold uppercase tracking-widest text-text-muted">
        <Icon className="h-3 w-3" aria-hidden /> {label}
      </div>
      <div className="mt-1 text-sm text-text-primary">{children}</div>
    </div>
  );
}

function Body({ order }: { order: OrderDetail }): JSX.Element {
  const firstPayment = order.payments[0];
  // RÉGLÉ : même helper que la liste et la page détail (review PR #367).
  const isPaid = order.payments.length > 0 || isSettledStatus(order.status);

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
                {it.kitchen_status && (
                  <span className={`inline-flex items-center rounded-sm px-1.5 py-0.5 font-data text-[10px] font-semibold uppercase tracking-widest ${tone}`}>
                    {ks}
                  </span>
                )}
                <span className="w-24 text-right font-data text-sm tabular-nums text-text-primary">Rp {rp(it.line_total)}</span>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Totals */}
      <div className="rounded-md border border-border-subtle p-4 text-sm">
        <Row label="Subtotal" value={`Rp ${rp(order.subtotal)}`} muted />
        {order.discount_amount > 0 && <Row label="Discount" value={`− Rp ${rp(order.discount_amount)}`} muted />}
        {order.promotions.map((promo, i) => (
          <Row key={i} label={promo.description} value={`− Rp ${rp(promo.amount)}`} muted />
        ))}
        <Row label="PB1 (included)" value={`Rp ${rp(order.tax_amount)}`} muted />
        <div className="my-2 border-t border-border-subtle" />
        <div className="flex items-center justify-between">
          <span className="text-base font-semibold text-text-primary">Total</span>
          <span className="font-data text-lg font-semibold tabular-nums text-gold">Rp {rp(order.total)}</span>
        </div>
        {firstPayment && (
          <>
            <Row label="Cash Received" value={`Rp ${rp(firstPayment.cash_received)}`} muted />
            <Row label="Change" value={`Rp ${rp(firstPayment.change_given)}`} muted />
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

export function OrderDetailDrawer({ orderId, onClose }: OrderDetailDrawerProps): JSX.Element {
  const { data, isLoading } = useOrderDetail(orderId ?? undefined);

  return (
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
      </SheetContent>
    </Sheet>
  );
}
