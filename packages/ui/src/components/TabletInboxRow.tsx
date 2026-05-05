import { useEffect, useRef, useState, type JSX } from 'react';
import { cn } from '../lib/cn.js';
import { Button } from '../primitives/Button.js';
import { Currency } from './Currency.js';

// TODO: switch to @breakery/domain types once domain agent commits TabletOrderEntry to domain index
export interface TabletOrderEntry {
  id: string;
  order_number: string;
  table_number: string | null;
  order_type: 'dine_in' | 'take_out';
  waiter_id: string;
  waiter_name: string;
  sent_to_kitchen_at: string;
  items_count: number;
  items_total: number;
}

export interface TabletInboxRowProps {
  entry: TabletOrderEntry;
  onPickup: (orderId: string) => void;
  isPicking?: boolean;
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

export function TabletInboxRow({ entry, onPickup, isPicking = false }: TabletInboxRowProps): JSX.Element {
  const now = useNow();
  const age = formatAge(entry.sent_to_kitchen_at, now);
  const orderTypeLabel = entry.order_type === 'dine_in' ? 'Dine in' : 'Take out';

  return (
    <div className="rounded-xl border border-border-subtle bg-bg-elevated px-4 py-3 flex items-center gap-4">
      <div className="flex items-center gap-2 min-w-0">
        <span className={cn('font-mono text-xl font-bold text-text-primary')}>{entry.order_number}</span>
        {entry.table_number && (
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-bg-overlay border border-border-subtle text-text-secondary">
            {entry.table_number}
          </span>
        )}
        <span className="text-xs text-text-muted">{orderTypeLabel}</span>
      </div>

      <div className="flex flex-col gap-0.5 flex-1 min-w-0">
        <span className="text-sm text-text-primary">
          {entry.items_count} item{entry.items_count !== 1 ? 's' : ''}
        </span>
        <span className="text-xs text-text-secondary">{entry.waiter_name}</span>
      </div>

      <div className="flex flex-col items-end gap-0.5">
        <span className="font-mono text-sm text-text-secondary" data-testid="age-timer">{age}</span>
        <Currency amount={entry.items_total} emphasis="normal" className="text-sm" />
      </div>

      <Button
        variant="primary"
        size="lg"
        disabled={isPicking}
        onClick={() => onPickup(entry.id)}
        aria-label={`Pickup order ${entry.order_number}`}
      >
        Pickup
      </Button>
    </div>
  );
}
