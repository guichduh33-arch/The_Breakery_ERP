import { B2bOrderStatus } from '@/features/btob/components/B2bOrderStatus.js';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import './b2b-orders.css';
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { ChevronRight, Plus } from 'lucide-react';
import { Input, type DataTableColumn, type DataTableSort } from '@breakery/ui';
import { Button, DataTable } from '@/components/BackofficeUi.js';
import { formatCurrency, formatDateShortWita } from '@breakery/utils';
import { PageHeader } from '@/components/PageHeader.js';
import { ListCounterStrip, type ListCounter } from '@/components/ListCounterStrip.js';
import { QueryErrorBanner } from '@/components/QueryErrorBanner.js';
import { TOOLBAR_BTN_PRIMARY } from '@/components/toolbarButton.js';
import { FOCUS_RING } from '@/components/focusRing.js';
import { useListParams } from '@/hooks/useListParams.js';
import { useAuthStore } from '@/stores/authStore.js';
import type { B2bInvoiceRow } from '@/features/btob/hooks/useB2bInvoices.js';
import {
  useB2bOrdersList,
  B2B_ORDERS_PAGE_SIZE,
  type B2bOrdersSortColumn,
  type B2bOrdersSortDir,
  type B2bPaymentFilter,
} from '@/features/btob/hooks/useB2bOrdersList.js';
import { useB2bOrdersCounters } from '@/features/btob/hooks/useB2bOrdersCounters.js';
import { CreateB2bOrderModal } from '@/features/btob/components/CreateB2bOrderModal.js';

const CREATE_REASON = 'Requires the pos.sale.create permission.';
const SEARCH_COMMIT_MS = 300;

// Colonne d'écran ↔ colonne de tri serveur. Ce qui n'est pas ici n'est pas
// triable, et l'en-tête ne se présente pas comme cliquable.
//
// `customer` en est ABSENTE à dessein : la cellule rend `b2b_company_name ??
// customer_name`, un choix que Postgres ne refait pas en triant sur l'une des
// deux colonnes. La date de retrait, elle, se trie directement côté serveur.
const SORT_TO_COLUMN_ID: Record<B2bOrdersSortColumn, string> = {
  invoice_date: 'invoice_date',
  pickup_date: 'pickup_date',
  order_number: 'order_number',
  invoice_total: 'amount',
};
const COLUMN_ID_TO_SORT: Record<string, B2bOrdersSortColumn> = {
  invoice_date: 'invoice_date',
  pickup_date: 'pickup_date',
  order_number: 'order_number',
  amount: 'invoice_total',
};

const PAYMENT_FILTERS: readonly B2bPaymentFilter[] = ['all', 'unpaid', 'paid'];

function orderDate(iso: string | null): string {
  return iso === null || iso === '' ? '—' : iso.slice(0, 10);
}

export default function B2BOrdersPage(): JSX.Element {
  const [params, patchParams] = useListParams();
  const canCreate = useAuthStore((s) => s.hasPermission('pos.sale.create'));
  const [createOpen, setCreateOpen] = useState<boolean>(false);
  const navigate = useNavigate();
  const location = useLocation();
  const detailUrl = (id: string): string => `/backoffice/b2b/orders/${id}${location.search}`;

  // ── État de liste, lu de l'URL et borné ────────────────────────────────────
  const paymentRaw = params.get('payment') ?? 'all';
  const payment: B2bPaymentFilter = (PAYMENT_FILTERS as readonly string[]).includes(paymentRaw)
    ? (paymentRaw as B2bPaymentFilter)
    : 'all';

  const search = params.get('q') ?? '';

  const sortRaw = params.get('sort') ?? '';
  const sortCol: B2bOrdersSortColumn = Object.hasOwn(SORT_TO_COLUMN_ID, sortRaw)
    ? (sortRaw as B2bOrdersSortColumn)
    : 'pickup_date';
  // Le planning se lit par jour de retrait croissant, dates inconnues en dernier.
  const sortDir: B2bOrdersSortDir = params.get('dir') === 'desc' ? 'desc' : 'asc';

  // La recherche part au SERVEUR : elle se COMMET en débounce, sinon chaque
  // frappe déclencherait une requête comptée `exact` sur toute la vue.
  const [searchDraft, setSearchDraft] = useState(search);
  useEffect(() => {
    setSearchDraft(search);
  }, [search]);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (searchTimer.current !== null) clearTimeout(searchTimer.current);
    },
    [],
  );
  const commitSearch = useCallback(
    (next: string): void => {
      if (searchTimer.current !== null) clearTimeout(searchTimer.current);
      searchTimer.current = setTimeout(() => {
        patchParams({ q: next });
      }, SEARCH_COMMIT_MS);
    },
    [patchParams],
  );

  const pickPayment = useCallback(
    (next: B2bPaymentFilter): void => {
      patchParams({ payment: next === 'all' ? null : next });
    },
    [patchParams],
  );

  const tableSort: DataTableSort = { columnId: SORT_TO_COLUMN_ID[sortCol], direction: sortDir };
  const onSortChange = useCallback(
    (next: DataTableSort): void => {
      const col = COLUMN_ID_TO_SORT[next.columnId];
      if (col === undefined) return;
      patchParams({
        sort: col === 'pickup_date' ? null : col,
        dir: next.direction === 'asc' ? null : next.direction,
      });
    },
    [patchParams],
  );

  // ── Données ────────────────────────────────────────────────────────────────
  const query = useB2bOrdersList({ payment, search, sort: sortCol, dir: sortDir });
  const countersQuery = useB2bOrdersCounters();
  const c = countersQuery.data;
  const countersDown = countersQuery.isError;
  const countersUnknown = countersDown || c === undefined;

  const rows = useMemo<B2bInvoiceRow[]>(
    () => (query.data?.pages ?? []).flatMap((p) => p.rows),
    [query.data],
  );
  /** Combien de lignes EXISTENT sous les filtres courants, serveur compris. */
  const matching = query.data?.pages[0]?.total ?? 0;

  const counters = useMemo<ListCounter[]>(
    () => [
      {
        id: 'all',
        label: 'All orders',
        value: countersUnknown ? '—' : (c?.total ?? 0),
        onSelect: () => {
          pickPayment('all');
        },
      },
      {
        id: 'unpaid',
        label: 'Unpaid',
        value: countersUnknown ? '—' : (c?.unpaid ?? 0),
        ...((c?.unpaid ?? 0) > 0 && !countersUnknown ? { tone: 'warning' as const } : {}),
        onSelect: () => {
          pickPayment('unpaid');
        },
      },
      {
        id: 'paid',
        label: 'Settled',
        value: countersUnknown ? '—' : (c?.paid ?? 0),
        ...((c?.paid ?? 0) > 0 && !countersUnknown ? { tone: 'success' as const } : {}),
        onSelect: () => {
          pickPayment('paid');
        },
      },
      {
        id: 'outstanding',
        label: 'Outstanding',
        value:
          countersUnknown || c?.outstandingAr === null || c?.outstandingAr === undefined
            ? '—'
            : formatCurrency(c.outstandingAr),
        ...((c?.outstandingAr ?? 0) > 0 && !countersUnknown ? { tone: 'danger' as const } : {}),
        title:
          'Total still owed across every unpaid B2B order — the whole ledger, not the current filter.',
      },
    ],
    [c, countersUnknown, pickPayment],
  );

  const columns: DataTableColumn<B2bInvoiceRow>[] = [
    {
      id: 'order_number',
      header: 'Order no.',
      sortable: true,
      render: (r) => (
        <Link
          to={detailUrl(r.invoice_id)}
          onClick={(e) => {
            e.stopPropagation();
          }}
          className={`font-medium text-text-primary underline-offset-4 hover:underline ${FOCUS_RING}`}
        >
          {r.order_number}
        </Link>
      ),
    },
    {
      id: 'invoice_date',
      header: 'Created',
      sortable: true,
      render: (r) => (
        <span className="whitespace-nowrap text-text-secondary">{orderDate(r.invoice_date)}</span>
      ),
    },
    {
      id: 'customer',
      header: 'Customer',
      render: (r) => (
        <span className="font-medium">{r.b2b_company_name ?? r.customer_name ?? '—'}</span>
      ),
    },
    {
      id: 'pickup_date',
      header: 'Pickup',
      sortable: true,
      render: (r) =>
        r.pickup_date ? (
          formatDateShortWita(r.pickup_date)
        ) : (
          <span className="text-text-muted">not set</span>
        ),
    },
    {
      id: 'amount',
      header: 'Amount',
      align: 'right',
      sortable: true,
      render: (r) => formatCurrency(r.invoice_total),
    },
    { id: 'status', header: 'Status', render: (r) => <B2bOrderStatus order={r} /> },
  ];
  return (
    <div className="b2b-orders-page flex flex-col gap-6">
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm text-text-muted">
        <span>B2B</span>
        <ChevronRight className="h-3 w-3" aria-hidden />
        <span>Orders</span>
      </nav>
      <PageHeader
        title="B2B orders"
        subtitle="Track pickup and payment at a glance. Open an order to view its details and update its status."
        actions={
          <>
            <button
              type="button"
              className={TOOLBAR_BTN_PRIMARY}
              disabled={!canCreate}
              {...(canCreate
                ? {}
                : { title: CREATE_REASON, 'aria-describedby': 'b2b-create-reason' })}
              onClick={() => {
                setCreateOpen(true);
              }}
            >
              <Plus className="h-4 w-4" aria-hidden /> New B2B Order
            </button>
            {!canCreate && (
              <span id="b2b-create-reason" className="sr-only">
                {CREATE_REASON}
              </span>
            )}
          </>
        }
      />
      {countersDown && (
        <QueryErrorBanner
          onRetry={() => {
            void countersQuery.refetch();
          }}
          data-testid="b2b-orders-counters-error"
        >
          B2B order counts could not be loaded.
        </QueryErrorBanner>
      )}
      <ListCounterStrip
        counters={counters}
        activeId={payment}
        ariaLabel="B2B order filters"
        data-testid="b2b-orders-counters"
      />
      {search.trim() !== '' && (
        <p className="text-sm text-text-muted" data-testid="b2b-orders-counters-hint">
          Counters cover every B2B order, not the search — the table below shows the matches.
        </p>
      )}
      <div>
        <label htmlFor="b2b-search" className="sr-only">
          Search B2B orders
        </label>
        <Input
          id="b2b-search"
          type="search"
          value={searchDraft}
          onChange={(e) => {
            setSearchDraft(e.target.value);
            commitSearch(e.target.value);
          }}
          placeholder="Search customer or order no."
          maxLength={64}
          className="w-full max-w-md"
          data-testid="b2b-orders-search"
        />
      </div>
      <span className="sr-only" role="status" aria-live="polite">
        {query.isLoading ? 'Loading B2B orders' : matching + ' orders match the current filter'}
      </span>
      {query.error !== null && (
        <QueryErrorBanner
          detail={query.error.message}
          onRetry={() => {
            void query.refetch();
          }}
          data-testid="b2b-orders-error"
        >
          B2B orders could not be loaded.
        </QueryErrorBanner>
      )}
      {(query.error === null || rows.length > 0) && (
        <DataTable<B2bInvoiceRow>
          caption="Order number, creation date, customer, pickup date, amount and status per B2B order"
          columns={columns}
          rows={rows}
          getRowKey={(r) => r.invoice_id}
          isLoading={query.isLoading}
          loadingRowCount={B2B_ORDERS_PAGE_SIZE}
          density="default"
          sort={tableSort}
          onSortChange={onSortChange}
          onRowClick={(r) => {
            void navigate(detailUrl(r.invoice_id));
          }}
          emptyTitle="No B2B order"
          emptyDescription={
            search.trim()
              ? 'No orders match your search.'
              : 'Wholesale orders appear here as soon as one is created.'
          }
          data-testid="b2b-orders-table"
          footer={
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm text-text-muted" data-testid="b2b-orders-footer-count">
                {rows.length.toLocaleString('id-ID')} of {matching.toLocaleString('id-ID')} loaded
              </span>
              {query.hasNextPage && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    void query.fetchNextPage();
                  }}
                  disabled={query.isFetchingNextPage}
                >
                  {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
                </Button>
              )}
            </div>
          }
        />
      )}
      <CreateB2bOrderModal
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
        }}
      />
    </div>
  );
}
