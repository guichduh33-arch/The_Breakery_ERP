import { useEffect, useRef, useState, type JSX } from 'react';
import { cn } from '../lib/cn.js';
import { Badge } from '../primitives/Badge.js';
import { Button } from '../primitives/Button.js';

export type OrderStatus = 'pending_payment' | 'draft' | 'paid' | 'voided';
export type KitchenStatus = 'pending' | 'preparing' | 'ready' | 'served';

export interface TabletOrderItem {
  id: string;
  name: string;
  quantity: number;
  kitchen_status: KitchenStatus;
}

export interface TabletOrderCardOrder {
  id: string;
  order_number: string;
  table_number: string | null;
  order_type: 'dine_in' | 'take_out';
  sent_to_kitchen_at: string;
  status: OrderStatus;
  items: TabletOrderItem[];
}

export interface TabletOrderCardProps {
  order: TabletOrderCardOrder;
  onCancel?: (orderId: string) => void;
  isCancelling?: boolean;
}

function useNow(intervalMs = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  const ref = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    ref.current = setInterval(() => setNow(new Date()), intervalMs);
    return () => {
      if (ref.current !== null) clearInterval(ref.current);
    };
  }, [intervalMs]);

  return now;
}

function formatAge(sentAt: string, now: Date): string {
  const diffSec = Math.max(0, Math.floor((now.getTime() - new Date(sentAt).getTime()) / 1000));
  const m = Math.floor(diffSec / 60);
  const s = diffSec % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

// Design audit 2026-07-07 (Tablet I-1) — semantic tokens, theme-aware.
const STATUS_BADGE_CLASS: Record<OrderStatus, string> = {
  pending_payment: 'border-transparent bg-warning-soft text-warning',
  draft: 'border-transparent bg-info-soft text-info',
  paid: 'border-transparent bg-success-soft text-success',
  voided: 'border-transparent bg-danger-soft text-danger',
};

const STATUS_LABEL: Record<OrderStatus, string> = {
  pending_payment: 'Pending Payment',
  draft: 'Draft',
  paid: 'Paid',
  voided: 'Voided',
};

const KITCHEN_PILL_CLASS: Record<KitchenStatus, string> = {
  pending: 'bg-bg-overlay text-text-secondary',
  preparing: 'bg-warning-soft text-warning',
  ready: 'bg-success-soft text-success',
  served: 'bg-bg-overlay text-text-muted line-through',
};

// Design audit 2026-07-07 (Tablet) — humanized labels for the client-facing
// kitchen status pills (raw enum values stay unchanged in the data layer).
const KITCHEN_LABEL: Record<KitchenStatus, string> = {
  pending: 'In queue',
  preparing: 'Preparing',
  ready: 'Ready',
  served: 'Served',
};

function KitchenPill({ status }: { status: KitchenStatus }): JSX.Element {
  return (
    <span className={cn('text-xs font-semibold px-2 py-0.5 rounded-full', KITCHEN_PILL_CLASS[status])}>
      {KITCHEN_LABEL[status]}
    </span>
  );
}

export function TabletOrderCard({ order, onCancel, isCancelling = false }: TabletOrderCardProps): JSX.Element {
  const now = useNow();
  const age = formatAge(order.sent_to_kitchen_at, now);
  const orderTypeLabel = order.order_type === 'dine_in' ? 'Dine in' : 'Take out';
  const showCancel = order.status === 'pending_payment' && onCancel !== undefined;

  return (
    <div className="rounded-xl border border-border-subtle bg-bg-elevated flex flex-col">
      <div className="px-4 pt-3 pb-2 flex items-center justify-between gap-2">
        <span className="font-mono text-lg font-bold text-text-primary">{order.order_number}</span>
        <Badge className={cn(STATUS_BADGE_CLASS[order.status])}>
          {STATUS_LABEL[order.status]}
        </Badge>
      </div>

      <div className="px-4 pb-2 flex items-center gap-2 text-xs text-text-secondary">
        {order.table_number && (
          <span className="font-semibold px-2 py-0.5 rounded-full bg-bg-overlay border border-border-subtle">
            {order.table_number}
          </span>
        )}
        <span>{orderTypeLabel}</span>
        <span className="font-mono" data-testid="card-age-timer">{age}</span>
      </div>

      <ul className="px-4 pb-3 flex flex-col gap-1.5">
        {order.items.map((item) => (
          <li key={item.id} className="flex items-center justify-between gap-2">
            <span className="text-sm text-text-primary">
              {item.name}
              <span className="ml-1 text-text-secondary font-mono">×{item.quantity}</span>
            </span>
            <KitchenPill status={item.kitchen_status} />
          </li>
        ))}
      </ul>

      {showCancel && (
        <div className="px-4 pb-3 border-t border-border-subtle pt-3">
          <Button
            variant="ghostDestructive"
            size="lg"
            className="w-full"
            disabled={isCancelling}
            onClick={() => onCancel?.(order.id)}
            aria-label={`Cancel order ${order.order_number}`}
          >
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}
