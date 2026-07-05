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
  PackageOpen,
  Plus,
  ReceiptText,
  Wallet,
} from 'lucide-react';
import { useOrderDetail, type OrderDetail } from '@/features/orders/hooks/useOrderDetail.js';

export interface OrderDetailDrawerProps {
  orderId: string | null;
  onClose: () => void;
}

const TYPE_LABEL: Record<string, string> = {
  dine_in: '🍽️ Dine In',
  take_out: '🍱 Takeaway',
  delivery: '🛵 Delivery',
  b2b: '🏢 B2B',
};

const STATUS_TONE: Record<string, string> = {
  completed: 'bg-emerald-100 text-emerald-700',
  paid: 'bg-emerald-100 text-emerald-700',
  voided: 'bg-rose-100 text-rose-700',
  pending_payment: 'bg-amber-100 text-amber-700',
  b2b_pending: 'bg-amber-100 text-amber-700',
  draft: 'bg-gray-100 text-gray-600',
};

const KITCHEN_TONE: Record<string, string> = {
  new: 'bg-blue-50 text-blue-600 ring-blue-200',
  preparing: 'bg-amber-50 text-amber-600 ring-amber-200',
  ready: 'bg-emerald-50 text-emerald-600 ring-emerald-200',
  served: 'bg-gray-50 text-gray-500 ring-gray-200',
};

function rp(n: number | null): string {
  return new Intl.NumberFormat('id-ID').format(Number(n ?? 0));
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fmtLogTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

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
    <div className="rounded-lg bg-bg-overlay/50 p-3">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-text-secondary">
        <Icon className="h-3 w-3" aria-hidden /> {label}
      </div>
      <div className="mt-1 text-sm text-text-primary">{children}</div>
    </div>
  );
}

function Body({ order }: { order: OrderDetail }): JSX.Element {
  const firstPayment = order.payments[0];
  const isPaid = order.payments.length > 0 || order.status === 'paid' || order.status === 'completed';

  const activity: Array<{ key: string; title: string; at: string; tone: string; icon: typeof Plus; detail?: string }> = [
    { key: 'created', title: 'Order created', at: order.created_at, tone: 'text-blue-500 ring-blue-200', icon: Plus },
    ...order.payments.map((p, i) => ({
      key: `pay-${p.id ?? i}`,
      title: 'Payment completed',
      at: p.paid_at,
      tone: 'text-emerald-500 ring-emerald-200',
      icon: Wallet,
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
        <InfoCell icon={PackageOpen} label="Type">{TYPE_LABEL[order.order_type] ?? order.order_type}</InfoCell>
        <InfoCell icon={ReceiptText} label="Payment Status">
          {isPaid ? (
            <span className="font-medium text-emerald-600">✓ Paid</span>
          ) : (
            <span className="font-medium text-amber-600">Unpaid</span>
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
      <div className="rounded-xl border border-border-subtle p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-gold">
          <PackageOpen className="h-4 w-4" aria-hidden /> Items ({order.items.length})
        </div>
        <ul className="divide-y divide-border-subtle">
          {order.items.map((it) => {
            const ks = (it.kitchen_status ?? '').toLowerCase();
            const tone = KITCHEN_TONE[ks] ?? 'bg-gray-50 text-gray-500 ring-gray-200';
            return (
              <li key={it.id} className={`flex items-center gap-3 py-2.5 ${it.is_cancelled ? 'opacity-50 line-through' : ''}`}>
                <span className="font-mono text-sm text-gold">{it.quantity}x</span>
                <span className="flex-1 text-sm text-text-primary">{it.name_snapshot}</span>
                {it.kitchen_status && (
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ring-1 ${tone}`}>
                    <Clock className="h-2.5 w-2.5" aria-hidden /> {ks}
                  </span>
                )}
                <span className="w-24 text-right font-mono text-sm text-text-primary">Rp {rp(it.line_total)}</span>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Totals */}
      <div className="rounded-xl border border-border-subtle p-4 text-sm">
        <Row label="Subtotal" value={`Rp ${rp(order.subtotal)}`} muted />
        {order.discount_amount > 0 && <Row label="Discount" value={`− Rp ${rp(order.discount_amount)}`} muted />}
        {order.promotions.map((promo, i) => (
          <Row key={i} label={promo.description} value={`− Rp ${rp(promo.amount)}`} muted />
        ))}
        <Row label="Tax (10%)" value={`Rp ${rp(order.tax_amount)}`} muted />
        <div className="my-2 border-t border-border-subtle" />
        <div className="flex items-center justify-between">
          <span className="text-base font-semibold text-gold">Total</span>
          <span className="font-mono text-lg font-semibold text-gold">Rp {rp(order.total)}</span>
        </div>
        {firstPayment && (
          <>
            <Row label="Cash Received" value={`Rp ${rp(firstPayment.cash_received)}`} muted />
            <Row label="Change" value={`Rp ${rp(firstPayment.change_given)}`} muted />
          </>
        )}
      </div>

      {/* Activity log */}
      <div className="rounded-xl border border-border-subtle p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-gold">
          <Clock className="h-4 w-4" aria-hidden /> Activity Log
        </div>
        <ol className="space-y-3">
          {activity.map((ev) => {
            const Icon = ev.icon;
            return (
              <li key={ev.key} className="flex gap-3">
                <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ring-2 ${ev.tone}`}>
                  <Icon className="h-3 w-3" aria-hidden />
                </span>
                <div className="flex-1">
                  <div className="text-sm font-medium text-text-primary">{ev.title}</div>
                  {ev.detail && (
                    <div className="mt-1 rounded-md border border-border-subtle px-2 py-1 text-xs text-text-secondary">{ev.detail}</div>
                  )}
                  <div className="mt-1 text-xs text-text-muted">{fmtLogTime(ev.at)}</div>
                </div>
              </li>
            );
          })}
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
          <SheetTitle className="flex items-center gap-2 font-serif">
            <Hash className="h-5 w-5 text-gold" aria-hidden />
            Order {data ? `#${data.order_number.replace(/^#+/, '')}` : ''}
            {data && (
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase ${STATUS_TONE[data.status] ?? 'bg-gray-100 text-gray-600'}`}>
                {data.status}
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
