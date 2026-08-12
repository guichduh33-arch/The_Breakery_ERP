// apps/backoffice/src/pages/orders/OrdersListPage.tsx
//
// Liste des commandes — instance de l'archétype LIST (ADR-025).
//
// Ce que la refonte change, et pourquoi :
//   · Les tuiles KPI et les pilules de statut disparaissent. Les tuiles
//     comptaient les lignes chargées d'une liste paginée en les présentant
//     comme la période ; les pilules « New / Preparing / Ready » projetaient
//     des étapes de cuisine sur des statuts qui ne les portent pas (ADR-009).
//     À la place : des compteurs serveur qui SONT les filtres
//     (`ListCounterStrip` + `get_orders_counters`), nommés par les statuts
//     réels, et une bande d'argent servie par la même fonction (ADR-025 D5).
//   · Le bloc de filtres carté cède à une rangée de contrôles plats ; l'état
//     de liste vit dans l'URL (`patchParams`, même motif que Products.tsx) —
//     les liens de drill-down (?customer_id=…, ?refund_status=…) continuent
//     de porter tous les filtres serveur S32/S33.
//   · La table à la main cède au `DataTable` partagé : `aria-sort`, squelette,
//     état vide, et un pied TOUJOURS rendu qui lit le compteur du panier actif
//     — « 0 of 240 » est une information, un pied absent n'en est pas une.
//   · La recherche libre reste un filtre CLIENT sur les lignes chargées (la
//     famille get_orders_list n'a pas de filtre texte) ; le pied distingue ce
//     qui est montré de ce que la fenêtre contient pour ne jamais mentir.

import { type JSX, useCallback, useMemo, useState } from 'react';
import { Download, Edit3, Eye, RefreshCw, XCircle } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { DataTable, Input, Select, cn, type DataTableColumn } from '@breakery/ui';
import { formatIdr, todayIsoDate } from '@breakery/utils';
import { PageHeader } from '@/components/PageHeader.js';
import { ListCounterStrip, type ListCounter } from '@/components/ListCounterStrip.js';
import { TOOLBAR_BTN_SECONDARY } from '@/components/toolbarButton.js';
import {
  useOrdersList,
  type OrdersListFilters,
  type OrdersListLine,
} from '@/features/orders/hooks/useOrdersList.js';
import {
  useOrdersCounters,
  type OrdersCounters,
} from '@/features/orders/hooks/useOrdersCounters.js';
import {
  ORDER_STATUS,
  ORDER_STATUS_ORDER,
  ORDER_STATUS_BADGE,
  ORDER_STATUS_BADGE_TONE,
  ORDER_TYPE_LABEL,
  orderStatusLabel,
  type OrderStatus,
} from '@/features/orders/statusMeta.js';
import { useOrdersRealtime } from '@/features/orders/hooks/useOrdersRealtime.js';
import { VoidOrderModal } from '@/features/orders/components/VoidOrderModal.js';
import { EditOrderItemsModal } from '@/features/orders/components/EditOrderItemsModal.js';
import { OrderDetailDrawer } from '@/features/orders/components/OrderDetailDrawer.js';
import type { OrderItemEdit } from '@/features/orders/types.js';
import { useAuthStore } from '@/stores/authStore.js';
import { supabase } from '@/lib/supabase.js';
import { toast } from 'sonner';

const BUSINESS_TZ = 'Asia/Makassar';

/** Fenêtre par défaut : 60 jours glissants, en jours métier. */
function defaultStart(): string {
  return new Date(Date.parse(`${todayIsoDate()}T00:00:00Z`) - 60 * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

const ORDER_TYPES = ['', 'dine_in', 'take_out', 'delivery', 'b2b'] as const;
const PAYMENT_METHODS = ['', 'cash', 'card', 'qris', 'edc', 'transfer', 'store_credit'] as const;

function statusCell(c: OrdersCounters | undefined, s: OrderStatus): number {
  return c?.by_status[s]?.count ?? 0;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', timeZone: BUSINESS_TZ,
  });
}
function fmtDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    day: '2-digit', month: 'short', timeZone: BUSINESS_TZ,
  });
}

export default function OrdersListPage(): JSX.Element {
  const { isConnected } = useOrdersRealtime();
  const hasEditOpen = useAuthStore((s) => s.hasPermission('orders.edit_open'));
  const hasVoid     = useAuthStore((s) => s.hasPermission('orders.void'));

  // TOUT l'état de liste vit dans l'URL — un filtre se partage par lien et le
  // retour arrière ramène la liste telle qu'on l'avait laissée. Les écritures
  // passent par `patchParams` (updater fonctionnel) : deux écritures du même
  // geste ne s'écrasent pas (motif documenté dans Products.tsx).
  const [params, setParams] = useSearchParams();
  const patchParams = useCallback((patch: Record<string, string | null>): void => {
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === '') p.delete(k);
        else p.set(k, v);
      }
      return p;
    }, { replace: true });
  }, [setParams]);

  const start = params.get('start') ?? defaultStart();
  const end   = params.get('end')   ?? todayIsoDate();

  // `?status=lol` ne doit pas produire une liste vide en silence : hors enum,
  // on retombe sur « tous ».
  const statusParam = params.get('status') ?? '';
  const status: OrderStatus | '' = Object.hasOwn(ORDER_STATUS, statusParam)
    ? (statusParam as OrderStatus)
    : '';

  const [quickFind, setQuickFind] = useState('');

  // Filtres serveur S32/S33 — tous honorés depuis l'URL pour que les liens de
  // drill-down continuent de fonctionner.
  const serverFilters = useMemo<Omit<OrdersListFilters, 'status'>>(() => {
    const f: Omit<OrdersListFilters, 'status'> = {};
    const ot = params.get('order_type');     if (ot) f.order_type = ot;
    const pm = params.get('payment_method'); if (pm) f.payment_method = pm;
    const ci = params.get('customer_id');    if (ci) f.customer_id = ci;
    const sb = params.get('served_by');      if (sb) f.served_by = sb;
    const ct = params.get('customer_type');
    if (ct === 'retail' || ct === 'b2b') f.customer_type = ct;
    const tmin = params.get('total_min');    if (tmin) f.total_min = Number(tmin);
    const tmax = params.get('total_max');    if (tmax) f.total_max = Number(tmax);
    const rs = params.get('refund_status');
    if (rs === 'none' || rs === 'partial' || rs === 'full') f.refund_status = rs;
    const hr = params.get('hour');
    if (hr !== null && hr !== '' && !Number.isNaN(Number(hr))) f.hour = Number(hr);
    const ti = params.get('terminal_id');    if (ti) f.terminal_id = ti;
    return f;
  }, [params]);

  const listFilters = useMemo<OrdersListFilters>(
    () => (status === '' ? serverFilters : { ...serverFilters, status }),
    [serverFilters, status],
  );

  const query = useOrdersList({ start, end, filters: listFilters });
  // ADR-025 D2 — les compteurs suivent la fenêtre et les filtres, JAMAIS le
  // statut actif : sinon la bande n'annoncerait que le panier sélectionné et
  // cesserait d'être un moyen d'en changer.
  const counters = useOrdersCounters({ start, end, filters: serverFilters });
  const c = counters.data;

  const loadedLines: OrdersListLine[] = useMemo(
    () => (query.data?.pages ?? []).flatMap((p) => p.lines),
    [query.data],
  );
  const lines = useMemo(() => {
    const q = quickFind.trim().toLowerCase();
    if (!q) return loadedLines;
    return loadedLines.filter(
      (o) =>
        o.order_number.toLowerCase().includes(q) ||
        (o.customer_name ?? '').toLowerCase().includes(q),
    );
  }, [loadedLines, quickFind]);

  /** Total du panier affiché — c'est lui que le pied compte (ADR-025 D1). */
  const activeTotal = status === '' ? (c?.total.count ?? 0) : statusCell(c, status);

  function pick(next: OrderStatus | ''): void {
    patchParams({ status: next === '' ? null : next });
  }

  const counterItems = useMemo<ListCounter[]>(() => [
    {
      id: 'all',
      label: 'All orders',
      value: c?.total.count ?? 0,
      onSelect: () => { pick(''); },
    },
    ...ORDER_STATUS_ORDER.map((s): ListCounter => {
      const spec = ORDER_STATUS[s];
      const value = statusCell(c, s);
      return {
        id: s,
        label: spec.label,
        value,
        ...(spec.tone !== undefined && spec.tone !== 'success' && value > 0
          ? { tone: spec.tone }
          : {}),
        onSelect: () => { pick(s); },
      };
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [c]);

  // Bande d'argent (ADR-025 D5) — informative, donc non cliquable : un
  // compteur sans `onSelect` ne se présente pas comme un contrôle.
  const moneyItems = useMemo<ListCounter[]>(() => [
    {
      id: 'amount-total',
      label: 'Window total',
      value: formatIdr(c?.total.amount ?? 0),
      title: `${(c?.total.count ?? 0).toLocaleString()} orders between ${start} and ${end}, current filters applied.`,
    },
    {
      id: 'amount-paid',
      label: 'Paid',
      value: formatIdr(c?.paid.amount ?? 0),
      tone: 'success',
      title: `${(c?.paid.count ?? 0).toLocaleString()} orders with at least one recorded payment.`,
    },
    {
      id: 'amount-unpaid',
      label: 'Unpaid',
      value: formatIdr(c?.unpaid.amount ?? 0),
      ...((c?.unpaid.count ?? 0) > 0 ? { tone: 'warning' as const } : {}),
      title: `${(c?.unpaid.count ?? 0).toLocaleString()} orders with no payment yet, voided excluded.`,
    },
  ], [c, start, end]);

  function exportCsv(): void {
    const header = ['Order #', 'Time', 'Type', 'Customer', 'Items', 'Amount', 'Status', 'Payment'];
    const rows = lines.map((o) => [
      o.order_number,
      new Date(o.created_at).toLocaleString('en-US', { timeZone: BUSINESS_TZ }),
      o.order_type,
      o.customer_name ?? '',
      String(o.items_count),
      String(o.total),
      o.status,
      o.payment_method_primary ?? '',
    ]);
    const csv = [header, ...rows]
      .map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `orders-${start}_${end}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Actions de ligne — modales et tiroir de détail.
  const [detailId, setDetailId]     = useState<string | null>(null);
  const [voidTarget, setVoidTarget] = useState<{ id: string; number: string } | null>(null);
  const [editTarget, setEditTarget] = useState<{ id: string; number: string; items: OrderItemEdit[] } | null>(null);

  async function loadItemsAndOpenEdit(row: OrdersListLine): Promise<void> {
    const { data, error } = await supabase
      .from('order_items')
      .select('id, product_id, name_snapshot, quantity, unit_price, line_total, modifiers, is_locked')
      .eq('order_id', row.id);
    if (error) {
      toast.error(`Failed to load order items: ${(error as { message?: string }).message ?? 'unknown error'}`);
      return;
    }
    const items: OrderItemEdit[] = (data ?? []).map((it: {
      id: string; product_id: string; name_snapshot: string;
      quantity: number; unit_price: number; line_total: number; modifiers: unknown;
      is_locked: boolean;
    }) => ({
      id: it.id,
      product_id: it.product_id,
      name_snapshot: it.name_snapshot,
      qty: Number(it.quantity),
      unit_price: Number(it.unit_price),
      line_total: Number(it.line_total),
      modifiers: Array.isArray(it.modifiers) ? it.modifiers : [],
      is_locked: Boolean(it.is_locked),
    }));
    setEditTarget({ id: row.id, number: row.order_number, items });
  }

  const columns = useMemo<readonly DataTableColumn<OrdersListLine>[]>(() => [
    {
      id: 'number', header: 'Order #', width: '7.5rem',
      render: (o) => (
        <Link
          to={`/backoffice/orders/${o.id}`}
          className="font-data text-xs text-gold hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
        >
          #{o.order_number.replace(/^#+/, '')}
        </Link>
      ),
    },
    {
      id: 'time', header: 'Time', width: '7rem',
      render: (o) => (
        <span className="block whitespace-nowrap font-data text-xs leading-tight tabular-nums">
          {fmtTime(o.created_at)}
          <span className="block text-text-muted">{fmtDay(o.created_at)}</span>
        </span>
      ),
    },
    {
      id: 'type', header: 'Type', width: '6.5rem',
      render: (o) => <span className="text-text-secondary">{ORDER_TYPE_LABEL[o.order_type] ?? o.order_type}</span>,
    },
    {
      id: 'customer', header: 'Customer',
      render: (o) => (
        o.customer_name !== null
          ? <span className="text-text-primary">{o.customer_name}</span>
          : <span className="text-text-subtle" aria-hidden>—</span>
      ),
    },
    {
      id: 'items', header: 'Items', align: 'right', width: '4.5rem',
      render: (o) => <span className="font-data tabular-nums">{o.items_count}</span>,
    },
    {
      id: 'amount', header: 'Amount', align: 'right', width: '8.5rem',
      render: (o) => <span className="whitespace-nowrap font-data tabular-nums">{formatIdr(o.total)}</span>,
    },
    {
      id: 'status', header: 'Status', width: '9.5rem',
      render: (o) => (
        <span
          className={cn(
            ORDER_STATUS_BADGE,
            ORDER_STATUS_BADGE_TONE[o.status] ?? 'bg-surface-4 text-text-secondary',
          )}
        >
          {orderStatusLabel(o.status)}
        </span>
      ),
    },
    {
      id: 'payment', header: 'Payment', width: '7.5rem',
      render: (o) => (
        o.payment_method_primary !== null
          ? <span className="text-text-secondary capitalize">{o.payment_method_primary}</span>
          : o.status === 'voided'
            ? <span className="text-text-subtle" aria-hidden>—</span>
            : <span className="text-warning">Unpaid</span>
      ),
    },
    {
      id: 'actions', header: <span className="sr-only">Row actions</span>, align: 'right', width: '6rem',
      render: (o) => (
        <span className="inline-flex items-center gap-0.5">
          {hasEditOpen && (o.status === 'draft' || o.status === 'pending_payment') && (
            <RowAction
              label={`Edit items of ${o.order_number}`}
              testId={`row-edit-${o.id}`}
              onClick={() => { void loadItemsAndOpenEdit(o); }}
            >
              <Edit3 className="h-3.5 w-3.5" aria-hidden />
            </RowAction>
          )}
          {hasVoid && (o.status === 'paid' || o.status === 'completed') && (
            <RowAction
              label={`Void ${o.order_number}`}
              testId={`row-void-${o.id}`}
              destructive
              onClick={() => { setVoidTarget({ id: o.id, number: o.order_number }); }}
            >
              <XCircle className="h-3.5 w-3.5" aria-hidden />
            </RowAction>
          )}
          <RowAction
            label={`Details of ${o.order_number}`}
            testId={`row-details-${o.id}`}
            onClick={() => { setDetailId(o.id); }}
          >
            <Eye className="h-3.5 w-3.5" aria-hidden />
          </RowAction>
        </span>
      ),
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [hasEditOpen, hasVoid]);

  return (
    <div className="flex flex-col gap-[13px]">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs text-text-muted">
        <span>Sales</span>
        <span className="text-text-inert" aria-hidden>›</span>
        <span className="text-text-secondary">Orders</span>
      </nav>

      <PageHeader
        title="Orders"
        subtitle={
          <span className="inline-flex items-center gap-1.5" data-testid="realtime-indicator">
            <span
              className={cn('inline-block h-1.5 w-1.5 rounded-full', isConnected ? 'bg-success' : 'bg-text-muted')}
              aria-hidden
            />
            {isConnected ? 'Live — new orders appear as they are recorded.' : 'Offline — showing the last loaded state.'}
          </span>
        }
        actions={
          <>
            <button
              type="button"
              className={TOOLBAR_BTN_SECONDARY}
              onClick={() => { void query.refetch(); void counters.refetch(); }}
              disabled={query.isFetching}
            >
              <RefreshCw className={cn('h-3.5 w-3.5 text-text-muted', query.isFetching && 'animate-spin motion-reduce:animate-none')} aria-hidden />
              Refresh
            </button>
            <button
              type="button"
              className={TOOLBAR_BTN_SECONDARY}
              onClick={exportCsv}
              disabled={lines.length === 0}
            >
              <Download className="h-3.5 w-3.5 text-text-muted" aria-hidden /> Export
            </button>
          </>
        }
      />

      <ListCounterStrip
        counters={counterItems}
        activeId={status === '' ? 'all' : status}
        ariaLabel="Order status filters"
        data-testid="orders-counters"
      />

      <div className="flex">
        <ListCounterStrip
          counters={moneyItems}
          ariaLabel="Window totals"
          data-testid="orders-money"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="orders-find" className="sr-only">Find in results</label>
        <Input
          id="orders-find"
          type="search"
          value={quickFind}
          onChange={(e) => { setQuickFind(e.target.value); }}
          placeholder="Find order # or customer in results"
          maxLength={64}
          className="w-full max-w-xs"
        />
        <label htmlFor="orders-start" className="sr-only">Start date</label>
        <Input
          id="orders-start"
          type="date"
          value={start}
          onChange={(e) => { patchParams({ start: e.target.value }); }}
          className="w-40"
        />
        <label htmlFor="orders-end" className="sr-only">End date</label>
        <Input
          id="orders-end"
          type="date"
          value={end}
          onChange={(e) => { patchParams({ end: e.target.value }); }}
          className="w-40"
        />
        <label htmlFor="orders-type" className="sr-only">Order type</label>
        <Select
          id="orders-type"
          value={params.get('order_type') ?? ''}
          onChange={(e) => { patchParams({ order_type: e.target.value || null }); }}
          className="w-40"
        >
          {ORDER_TYPES.map((t) => (
            <option key={t} value={t}>{t === '' ? 'All types' : ORDER_TYPE_LABEL[t]}</option>
          ))}
        </Select>
        <label htmlFor="orders-payment" className="sr-only">Payment method</label>
        <Select
          id="orders-payment"
          value={params.get('payment_method') ?? ''}
          onChange={(e) => { patchParams({ payment_method: e.target.value || null }); }}
          className="w-44 capitalize"
        >
          {PAYMENT_METHODS.map((m) => (
            <option key={m} value={m}>{m === '' ? 'All payments' : m.replace('_', ' ')}</option>
          ))}
        </Select>
      </div>

      {/* Sans annonce, cliquer un compteur change la table en silence pour un
          lecteur d'écran. */}
      <span className="sr-only" role="status" aria-live="polite">
        {counters.isLoading
          ? 'Loading order counts'
          : `${activeTotal.toLocaleString()} ${activeTotal === 1 ? 'order' : 'orders'} in the current filter`}
      </span>

      {query.error !== null ? (
        <p role="alert" className="rounded-md border border-red bg-red-soft p-4 text-sm text-red-as-text">
          Orders could not be loaded. The list may be out of date.{' '}
          <button type="button" className="underline" onClick={() => { void query.refetch(); }}>
            Try again
          </button>
        </p>
      ) : (
        <DataTable<OrdersListLine>
          columns={columns}
          rows={lines}
          getRowKey={(o) => o.id}
          isLoading={query.isLoading}
          density="compact"
          emptyTitle="No orders here"
          emptyDescription={
            status !== '' || quickFind.trim() !== '' || Object.keys(serverFilters).length > 0
              ? 'Nothing matches this filter. Widen the dates, or pick another counter above.'
              : 'No orders were recorded in this window.'
          }
          data-testid="orders-table"
          footer={
            <div className="flex items-center justify-between">
              <span className="font-data text-[11px] tabular-nums text-text-muted">
                {quickFind.trim() !== ''
                  ? `${lines.length} match · ${activeTotal.toLocaleString()} in window`
                  : `${lines.length} of ${activeTotal.toLocaleString()}`}
              </span>
              {query.hasNextPage && (
                <button
                  type="button"
                  className={TOOLBAR_BTN_SECONDARY}
                  onClick={() => { void query.fetchNextPage(); }}
                  disabled={query.isFetchingNextPage}
                >
                  {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
                </button>
              )}
            </div>
          }
        />
      )}

      <OrderDetailDrawer orderId={detailId} onClose={() => setDetailId(null)} />
      {voidTarget !== null && (
        <VoidOrderModal open orderId={voidTarget.id} orderNumber={voidTarget.number} onClose={() => setVoidTarget(null)} />
      )}
      {editTarget !== null && (
        <EditOrderItemsModal open orderId={editTarget.id} orderNumber={editTarget.number} currentItems={editTarget.items} onClose={() => setEditTarget(null)} />
      )}
    </div>
  );
}

/* ------------------------------------------------------- row action button */

function RowAction({
  label, onClick, destructive = false, testId, children,
}: {
  label: string;
  onClick: () => void;
  destructive?: boolean;
  testId?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      data-testid={testId}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={cn(
        'inline-flex h-6 w-6 items-center justify-center rounded-sm text-text-subtle transition-colors',
        destructive ? 'hover:bg-red-soft hover:text-danger' : 'hover:bg-surface-4 hover:text-text-primary',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold',
      )}
    >
      {children}
    </button>
  );
}
