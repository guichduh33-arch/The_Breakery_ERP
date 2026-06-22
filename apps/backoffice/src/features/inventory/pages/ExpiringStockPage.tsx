// apps/backoffice/src/features/inventory/pages/ExpiringStockPage.tsx
//
// Session 13 — F1 expiry tracking. Backoffice page listing stock_lots whose
// expires_at falls within the next N hours (default 24h, operator-tunable).
// Each row shows :
//   - product (SKU + name),
//   - remaining quantity + unit,
//   - exact expires_at + relative "in 4h 12min" derived from hours_remaining,
//   - status pill (active / past-expiry-pending-sweep),
//   - batch number when available.
//
// Pagination = 50 lots per page (limit/offset RPC params). The query refetches
// every 60s so a freshly-flipped lot reappears as 'expired' status without a
// manual reload.

import { useMemo, useState, type JSX } from 'react';
import { Clock, AlertTriangle } from 'lucide-react';
import { Badge, Button, cn } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore.js';
import {
  useExpiringLots,
  type ExpiringLotRow,
} from '@/features/inventory/hooks/useExpiringLots.js';

const PAGE_SIZE = 50;
const WINDOW_OPTIONS = [
  { label: 'Last call (1h)',  value: 1 },
  { label: '4 hours',         value: 4 },
  { label: '8 hours',         value: 8 },
  { label: '24 hours',        value: 24 },
  { label: '48 hours',        value: 48 },
  { label: 'Week (168h)',     value: 168 },
] as const;

function formatHoursRemaining(hoursRemaining: number): string {
  if (hoursRemaining <= 0) {
    const overdue = Math.abs(hoursRemaining);
    if (overdue < 1) return `${Math.round(overdue * 60)} min overdue`;
    return `${overdue.toFixed(1)} h overdue`;
  }
  if (hoursRemaining < 1) return `${Math.round(hoursRemaining * 60)} min`;
  if (hoursRemaining < 24) return `${hoursRemaining.toFixed(1)} h`;
  return `${(hoursRemaining / 24).toFixed(1)} d`;
}

function statusPill(row: ExpiringLotRow): JSX.Element {
  if (row.hours_remaining <= 0) {
    return (
      <Badge variant="destructive" className="text-[10px] uppercase tracking-widest">
        <AlertTriangle className="h-3 w-3 mr-1" aria-hidden /> Expired
      </Badge>
    );
  }
  if (row.hours_remaining <= 4) {
    return (
      <Badge variant="destructive" className="text-[10px] uppercase tracking-widest">
        <Clock className="h-3 w-3 mr-1" aria-hidden /> Last call
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="text-[10px] uppercase tracking-widest">
      <Clock className="h-3 w-3 mr-1" aria-hidden /> Soon
    </Badge>
  );
}

export default function ExpiringStockPage(): JSX.Element {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canRead = hasPermission('inventory.read');

  const [hoursAhead, setHoursAhead] = useState<number>(24);
  const [page,       setPage      ] = useState<number>(0);

  const query = useExpiringLots(
    useMemo(
      () => ({
        hoursAhead,
        limit:  PAGE_SIZE,
        offset: page * PAGE_SIZE,
      }),
      [hoursAhead, page],
    ),
  );

  if (!canRead) {
    return (
      <div className="text-text-secondary">
        You do not have permission to view inventory.
      </div>
    );
  }

  const total = query.data?.[0]?.total_count ?? 0;
  const hasMore = (page + 1) * PAGE_SIZE < total;
  const hasPrev = page > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-serif text-3xl">Expiring stock</h1>
          <p className="text-text-secondary text-sm mt-1">
            Lots reaching their expiry threshold within the selected window.
            Past-expiry lots remain listed until the hourly sweep flips them
            and emits an auto-waste movement.
          </p>
        </div>
      </div>

      {/* Window selector */}
      <div className="flex flex-wrap items-end gap-3 bg-bg-elevated border border-border-subtle rounded-lg p-4">
        <div className="space-y-1">
          <label htmlFor="exp-window" className="text-xs uppercase tracking-widest text-text-secondary">
            Window
          </label>
          <select
            id="exp-window"
            value={hoursAhead}
            onChange={(e) => { setHoursAhead(Number(e.target.value) || 0); setPage(0); }}
            className="h-9 rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary min-w-[12rem]"
          >
            {WINDOW_OPTIONS.map((w) => (
              <option key={w.value} value={w.value}>{w.label}</option>
            ))}
          </select>
        </div>
        <div className="ml-auto text-xs text-text-secondary">
          {query.isFetching ? 'Refreshing…' : `${total.toLocaleString()} lot${total === 1 ? '' : 's'}`}
        </div>
      </div>

      {/* Table */}
      {query.isLoading && (
        <div className="text-text-secondary py-12 text-center">Loading expiring lots…</div>
      )}
      {query.error && (
        <div className="text-red py-12 text-center">
          Failed to load: {(query.error as Error).message}
        </div>
      )}
      {query.data !== undefined && query.data.length === 0 && (
        <div className="text-text-secondary py-12 text-center">
          No lots expiring within the next{' '}
          {WINDOW_OPTIONS.find((w) => w.value === hoursAhead)?.label.toLowerCase() ?? `${hoursAhead}h`}.
          {' '}Inventory is healthy.
        </div>
      )}
      {query.data !== undefined && query.data.length > 0 && (
        <div className="bg-bg-elevated rounded-lg border border-border-subtle overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-bg-overlay text-xs uppercase tracking-wide text-text-secondary">
              <tr>
                <th className="text-left px-3 py-2 w-24">SKU</th>
                <th className="text-left px-3 py-2">Product</th>
                <th className="text-left px-3 py-2 w-32">Batch</th>
                <th className="text-right px-3 py-2 w-24">Remaining</th>
                <th className="text-left px-3 py-2 w-44">Expires at</th>
                <th className="text-left px-3 py-2 w-32">In</th>
                <th className="text-left px-3 py-2 w-28">Status</th>
              </tr>
            </thead>
            <tbody>
              {query.data.map((row) => (
                <tr
                  key={row.id}
                  className={cn(
                    'border-b border-border-subtle hover:bg-bg-overlay',
                    row.hours_remaining <= 0 ? 'bg-red/5' : null,
                  )}
                >
                  <td className="px-3 py-2 font-mono text-xs text-text-secondary">{row.product_sku}</td>
                  <td className="px-3 py-2">{row.product_name}</td>
                  <td className="px-3 py-2 font-mono text-xs text-text-secondary">
                    {row.batch_number ?? '—'}
                  </td>
                  <td className="px-3 py-2 font-mono text-right">
                    {row.quantity.toLocaleString()} {row.unit}
                  </td>
                  <td className="px-3 py-2 text-text-secondary text-xs">
                    {new Date(row.expires_at).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {formatHoursRemaining(row.hours_remaining)}
                  </td>
                  <td className="px-3 py-2">{statusPill(row)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="flex items-center justify-between px-3 py-2 text-xs border-t border-border-subtle">
            <span className="text-text-secondary">
              Page {page + 1} · {total.toLocaleString()} total
            </span>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={!hasPrev}
              >
                Previous
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setPage((p) => p + 1)}
                disabled={!hasMore}
              >
                Next
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
