// apps/backoffice/src/features/inventory/components/ExpiringLotsBadge.tsx
//
// Session 13 — F1 expiry tracking. Sidebar / nav badge rendering the COUNT of
// stock_lots expiring within the next 24 hours. Clickable → navigates to the
// expiring page. Hidden when count = 0 so the sidebar stays clean.
//
// Polls every 60s (same cadence as the parent page hook) to keep the count
// fresh without hammering the RPC.

import { useMemo, type JSX } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge, cn } from '@breakery/ui';
import { useExpiringLots } from '../hooks/useExpiringLots.js';

export interface ExpiringLotsBadgeProps {
  /** Hours-ahead window for the count. Defaults to 24h. */
  hoursAhead?: number;
  /** When true, only the count number is rendered (no icon / no link wrap). */
  compact?:    boolean;
  className?:  string;
}

export function ExpiringLotsBadge({
  hoursAhead = 24,
  compact = false,
  className,
}: ExpiringLotsBadgeProps): JSX.Element | null {
  // Fetch a single page — we only need the total_count header on row 0.
  const query = useExpiringLots({ hoursAhead, limit: 1, offset: 0 });

  const count = useMemo<number>(() => {
    if (query.data === undefined) return 0;
    if (query.data.length === 0)  return 0;
    return query.data[0]!.total_count;
  }, [query.data]);

  if (query.isLoading) return null;
  if (count === 0)      return null;

  if (compact) {
    return (
      <Badge
        variant="destructive"
        className={cn('text-[10px] uppercase tracking-widest', className)}
        aria-label={`${count} expiring lots`}
      >
        {count}
      </Badge>
    );
  }

  return (
    <Link
      to="/backoffice/inventory/expiring"
      className={cn(
        'inline-flex items-center gap-2 text-xs text-red hover:underline focus-visible:underline focus:outline-none',
        className,
      )}
      aria-label={`${count} stock lots expiring within ${hoursAhead} hours — open expiring page`}
    >
      <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
      <span>
        {count} expiring
        {hoursAhead === 24 ? ' (24h)' : ` (${hoursAhead}h)`}
      </span>
    </Link>
  );
}
