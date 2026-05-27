// apps/backoffice/src/pages/orders/OrdersListPage.tsx
// Session 32 / Wave 3.B + 3.K — Orders list page with full audit-grade filters.
// URL state = source of truth. Cursor-paginated infinite scroll.
//
// Out of scope V1 :
//   - terminal filter (DEV-S32-1.A-01 — orders has no terminal_id col)
//   - refund_status / has_modifiers server-side filter (V1 client-side post-fetch only)
//   - "+ New Order" button (deferred S33+)

import { type JSX, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  useOrdersList,
  type OrdersListFilters,
  type OrdersListLine,
} from '@/features/orders/hooks/useOrdersList.js';

function defaultStart(): string {
  return new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
}
function defaultEnd(): string {
  return new Date().toISOString().slice(0, 10);
}

function fmtIdr(n: number): string {
  return new Intl.NumberFormat('id-ID').format(n);
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('id-ID', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

const STATUSES      = ['', 'open', 'completed', 'voided', 'refunded'] as const;
const ORDER_TYPES   = ['', 'dine_in', 'takeaway', 'tablet', 'b2b'] as const;
const PAYMENT_METHODS = ['', 'cash', 'card', 'qris', 'edc', 'transfer', 'store_credit'] as const;
const CUSTOMER_TYPES = ['', 'retail', 'b2b'] as const;
const REFUND_STATUSES = ['', 'none', 'partial', 'full'] as const;

export default function OrdersListPage(): JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();

  const start = searchParams.get('start') ?? defaultStart();
  const end   = searchParams.get('end')   ?? defaultEnd();

  const filters: OrdersListFilters = useMemo(() => {
    const f: OrdersListFilters = {};
    const s    = searchParams.get('status');         if (s)  f.status = s;
    const ot   = searchParams.get('order_type');     if (ot) f.order_type = ot;
    const ci   = searchParams.get('customer_id');    if (ci) f.customer_id = ci;
    const sb   = searchParams.get('served_by');      if (sb) f.served_by = sb;
    const pm   = searchParams.get('payment_method'); if (pm) f.payment_method = pm;
    const ct   = searchParams.get('customer_type');
    if (ct === 'retail' || ct === 'b2b') f.customer_type = ct;
    const tmin = searchParams.get('total_min');      if (tmin) f.total_min = Number(tmin);
    const tmax = searchParams.get('total_max');      if (tmax) f.total_max = Number(tmax);
    return f;
  }, [searchParams]);

  const query = useOrdersList({ start, end, filters });

  // Server-side server-fetched lines, then client-side post-filter for refund_status / has_modifiers / hour.
  const allLines: OrdersListLine[] = (query.data?.pages ?? []).flatMap((p) => p.lines);
  const refundFilter   = searchParams.get('refund_status') ?? '';
  const modifiersParam = searchParams.get('has_modifiers');
  const hourParam      = searchParams.get('hour');
  const lines = allLines.filter((o) => {
    if (refundFilter && o.refund_status !== refundFilter) return false;
    if (modifiersParam === 'true'  && !o.has_modifiers)   return false;
    if (modifiersParam === 'false' &&  o.has_modifiers)   return false;
    if (hourParam !== null && hourParam !== '') {
      const h = new Date(o.created_at).getHours();
      if (h !== Number(hourParam)) return false;
    }
    return true;
  });

  function setParam(key: string, value: string | undefined): void {
    const next = new URLSearchParams(searchParams);
    if (value === undefined || value === '') next.delete(key);
    else next.set(key, value);
    setSearchParams(next, { replace: true });
  }

  const activeFilterEntries = Array.from(searchParams.entries()).filter(
    ([k]) => k !== 'start' && k !== 'end',
  );

  return (
    <div className="space-y-4 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Orders</h1>
        <p className="text-sm text-muted-foreground">
          {lines.length} loaded
          {hourParam || refundFilter || modifiersParam
            ? ' (post-filter applied client-side)'
            : ''}
        </p>
      </header>

      {/* Filters bar */}
      <section className="grid grid-cols-1 gap-3 md:grid-cols-3" data-testid="orders-filters-bar">
        <label className="flex flex-col text-sm">
          <span className="text-muted-foreground">Start</span>
          <input type="date" value={start} onChange={(e) => setParam('start', e.target.value)} className="border rounded px-2 py-1" />
        </label>
        <label className="flex flex-col text-sm">
          <span className="text-muted-foreground">End</span>
          <input type="date" value={end} onChange={(e) => setParam('end', e.target.value)} className="border rounded px-2 py-1" />
        </label>
        <label className="flex flex-col text-sm">
          <span className="text-muted-foreground">Status</span>
          <select value={searchParams.get('status') ?? ''} onChange={(e) => setParam('status', e.target.value || undefined)} className="border rounded px-2 py-1">
            {STATUSES.map((s) => <option key={s} value={s}>{s || 'Any status'}</option>)}
          </select>
        </label>
        <label className="flex flex-col text-sm">
          <span className="text-muted-foreground">Order type</span>
          <select value={searchParams.get('order_type') ?? ''} onChange={(e) => setParam('order_type', e.target.value || undefined)} className="border rounded px-2 py-1">
            {ORDER_TYPES.map((s) => <option key={s} value={s}>{s || 'Any type'}</option>)}
          </select>
        </label>
        <label className="flex flex-col text-sm">
          <span className="text-muted-foreground">Payment method</span>
          <select value={searchParams.get('payment_method') ?? ''} onChange={(e) => setParam('payment_method', e.target.value || undefined)} className="border rounded px-2 py-1">
            {PAYMENT_METHODS.map((s) => <option key={s} value={s}>{s || 'Any method'}</option>)}
          </select>
        </label>
        <label className="flex flex-col text-sm">
          <span className="text-muted-foreground">Customer type</span>
          <select value={searchParams.get('customer_type') ?? ''} onChange={(e) => setParam('customer_type', e.target.value || undefined)} className="border rounded px-2 py-1">
            {CUSTOMER_TYPES.map((s) => <option key={s} value={s}>{s || 'Any'}</option>)}
          </select>
        </label>
        <label className="flex flex-col text-sm">
          <span className="text-muted-foreground">Refund status (client-side)</span>
          <select value={searchParams.get('refund_status') ?? ''} onChange={(e) => setParam('refund_status', e.target.value || undefined)} className="border rounded px-2 py-1">
            {REFUND_STATUSES.map((s) => <option key={s} value={s}>{s || 'Any'}</option>)}
          </select>
        </label>
        <label className="flex flex-col text-sm">
          <span className="text-muted-foreground">Customer ID</span>
          <input value={searchParams.get('customer_id') ?? ''} onChange={(e) => setParam('customer_id', e.target.value || undefined)} placeholder="UUID" className="border rounded px-2 py-1" />
        </label>
        <label className="flex flex-col text-sm">
          <span className="text-muted-foreground">Served by</span>
          <input value={searchParams.get('served_by') ?? ''} onChange={(e) => setParam('served_by', e.target.value || undefined)} placeholder="user UUID" className="border rounded px-2 py-1" />
        </label>
      </section>

      {/* Active filter chips */}
      {activeFilterEntries.length > 0 && (
        <section className="flex flex-wrap gap-2" data-testid="active-filter-chips">
          {activeFilterEntries.map(([k, v]) => (
            <button
              key={`${k}=${v}`}
              type="button"
              onClick={() => setParam(k, undefined)}
              className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-xs hover:bg-muted/80"
            >
              {k}: {v} <span aria-hidden="true">×</span>
            </button>
          ))}
        </section>
      )}

      {query.isLoading && <div>Loading…</div>}
      {query.error && <div role="alert">Error: {query.error.message}</div>}

      <table className="w-full text-sm">
        <thead className="text-left border-b">
          <tr>
            <th className="py-2">Date</th>
            <th>Order #</th>
            <th>Customer</th>
            <th>Type</th>
            <th>Status</th>
            <th className="text-right">Total IDR</th>
            <th>Payment</th>
            <th>Refund</th>
            <th>Items</th>
            <th>Served by</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((o) => (
            <tr key={o.id} className="border-t hover:bg-muted/50">
              <td className="py-2">
                <Link to={`/backoffice/orders/${o.id}`} className="underline-offset-2 hover:underline">
                  {fmtDateTime(o.created_at)}
                </Link>
              </td>
              <td>{o.order_number}</td>
              <td>{o.customer_name ?? '—'}</td>
              <td>{o.order_type}</td>
              <td>{o.status}</td>
              <td className="text-right">{fmtIdr(o.total)}</td>
              <td>{o.payment_method_primary ?? '—'}</td>
              <td>{o.refund_status}</td>
              <td>{o.items_count}</td>
              <td>{o.served_by_name ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {lines.length === 0 && !query.isLoading && (
        <div className="text-center text-muted-foreground py-12">
          No orders matching these filters.
        </div>
      )}

      {query.hasNextPage && (
        <button
          type="button"
          onClick={() => query.fetchNextPage()}
          disabled={query.isFetchingNextPage}
          className="rounded border px-4 py-2 hover:bg-muted"
        >
          {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  );
}
