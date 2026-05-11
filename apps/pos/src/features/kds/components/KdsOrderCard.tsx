// apps/pos/src/features/kds/components/KdsOrderCard.tsx
//
// Session 2 — KDS tile rendered once per order. Aggregates the items belonging
// to the same `order_id`, shows age, modifiers as sub-lines, and exposes
// status-aware CTAs (Start / Bump Ready / Ready badge).
//
// Border colour follows item age:
//   < 5 min : border-border-subtle
//   5–10 min: border-amber-warn
//   > 10 min: border-red animate-pulse
//
// Spec ref: §4.5.

import { Button, Badge } from '@breakery/ui';

import { useBumpItem } from '../hooks/useBumpItem';
import { useAgeTimer } from '../hooks/useAgeTimer';
import { useMarkItemServed } from '../hooks/useMarkItemServed';
import type { KdsItemRow } from '../hooks/useKdsOrders';

interface KdsOrderCardProps {
  items: KdsItemRow[];
}

const FIVE_MIN_MS = 5 * 60 * 1_000;
const TEN_MIN_MS = 10 * 60 * 1_000;

function formatAge(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function ageClassName(ageMs: number): string {
  if (ageMs >= TEN_MIN_MS) return 'border-red animate-pulse';
  if (ageMs >= FIVE_MIN_MS) return 'border-amber-warn';
  return 'border-border-subtle';
}

function ItemCta({ item }: { item: KdsItemRow }) {
  const bump = useBumpItem();
  const serve = useMarkItemServed();

  // Session 10: cancelled items have no actionable CTA — only the badge.
  if (item.is_cancelled) {
    return (
      <Badge variant="default" className="bg-red-500 text-white border-transparent">
        Cancelled
      </Badge>
    );
  }

  if (item.kitchen_status === 'pending') {
    return (
      <Button
        variant="primary"
        size="sm"
        onClick={() => {
          bump.mutate({ id: item.id, from: 'pending', to: 'preparing' });
        }}
        disabled={bump.isPending}
      >
        Start
      </Button>
    );
  }

  if (item.kitchen_status === 'preparing') {
    return (
      <Button
        variant="gold"
        size="sm"
        onClick={() => {
          bump.mutate({ id: item.id, from: 'preparing', to: 'ready' });
        }}
        disabled={bump.isPending}
      >
        Bump Ready
      </Button>
    );
  }

  if (item.kitchen_status === 'ready') {
    return (
      <Button
        variant="secondary"
        size="sm"
        className="border-green text-green hover:bg-green-soft"
        onClick={() => serve.mutate(item.id)}
        disabled={serve.isPending}
      >
        Mark Served
      </Button>
    );
  }

  return (
    <Badge variant="default" className="bg-green text-white border-transparent">
      Ready
    </Badge>
  );
}

export function KdsOrderCard({ items }: KdsOrderCardProps) {
  const now = useAgeTimer();
  const head = items[0];
  if (!head) return null;

  // The card age is driven by the *oldest* item in the order (FIFO fairness).
  const earliestSent = items.reduce<number>((min, it) => {
    const t = new Date(it.sent_to_kitchen_at).getTime();
    return Number.isFinite(t) && t < min ? t : min;
  }, Number.POSITIVE_INFINITY);
  const ageMs = Number.isFinite(earliestSent) ? now - earliestSent : 0;

  return (
    <article
      className={`rounded-lg border-2 bg-bg-elevated p-4 flex flex-col gap-3 shadow-md ${ageClassName(ageMs)}`}
    >
      <header className="flex items-center justify-between">
        <span className="text-2xl font-mono font-extrabold text-text-primary">
          #{head.order_number}
        </span>
        <span
          className="font-mono text-sm text-text-secondary"
          aria-label="Order age"
        >
          {formatAge(ageMs)}
        </span>
      </header>

      <ul className="flex flex-col gap-3">
        {items.map((item) => {
          const cancelled = item.is_cancelled;
          return (
            <li
              key={item.id}
              data-cancelled={cancelled ? 'true' : undefined}
              className={`flex items-start justify-between gap-3 border-t border-border-subtle pt-3 first:border-t-0 first:pt-0 ${cancelled ? 'opacity-60' : ''}`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className={`font-mono text-base font-bold ${cancelled ? 'text-text-muted line-through' : 'text-text-primary'}`}>
                    {item.quantity}×
                  </span>
                  <span className={`text-base truncate ${cancelled ? 'text-text-muted line-through' : 'text-text-primary'}`}>
                    {item.product_name}
                  </span>
                </div>
                {item.modifiers.length > 0 ? (
                  <ul className="mt-1 space-y-0.5">
                    {item.modifiers.map((mod, idx) => (
                      <li
                        key={`${item.id}-mod-${idx}`}
                        className={`text-xs ${cancelled ? 'text-text-muted line-through' : 'text-text-secondary'}`}
                      >
                        {mod.group_name}: {mod.option_label}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {cancelled && item.cancelled_reason && (
                  <div className="mt-1 text-xs uppercase tracking-wide text-red-400">
                    Reason: {item.cancelled_reason}
                  </div>
                )}
              </div>
              <ItemCta item={item} />
            </li>
          );
        })}
      </ul>
    </article>
  );
}
