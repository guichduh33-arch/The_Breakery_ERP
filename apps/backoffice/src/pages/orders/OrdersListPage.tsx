// apps/backoffice/src/pages/orders/OrdersListPage.tsx
//
// Liste des commandes — instance de l'archétype LIST (ADR-025, amendée après
// review PR #367) : compteurs et sommes servis par `get_orders_counters`
// (statuts réels — « New/Preparing/Ready » sont morts, ADR-009) ; RÉGLÉ =
// paiement OU statut paid/completed (B2B sans ligne order_payments) ; un
// échec des compteurs rend des tirets, jamais des zéros ; état de liste dans
// l'URL avec `pick` mémoïsé (closure figée = filtres écrasés) ; dates
// commises en débounce ; export CSV gaté `reports.export` via buildCsv.

import { type JSX, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Edit3, Eye, RefreshCw, XCircle } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { DataTable, Input, Select, cn, type DataTableColumn } from '@breakery/ui';
import { formatCurrency, formatTimeWita, formatDateShortWita, todayIsoDate } from '@breakery/utils';
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
  ORDER_TYPES,
  ORDER_TYPE_LABEL,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABEL,
  isSettledStatus,
  orderStatusBadgeTone,
  orderStatusLabel,
  orderTypeLabel,
  type OrderStatus,
} from '@/features/orders/statusMeta.js';
import { useOrdersRealtime } from '@/features/orders/hooks/useOrdersRealtime.js';
import { exportOrdersCsv } from '@/features/orders/exportOrdersCsv.js';
import { RowActionButton } from '@/features/orders/components/RowActionButton.js';
import { VoidOrderModal } from '@/features/orders/components/VoidOrderModal.js';
import { EditOrderItemsModal } from '@/features/orders/components/EditOrderItemsModal.js';
import { OrderDetailDrawer } from '@/features/orders/components/OrderDetailDrawer.js';
import type { OrderItemEdit } from '@/features/orders/types.js';
import { useAuthStore } from '@/stores/authStore.js';
import { supabase } from '@/lib/supabase.js';
import { toast } from 'sonner';

/** Fenêtre par défaut : 60 jours glissants, en jours métier. */
function defaultStart(): string {
  return new Date(Date.parse(`${todayIsoDate()}T00:00:00Z`) - 60 * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

const DATE_COMMIT_MS = 400;

function statusCell(c: OrdersCounters | undefined, s: OrderStatus): number {
  return c?.by_status[s]?.count ?? 0;
}

/** Une URL peut porter n'importe quoi : NaN ne part jamais au serveur. */
function numParam(raw: string | null): number | undefined {
  if (raw === null || raw === '') return undefined;
  const n = Number(raw);
  return Number.isNaN(n) ? undefined : n;
}

export default function OrdersListPage(): JSX.Element {
  const { isConnected } = useOrdersRealtime();
  const hasEditOpen = useAuthStore((s) => s.hasPermission('orders.edit_open'));
  const hasVoid     = useAuthStore((s) => s.hasPermission('orders.void'));
  // Le CSV sort des données nominatives : même gate que tous les exports
  // (« le SEUL point de contrôle possible pour le CSV », audit reports).
  const canExport   = useAuthStore((s) => s.hasPermission('reports.export'));

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

  // Les inputs date écrivent en local et COMMETTENT en débounce : scruber une
  // année émettait un couple de RPC pleine fenêtre par valeur intermédiaire.
  const [startDraft, setStartDraft] = useState(start);
  const [endDraft, setEndDraft]     = useState(end);
  useEffect(() => { setStartDraft(start); }, [start]);
  useEffect(() => { setEndDraft(end); }, [end]);
  const dateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (dateTimer.current !== null) clearTimeout(dateTimer.current);
  }, []);
  const commitDates = useCallback((s: string, e: string, immediate = false): void => {
    if (dateTimer.current !== null) clearTimeout(dateTimer.current);
    const write = (): void => { patchParams({ start: s, end: e }); };
    if (immediate) write();
    else dateTimer.current = setTimeout(write, DATE_COMMIT_MS);
  }, [patchParams]);

  // `?status=lol` ne doit pas produire une liste vide en silence.
  const statusParam = params.get('status') ?? '';
  const status: OrderStatus | '' = Object.hasOwn(ORDER_STATUS, statusParam)
    ? (statusParam as OrderStatus)
    : '';

  const [quickFind, setQuickFind] = useState('');

  // Filtres serveur S32/S33 — tous honorés depuis l'URL (drill-downs).
  const serverFilters = useMemo<Omit<OrdersListFilters, 'status'>>(() => {
    const f: Omit<OrdersListFilters, 'status'> = {};
    const ot = params.get('order_type');     if (ot) f.order_type = ot;
    const pm = params.get('payment_method'); if (pm) f.payment_method = pm;
    const ci = params.get('customer_id');    if (ci) f.customer_id = ci;
    const sb = params.get('served_by');      if (sb) f.served_by = sb;
    const ct = params.get('customer_type');
    if (ct === 'retail' || ct === 'b2b') f.customer_type = ct;
    const tmin = numParam(params.get('total_min')); if (tmin !== undefined) f.total_min = tmin;
    const tmax = numParam(params.get('total_max')); if (tmax !== undefined) f.total_max = tmax;
    const rs = params.get('refund_status');
    if (rs === 'none' || rs === 'partial' || rs === 'full') f.refund_status = rs;
    const hr = numParam(params.get('hour')); if (hr !== undefined) f.hour = hr;
    const ti = params.get('terminal_id');    if (ti) f.terminal_id = ti;
    return f;
  }, [params]);

  const listFilters = useMemo<OrdersListFilters>(
    () => (status === '' ? serverFilters : { ...serverFilters, status }),
    [serverFilters, status],
  );

  const query = useOrdersList({ start, end, filters: listFilters });
  // ADR-025 D2 — les compteurs suivent la fenêtre et les filtres, JAMAIS le
  // statut actif.
  const counters = useOrdersCounters({ start, end, filters: serverFilters });
  const c = counters.data;
  const countersDown = counters.isError;

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

  // `pick` mémoïsé et PRÉSENT dans les deps du memo : figé sur [c] seul, il
  // capturait un setSearchParams clos sur une URL périmée et un clic de
  // compteur pendant un refetch écrasait les filtres (review PR #367).
  const pick = useCallback((next: OrderStatus | ''): void => {
    patchParams({ status: next === '' ? null : next });
  }, [patchParams]);

  const counterItems = useMemo<ListCounter[]>(() => [
    {
      id: 'all',
      label: 'All orders',
      value: countersDown ? '—' : (c?.total.count ?? 0),
      onSelect: () => { pick(''); },
    },
    ...ORDER_STATUS_ORDER.map((s): ListCounter => {
      const spec = ORDER_STATUS[s];
      const value = statusCell(c, s);
      return {
        id: s,
        label: spec.label,
        value: countersDown ? '—' : value,
        ...(spec.tone !== undefined && value > 0 && !countersDown ? { tone: spec.tone } : {}),
        onSelect: () => { pick(s); },
      };
    }),
  ], [c, countersDown, pick]);

  // Bande d'argent (ADR-025 D5 amendée) — informative, non cliquable. Les
  // sommes sont des TOTAUX DE COMMANDES réglées/non réglées ; le remboursé
  // s'affiche à côté au lieu d'être soustrait en silence.
  const moneyItems = useMemo<ListCounter[]>(() => [
    {
      id: 'amount-total',
      label: 'Window total',
      value: countersDown ? '—' : formatCurrency(c?.total.amount ?? 0),
      title: `Sum of order totals between ${start} and ${end}, current filters applied — voided included.`,
    },
    {
      id: 'amount-paid',
      label: 'Settled',
      value: countersDown ? '—' : formatCurrency(c?.paid.amount ?? 0),
      ...((c?.paid.count ?? 0) > 0 && !countersDown ? { tone: 'success' as const } : {}),
      title: `${(c?.paid.count ?? 0).toLocaleString()} orders with a recorded payment or a paid/completed status (B2B settlements carry no payment row). Sum of order totals — refunds are shown separately.`,
    },
    {
      id: 'amount-unpaid',
      label: 'Unpaid',
      value: countersDown ? '—' : formatCurrency(c?.unpaid.amount ?? 0),
      ...((c?.unpaid.count ?? 0) > 0 && !countersDown ? { tone: 'warning' as const } : {}),
      title: `${(c?.unpaid.count ?? 0).toLocaleString()} orders not settled yet, voided excluded.`,
    },
    {
      id: 'amount-refunded',
      label: 'Refunded',
      // « − Rp 0 » affichait un moins permanent devant un zéro : le signe ne
      // se montre que lorsqu'il y a réellement de l'argent rendu.
      value: countersDown
        ? '—'
        : (c?.refunded.amount ?? 0) > 0
          ? `− ${formatCurrency(c?.refunded.amount ?? 0)}`
          : formatCurrency(0),
      ...((c?.refunded.count ?? 0) > 0 && !countersDown ? { tone: 'danger' as const } : {}),
      title: `${(c?.refunded.count ?? 0).toLocaleString()} orders carry a refund in this window.`,
    },
  ], [c, countersDown, start, end]);

  // Actions de ligne — modales et tiroir de détail.
  const [detailId, setDetailId]     = useState<string | null>(null);
  const [voidTarget, setVoidTarget] = useState<{ id: string; number: string } | null>(null);
  const [editTarget, setEditTarget] = useState<{ id: string; number: string; items: OrderItemEdit[] } | null>(null);

  // Un seul flux d'édition pour les DEUX surfaces : la ligne de table et le
  // tiroir d'aperçu appellent la même fonction, qui monte la même modale.
  async function loadItemsAndOpenEdit(orderId: string, orderNumber: string): Promise<void> {
    const { data, error } = await supabase
      .from('order_items')
      .select('id, product_id, name_snapshot, quantity, unit_price, line_total, modifiers, is_locked')
      .eq('order_id', orderId);
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
    setEditTarget({ id: orderId, number: orderNumber, items });
  }

  const columns = useMemo<readonly DataTableColumn<OrdersListLine>[]>(() => [
    {
      id: 'number', header: 'Order #', width: '7.5rem',
      render: (o) => (
        <Link
          to={`/backoffice/orders/${o.id}`}
          className="font-data text-xs text-info underline [text-decoration-color:color-mix(in_srgb,transparent,var(--info)_70%)] underline-offset-[3px] hover:[text-decoration-color:var(--info)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
        >
          #{o.order_number.replace(/^#+/, '')}
        </Link>
      ),
    },
    {
      id: 'time', header: 'Time', width: '7rem',
      render: (o) => (
        <span className="block whitespace-nowrap font-data text-xs leading-tight tabular-nums">
          {formatTimeWita(o.created_at)}
          <span className="block text-text-muted">{formatDateShortWita(o.created_at)}</span>
        </span>
      ),
    },
    {
      id: 'type', header: 'Type', width: '6.5rem',
      render: (o) => <span className="text-text-secondary">{orderTypeLabel(o.order_type)}</span>,
    },
    {
      id: 'customer', header: 'Customer', width: '13rem',
      render: (o) => (
        o.customer_name !== null
          ? (
            <span className="block max-w-[13rem] truncate text-text-primary" title={o.customer_name}>
              {o.customer_name}
            </span>
          )
          : <span className="text-text-subtle" aria-hidden>—</span>
      ),
    },
    {
      id: 'items', header: 'Items', align: 'right', width: '4.5rem',
      render: (o) => <span className="font-data tabular-nums">{o.items_count}</span>,
    },
    {
      id: 'amount', header: 'Amount', align: 'right', width: '8.5rem',
      render: (o) => <span className="whitespace-nowrap font-data tabular-nums">{formatCurrency(o.total)}</span>,
    },
    {
      id: 'status', header: 'Status', width: '9.5rem',
      render: (o) => (
        <span className={cn(ORDER_STATUS_BADGE, orderStatusBadgeTone(o.status))}>
          {orderStatusLabel(o.status)}
        </span>
      ),
    },
    {
      id: 'payment', header: 'Payment', width: '7.5rem',
      // RÉGLÉ = méthode enregistrée OU statut porteur d'argent : une facture
      // B2B encaissée (statut paid, zéro ligne order_payments) lit « Paid »,
      // plus « Unpaid » à côté d'un badge Paid (review PR #367).
      render: (o) => (
        o.payment_method_primary !== null
          ? <span className="text-text-secondary">{(PAYMENT_METHOD_LABEL as Record<string, string>)[o.payment_method_primary] ?? o.payment_method_primary}</span>
          : isSettledStatus(o.status)
            ? <span className="text-success">Paid</span>
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
            <RowActionButton
              label={`Edit items of ${o.order_number}`}
              testId={`row-edit-${o.id}`}
              onClick={() => { void loadItemsAndOpenEdit(o.id, o.order_number); }}
            >
              <Edit3 className="h-3.5 w-3.5" aria-hidden />
            </RowActionButton>
          )}
          {hasVoid && (o.status === 'paid' || o.status === 'completed') && (
            <RowActionButton
              label={`Void ${o.order_number}`}
              testId={`row-void-${o.id}`}
              destructive
              onClick={() => { setVoidTarget({ id: o.id, number: o.order_number }); }}
            >
              <XCircle className="h-3.5 w-3.5" aria-hidden />
            </RowActionButton>
          )}
          <RowActionButton
            label={`Details of ${o.order_number}`}
            testId={`row-details-${o.id}`}
            onClick={() => { setDetailId(o.id); }}
          >
            <Eye className="h-3.5 w-3.5" aria-hidden />
          </RowActionButton>
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
          <span
            className="inline-flex items-center gap-1.5"
            data-testid="realtime-indicator"
            title={isConnected
              ? 'New orders appear as they are recorded.'
              : 'Realtime is disconnected — the list shows the last loaded state.'}
          >
            <span
              className={cn('inline-block h-1.5 w-1.5 rounded-full', isConnected ? 'bg-success' : 'bg-text-muted')}
              aria-hidden
            />
            {isConnected ? 'Live' : 'Offline — last loaded state'}
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
            {canExport && (
              <button
                type="button"
                className={TOOLBAR_BTN_SECONDARY}
                onClick={() => { exportOrdersCsv(lines, start, end); }}
                disabled={lines.length === 0}
              >
                <Download className="h-3.5 w-3.5 text-text-muted" aria-hidden /> Export
              </button>
            )}
          </>
        }
      />

      {countersDown && (
        <p role="alert" className="rounded-md border border-red bg-red-soft p-3 text-sm text-red-as-text">
          Order counts could not be loaded — the strip shows dashes rather than
          numbers that would be wrong.{' '}
          <button type="button" className="underline" onClick={() => { void counters.refetch(); }}>
            Try again
          </button>
        </p>
      )}

      <ListCounterStrip
        counters={counterItems}
        activeId={status === '' ? 'all' : status}
        ariaLabel="Order status filters"
        data-testid="orders-counters"
      />

      {/* ADR-025 D2 — les compteurs suivent la fenêtre et les filtres serveur,
          JAMAIS la recherche texte (celle-ci ne filtre que les lignes déjà
          chargées, côté client). Sans cet indice, un « 36 » à côté d'une liste
          filtrée à 0 se lisait comme une contradiction. */}
      {quickFind.trim() !== '' && (
        <p className="text-xs text-text-muted" data-testid="orders-counters-hint">
          Counters cover the window, not the text search — typing filters only
          the rows already loaded below.
        </p>
      )}

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
          type="date" lang="id-ID"
          value={startDraft}
          onChange={(e) => { setStartDraft(e.target.value); commitDates(e.target.value, endDraft); }}
          onBlur={() => { commitDates(startDraft, endDraft, true); }}
          className="w-40"
        />
        <label htmlFor="orders-end" className="sr-only">End date</label>
        <Input
          id="orders-end"
          type="date" lang="id-ID"
          value={endDraft}
          onChange={(e) => { setEndDraft(e.target.value); commitDates(startDraft, e.target.value); }}
          onBlur={() => { commitDates(startDraft, endDraft, true); }}
          className="w-40"
        />
        <label htmlFor="orders-type" className="sr-only">Order type</label>
        <Select
          id="orders-type"
          value={params.get('order_type') ?? ''}
          onChange={(e) => { patchParams({ order_type: e.target.value || null }); }}
          className="w-40"
        >
          <option value="">All types</option>
          {ORDER_TYPES.map((t) => (
            <option key={t} value={t}>{ORDER_TYPE_LABEL[t]}</option>
          ))}
        </Select>
        <label htmlFor="orders-payment" className="sr-only">Payment method</label>
        <Select
          id="orders-payment"
          value={params.get('payment_method') ?? ''}
          onChange={(e) => { patchParams({ payment_method: e.target.value || null }); }}
          className="w-44"
        >
          <option value="">All payments</option>
          {PAYMENT_METHODS.map((m) => (
            <option key={m} value={m}>{PAYMENT_METHOD_LABEL[m]}</option>
          ))}
        </Select>
      </div>

      <span className="sr-only" role="status" aria-live="polite">
        {countersDown
          ? 'Order counts unavailable'
          : counters.isLoading
            ? 'Loading order counts'
            : `${activeTotal.toLocaleString()} ${activeTotal === 1 ? 'order' : 'orders'} in the current filter`}
      </span>

      {/* L'erreur SURPLOMBE la table : un refetch raté ne doit pas effacer les
          lignes que l'opérateur lisait (review PR #367). */}
      {query.error !== null && (
        <p role="alert" className="rounded-md border border-red bg-red-soft p-4 text-sm text-red-as-text">
          Orders could not be refreshed — the rows below may be out of date.
          <span className="ml-1 font-data text-xs">{query.error.message}</span>{' '}
          <button type="button" className="underline" onClick={() => { void query.refetch(); }}>
            Try again
          </button>
        </p>
      )}
      {(query.error === null || loadedLines.length > 0) && (
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
              <span className="font-data text-xs tabular-nums text-text-muted">
                {/* La recherche texte ne voit que les lignes chargées : on
                    compte les correspondances SUR le chargé, jamais sur la
                    fenêtre serveur — d'où « X of the Y loaded », sans compteur
                    de fenêtre qui laisserait croire à une recherche complète. */}
                {quickFind.trim() !== ''
                  ? `${lines.length} of the ${loadedLines.length} loaded match “${quickFind.trim()}”`
                  : countersDown
                    ? `${loadedLines.length} loaded`
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

      {/* Le tiroir déclenche, la page monte : les modales (et leur clé
          d'idempotence) restent uniques. On ferme le tiroir AVANT d'ouvrir la
          modale — deux couches empilées mentiraient sur ce qui a le focus. */}
      <OrderDetailDrawer
        orderId={detailId}
        onClose={() => setDetailId(null)}
        onEditItems={(id, number) => { setDetailId(null); void loadItemsAndOpenEdit(id, number); }}
        onVoid={(id, number) => { setDetailId(null); setVoidTarget({ id, number }); }}
      />
      {voidTarget !== null && (
        <VoidOrderModal open orderId={voidTarget.id} orderNumber={voidTarget.number} onClose={() => setVoidTarget(null)} />
      )}
      {editTarget !== null && (
        <EditOrderItemsModal open orderId={editTarget.id} orderNumber={editTarget.number} currentItems={editTarget.items} onClose={() => setEditTarget(null)} />
      )}
    </div>
  );
}
