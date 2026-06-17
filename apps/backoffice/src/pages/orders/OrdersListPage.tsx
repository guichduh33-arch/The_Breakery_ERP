// apps/backoffice/src/pages/orders/OrdersListPage.tsx
//
// "Live Orders" — operations view of recent orders. Rebuilt on the design
// system to match the reference: header (Refresh / Export), KPI cards, a
// compact filter row, status pill tabs, a styled table and a per-row Details
// button that opens the rich OrderDetailDrawer.
//
// URL state stays the source of truth for the date range + filters (S32/S33).
// KPIs are computed over the currently-loaded orders. Server-side filters
// (status / order_type / payment_method) flow through get_orders_list_v2;
// the free-text search + status pills are applied over loaded rows.

import { type JSX, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Clock3,
  Download,
  DollarSign,
  Edit3,
  Eye,
  RefreshCw,
  Search,
  ShoppingBag,
  XCircle,
} from 'lucide-react';
import { Button, Card } from '@breakery/ui';
import { useSearchParams } from 'react-router-dom';
import {
  useOrdersList,
  type OrdersListFilters,
  type OrdersListLine,
} from '@/features/orders/hooks/useOrdersList.js';
import { useOrdersRealtime } from '@/features/orders/hooks/useOrdersRealtime.js';
import { VoidOrderModal } from '@/features/orders/components/VoidOrderModal.js';
import { EditOrderItemsModal } from '@/features/orders/components/EditOrderItemsModal.js';
import { OrderDetailDrawer } from '@/features/orders/components/OrderDetailDrawer.js';
import type { OrderItemEdit } from '@/features/orders/types.js';
import { useAuthStore } from '@/stores/authStore.js';
import { supabase } from '@/lib/supabase.js';
import { toast } from 'sonner';

function defaultStart(): string {
  return new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);
}
function defaultEnd(): string {
  return new Date().toISOString().slice(0, 10);
}
function fmtIdr(n: number): string {
  return new Intl.NumberFormat('id-ID').format(n);
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

// Fulfillment-style tabs mapped onto the real order_status enum
// (draft | paid | voided | pending_payment | completed | b2b_pending).
const STATUS_TABS: ReadonlyArray<{ id: string; label: string; status?: string }> = [
  { id: 'all', label: 'All' },
  { id: 'new', label: 'New', status: 'pending_payment' },
  { id: 'preparing', label: 'Preparing', status: 'draft' },
  { id: 'ready', label: 'Ready', status: 'paid' },
  { id: 'completed', label: 'Completed', status: 'completed' },
  { id: 'cancelled', label: 'Cancelled', status: 'voided' },
];

const ORDER_TYPES = ['', 'dine_in', 'take_out', 'delivery', 'b2b'] as const;
const PAYMENT_METHODS = ['', 'cash', 'card', 'qris', 'edc', 'transfer', 'store_credit'] as const;

function isPaidLine(o: OrdersListLine): boolean {
  return o.status === 'completed' || o.status === 'paid' || o.payment_method_primary !== null;
}

export default function OrdersListPage(): JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();
  const { isConnected } = useOrdersRealtime();
  const hasEditOpen = useAuthStore((s) => s.hasPermission('orders.edit_open'));
  const hasVoid     = useAuthStore((s) => s.hasPermission('orders.void'));

  const start = searchParams.get('start') ?? defaultStart();
  const end   = searchParams.get('end')   ?? defaultEnd();
  const [text, setText] = useState('');

  // Visible controls drive status / order_type / payment_method, but every
  // S32/S33 server-side filter is still honoured from the URL so drill-down
  // links (e.g. ?customer_id=…&refund_status=…) keep working.
  const filters: OrdersListFilters = useMemo(() => {
    const f: OrdersListFilters = {};
    const s  = searchParams.get('status');         if (s)  f.status = s;
    const ot = searchParams.get('order_type');     if (ot) f.order_type = ot;
    const pm = searchParams.get('payment_method'); if (pm) f.payment_method = pm;
    const ci = searchParams.get('customer_id');    if (ci) f.customer_id = ci;
    const sb = searchParams.get('served_by');      if (sb) f.served_by = sb;
    const ct = searchParams.get('customer_type');
    if (ct === 'retail' || ct === 'b2b') f.customer_type = ct;
    const tmin = searchParams.get('total_min');    if (tmin) f.total_min = Number(tmin);
    const tmax = searchParams.get('total_max');    if (tmax) f.total_max = Number(tmax);
    const rs = searchParams.get('refund_status');
    if (rs === 'none' || rs === 'partial' || rs === 'full') f.refund_status = rs;
    const hr = searchParams.get('hour');
    if (hr !== null && hr !== '' && !Number.isNaN(Number(hr))) f.hour = Number(hr);
    const ti = searchParams.get('terminal_id');    if (ti) f.terminal_id = ti;
    return f;
  }, [searchParams]);

  const query = useOrdersList({ start, end, filters });

  const allLines: OrdersListLine[] = (query.data?.pages ?? []).flatMap((p) => p.lines);
  const lines = useMemo(() => {
    const q = text.trim().toLowerCase();
    if (!q) return allLines;
    return allLines.filter(
      (o) =>
        o.order_number.toLowerCase().includes(q) ||
        (o.customer_name ?? '').toLowerCase().includes(q),
    );
  }, [allLines, text]);

  // KPIs over loaded + text-filtered rows.
  const kpis = useMemo(() => {
    const totalAmount = lines.reduce((s, o) => s + o.total, 0);
    const completed = lines.filter((o) => o.status === 'completed').length;
    const paidLines = lines.filter(isPaidLine);
    const unpaidLines = lines.filter((o) => !isPaidLine(o) && o.status !== 'voided');
    return {
      total: lines.length,
      totalAmount,
      completion: lines.length > 0 ? Math.round((completed / lines.length) * 100) : 0,
      paidCount: paidLines.length,
      paidAmount: paidLines.reduce((s, o) => s + o.total, 0),
      unpaidCount: unpaidLines.length,
      unpaidAmount: unpaidLines.reduce((s, o) => s + o.total, 0),
    };
  }, [lines]);

  const activeStatus = searchParams.get('status') ?? '';
  const activeTab = STATUS_TABS.find((t) => (t.status ?? '') === activeStatus)?.id ?? 'all';

  function setParam(key: string, value: string | undefined): void {
    const next = new URLSearchParams(searchParams);
    if (value === undefined || value === '') next.delete(key);
    else next.set(key, value);
    setSearchParams(next, { replace: true });
  }

  function exportCsv(): void {
    const header = ['Order #', 'Time', 'Type', 'Customer', 'Items', 'Amount', 'Status', 'Payment'];
    const rows = lines.map((o) => [
      o.order_number,
      new Date(o.created_at).toLocaleString('id-ID'),
      o.order_type,
      o.customer_name ?? '',
      String(o.items_count),
      String(o.total),
      o.status,
      o.payment_method_primary ?? '',
    ]);
    const csv = [header, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `orders-${start}_${end}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Row action modal state
  const [detailId, setDetailId]   = useState<string | null>(null);
  const [voidTarget, setVoidTarget] = useState<{ id: string; number: string } | null>(null);
  const [editTarget, setEditTarget] = useState<{ id: string; number: string; items: OrderItemEdit[] } | null>(null);

  async function loadItemsAndOpenEdit(row: OrdersListLine): Promise<void> {
    const { data, error } = await supabase
      .from('order_items')
      .select('id, product_id, name_snapshot, quantity, unit_price, line_total, modifiers')
      .eq('order_id', row.id);
    if (error) {
      toast.error(`Failed to load order items: ${(error as { message?: string }).message ?? 'unknown error'}`);
      return;
    }
    const items: OrderItemEdit[] = (data ?? []).map((it: {
      id: string; product_id: string; name_snapshot: string;
      quantity: number; unit_price: number; line_total: number; modifiers: unknown;
    }) => ({
      id: it.id,
      product_id: it.product_id,
      name_snapshot: it.name_snapshot,
      qty: Number(it.quantity),
      unit_price: Number(it.unit_price),
      line_total: Number(it.line_total),
      modifiers: Array.isArray(it.modifiers) ? it.modifiers : [],
    }));
    setEditTarget({ id: row.id, number: row.order_number, items });
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <ShoppingBag className="h-7 w-7 text-gold" aria-hidden />
          <h1 className="font-serif text-3xl text-text-primary">Live Orders</h1>
          <span className="flex items-center gap-1.5 text-xs text-text-secondary" data-testid="realtime-indicator">
            <span className={`inline-block h-2 w-2 rounded-full ${isConnected ? 'bg-emerald-500' : 'bg-gray-400'}`} />
            {isConnected ? 'Live' : 'Offline'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="md" onClick={() => query.refetch()} disabled={query.isFetching}>
            <RefreshCw className={`h-4 w-4 ${query.isFetching ? 'animate-spin' : ''}`} aria-hidden /> Refresh
          </Button>
          <Button variant="secondary" size="md" onClick={exportCsv} disabled={lines.length === 0}>
            <Download className="h-4 w-4" aria-hidden /> Export
          </Button>
        </div>
      </header>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <KpiCard icon={ShoppingBag} label="Total orders" value={String(kpis.total)} />
        <KpiCard icon={DollarSign} label="Total amount" value={`Rp ${fmtIdr(kpis.totalAmount)}`} />
        <KpiCard icon={CheckCircle2} label="Completion" value={`${kpis.completion}%`} accent="text-blue-600" />
        <KpiCard
          icon={CheckCircle2}
          label="Paid"
          value={String(kpis.paidCount)}
          footer={`Rp ${fmtIdr(kpis.paidAmount)}`}
          accent="text-emerald-600"
        />
        <KpiCard
          icon={Clock3}
          label="Unpaid"
          value={String(kpis.unpaidCount)}
          footer={`Rp ${fmtIdr(kpis.unpaidAmount)}`}
          accent="text-rose-600"
        />
      </div>

      {/* Filters row */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
        <Card variant="default" padding="sm">
          <div className="flex items-center gap-2 text-text-secondary">
            <Search className="h-4 w-4" aria-hidden />
            <input
              type="search"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Order #, customer…"
              className="h-8 w-full bg-transparent text-sm text-text-primary outline-none placeholder:text-text-muted"
              aria-label="Search orders"
            />
          </div>
        </Card>
        <FilterField label="Start date">
          <input type="date" value={start} onChange={(e) => setParam('start', e.target.value)} className="h-8 w-full bg-transparent text-sm text-text-primary outline-none" />
        </FilterField>
        <FilterField label="End date">
          <input type="date" value={end} onChange={(e) => setParam('end', e.target.value)} className="h-8 w-full bg-transparent text-sm text-text-primary outline-none" />
        </FilterField>
        <FilterField label="Type">
          <select value={searchParams.get('order_type') ?? ''} onChange={(e) => setParam('order_type', e.target.value || undefined)} className="h-8 w-full bg-transparent text-sm text-text-primary outline-none">
            {ORDER_TYPES.map((t) => <option key={t} value={t}>{t === '' ? 'All' : TYPE_LABEL[t]}</option>)}
          </select>
        </FilterField>
        <FilterField label="Payment">
          <select value={searchParams.get('payment_method') ?? ''} onChange={(e) => setParam('payment_method', e.target.value || undefined)} className="h-8 w-full bg-transparent text-sm capitalize text-text-primary outline-none">
            {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m === '' ? 'All' : m}</option>)}
          </select>
        </FilterField>
      </div>

      {/* Status pills */}
      <div className="flex flex-wrap gap-2" data-testid="status-pills">
        {STATUS_TABS.map((t) => {
          const active = activeTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setParam('status', t.status)}
              className={[
                'rounded-full px-4 py-1.5 text-sm font-medium transition-colors',
                active
                  ? 'bg-gold text-white'
                  : 'border border-border-subtle text-text-secondary hover:bg-bg-overlay',
              ].join(' ')}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {query.error && <div role="alert" className="rounded-md border border-danger/40 bg-danger/5 p-3 text-sm text-danger">Error: {query.error.message}</div>}

      {/* Table */}
      <Card variant="default" padding="none" className="overflow-hidden">
        <table className="w-full border-collapse text-sm">
          <thead className="border-b border-border-subtle bg-bg-base/40 text-xs uppercase tracking-widest text-text-secondary">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Order #</th>
              <th className="px-4 py-3 text-left font-medium">Time</th>
              <th className="px-4 py-3 text-left font-medium">Type</th>
              <th className="px-4 py-3 text-left font-medium">Customer</th>
              <th className="px-4 py-3 text-right font-medium">Items</th>
              <th className="px-4 py-3 text-right font-medium">Amount</th>
              <th className="px-4 py-3 text-left font-medium">Status</th>
              <th className="px-4 py-3 text-left font-medium">Payment</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {lines.map((o) => {
              const paid = isPaidLine(o);
              return (
                <tr key={o.id} className="border-t border-border-subtle hover:bg-bg-overlay/40">
                  <td className="px-4 py-3 font-mono text-text-primary">#{o.order_number.replace(/^#+/, '')}</td>
                  <td className="px-4 py-3">
                    <div className="text-text-primary">{new Date(o.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</div>
                    <div className="text-xs text-text-muted">{new Date(o.created_at).toLocaleDateString('en-US', { day: '2-digit', month: 'short' })}</div>
                  </td>
                  <td className="px-4 py-3">{TYPE_LABEL[o.order_type] ?? o.order_type}</td>
                  <td className="px-4 py-3 text-text-secondary">{o.customer_name ?? '—'}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{o.items_count} items</td>
                  <td className="px-4 py-3 text-right font-mono font-medium">Rp {fmtIdr(o.total)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase ${STATUS_TONE[o.status] ?? 'bg-gray-100 text-gray-600'}`}>{o.status}</span>
                  </td>
                  <td className="px-4 py-3">
                    {paid ? (
                      <div className="leading-tight">
                        <div className="flex items-center gap-1 text-xs font-medium text-emerald-600">✓ Paid</div>
                        {o.payment_method_primary && <div className="text-xs capitalize text-text-muted">{o.payment_method_primary}</div>}
                      </div>
                    ) : (
                      <span className="text-xs text-amber-600">Unpaid</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {hasEditOpen && (o.status === 'draft' || o.status === 'pending_payment') && (
                      <button type="button" title="Edit items" onClick={() => void loadItemsAndOpenEdit(o)} data-testid={`row-edit-${o.id}`} className="mr-1 text-blue-600 hover:text-blue-800" aria-label={`Edit items of ${o.order_number}`}>
                        <Edit3 size={16} />
                      </button>
                    )}
                    {hasVoid && o.status === 'paid' && (
                      <button type="button" title="Void" onClick={() => setVoidTarget({ id: o.id, number: o.order_number })} data-testid={`row-void-${o.id}`} className="mr-1 text-red-600 hover:text-red-800" aria-label={`Void ${o.order_number}`}>
                        <XCircle size={16} />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setDetailId(o.id)}
                      data-testid={`row-details-${o.id}`}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border-subtle px-2.5 py-1 text-xs text-text-secondary hover:bg-bg-overlay"
                      aria-label={`Details of ${o.order_number}`}
                    >
                      <Eye size={14} /> Details
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {query.isLoading && <div className="py-12 text-center text-text-secondary">Loading…</div>}
        {!query.isLoading && lines.length === 0 && (
          <div className="py-12 text-center text-text-muted">No orders matching these filters.</div>
        )}

        <div className="flex items-center justify-between border-t border-border-subtle px-4 py-3 text-sm text-text-secondary">
          <span>Showing {lines.length} order{lines.length === 1 ? '' : 's'}</span>
          {query.hasNextPage && (
            <Button variant="ghost" size="sm" onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage}>
              {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
            </Button>
          )}
        </div>
      </Card>

      {/* Drawer + modals */}
      <OrderDetailDrawer orderId={detailId} onClose={() => setDetailId(null)} />
      {voidTarget && (
        <VoidOrderModal open orderId={voidTarget.id} orderNumber={voidTarget.number} onClose={() => setVoidTarget(null)} />
      )}
      {editTarget && (
        <EditOrderItemsModal open orderId={editTarget.id} orderNumber={editTarget.number} currentItems={editTarget.items} onClose={() => setEditTarget(null)} />
      )}
    </div>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  footer,
  accent,
}: {
  icon: typeof ShoppingBag;
  label: string;
  value: string;
  footer?: string;
  accent?: string;
}): JSX.Element {
  return (
    <Card variant="default" padding="md">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-text-secondary">
        <Icon className="h-3.5 w-3.5" aria-hidden /> {label}
      </div>
      <div className={`mt-1.5 text-2xl font-semibold tabular-nums ${accent ?? 'text-text-primary'}`}>{value}</div>
      {footer && <div className="mt-0.5 text-xs text-text-muted tabular-nums">{footer}</div>}
    </Card>
  );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <Card variant="default" padding="sm">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-text-secondary">{label}</div>
      <div className="mt-0.5">{children}</div>
    </Card>
  );
}
