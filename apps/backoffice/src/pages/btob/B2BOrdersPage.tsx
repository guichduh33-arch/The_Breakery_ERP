// apps/backoffice/src/pages/btob/B2BOrdersPage.tsx
//
// Archétype LIST, régime FENÊTRÉ — les commandes professionnelles, une ligne par
// commande.
//
// La source est `view_b2b_invoices` : côté base, une facture B2B n'est pas un
// objet séparé, c'est la commande vue sous son angle comptable (`o.id AS
// invoice_id`). Cette page la regarde sous l'angle commande.
//
// Le clic déplie la commande sur ses lignes, chargées à ce moment-là. C'est ce
// qui permet de garder une liste dense — le détail ne coûte rien tant qu'on ne
// le demande pas, et il évite un aller-retour vers une page de détail pour
// répondre à « qu'est-ce qu'il y avait dedans ? ».
//
// ── Ce que la page a cessé de faire (campagne design 2026-08-18, lot E) ──────
//
// Elle lisait 500 lignes d'un coup, filtrait et triait en mémoire, et affichait
// un pied « N of N » calculé sur ce qu'elle avait reçu. Le défaut n'était pas
// esthétique : passé 500 commandes, le pied et les quatre compteurs auraient
// menti EN SILENCE. Tout ce qui borne la liste — filtre de règlement, recherche,
// tri, progression — est désormais SERVEUR (`useB2bOrdersList`), les compteurs
// sont comptés serveur (`useB2bOrdersCounters`), et le pied déclare le CHARGÉ
// contre l'EXISTANT.
//
// L'état de liste vit dans l'URL (`useListParams`) : un impayé qu'on poursuit se
// partage par lien, et le retour arrière depuis une fiche restaure ce qu'on
// regardait. Seules les lignes DÉPLIÉES restent locales — voir plus bas.

import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { Button, cn, DataTable, Input, type DataTableColumn, type DataTableSort } from '@breakery/ui';
import { formatCurrency, formatDateShortWita } from '@breakery/utils';
import { PageHeader } from '@/components/PageHeader.js';
import { ListCounterStrip, type ListCounter } from '@/components/ListCounterStrip.js';
import { QueryErrorBanner } from '@/components/QueryErrorBanner.js';
import { TOOLBAR_BTN_PRIMARY } from '@/components/toolbarButton.js';
import { FOCUS_RING } from '@/components/focusRing.js';
import { useListParams } from '@/hooks/useListParams.js';
import {
  ORDER_STATUS_BADGE,
  orderStatusBadgeTone,
  orderStatusLabel,
} from '@/features/orders/statusMeta.js';
import {
  B2B_SETTLEMENT_BADGE,
  B2B_SETTLEMENT_TONE,
} from '@/features/btob/paymentStatusMeta.js';
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
import { B2bOrderItemsPanel } from '@/features/btob/components/B2bOrderItemsPanel.js';
import { CreateB2bOrderModal } from '@/features/btob/components/CreateB2bOrderModal.js';

const CREATE_REASON = 'Requires the pos.sale.create permission.';
const SEARCH_COMMIT_MS = 300;

// Colonne d'écran ↔ colonne de tri serveur. Ce qui n'est pas ici n'est pas
// triable, et l'en-tête ne se présente pas comme cliquable.
//
// `customer` en est ABSENTE à dessein : la cellule rend `b2b_company_name ??
// customer_name`, un choix que Postgres ne refait pas en triant sur l'une des
// deux colonnes. Trier dessus produirait un ordre qui ne correspond à rien de ce
// qu'on lit. `status` et `pickup` aussi : un classement par badge ne répond à
// aucune question, et la date de retrait est vide partout tant que sa saisie
// n'est pas branchée.
const SORT_TO_COLUMN_ID: Record<B2bOrdersSortColumn, string> = {
  invoice_date:  'invoice_date',
  order_number:  'order_number',
  invoice_total: 'amount',
};
const COLUMN_ID_TO_SORT: Record<string, B2bOrdersSortColumn> = {
  invoice_date: 'invoice_date',
  order_number: 'order_number',
  amount:       'invoice_total',
};

const PAYMENT_FILTERS: readonly B2bPaymentFilter[] = ['all', 'unpaid', 'paid'];

function orderDate(iso: string | null): string {
  return iso === null || iso === '' ? '—' : iso.slice(0, 10);
}

/** Le statut de commande, et l'impayé qui le double quand il existe. */
function statusBadges(row: B2bInvoiceRow): JSX.Element {
  const unpaid = Number(row.outstanding) > 0;
  // L'annulation B2B pose `voided` (cancel_b2b_order) — « cancelled » n'existe
  // pas dans l'enum ; on garde les deux gardes tant que la vue type en string.
  const dead = row.order_status === 'voided' || row.order_status === 'cancelled';
  return (
    <div className="flex items-center gap-1.5">
      <span className={cn(ORDER_STATUS_BADGE, orderStatusBadgeTone(row.order_status))}>
        {orderStatusLabel(row.order_status)}
      </span>
      {unpaid && !dead && (
        <span
          className={cn(B2B_SETTLEMENT_BADGE, B2B_SETTLEMENT_TONE.unpaid)}
          title={`${formatCurrency(row.outstanding)} still outstanding`}
        >
          unpaid
        </span>
      )}
    </div>
  );
}

export default function B2BOrdersPage(): JSX.Element {
  const [params, patchParams] = useListParams();
  const canCreate = useAuthStore((s) => s.hasPermission('pos.sale.create'));
  const [createOpen, setCreateOpen] = useState<boolean>(false);

  // Les lignes DÉPLIÉES restent locales, et c'est délibéré : ce sont des
  // identifiants de lignes présentes dans la fenêtre courante. Les écrire dans
  // l'URL promettrait une restauration que la pagination au curseur ne peut pas
  // tenir — un lien collé ailleurs rouvrirait des lignes qui ne sont pas
  // chargées, donc rien. Déplier est un geste de lecture, pas un état de liste.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  // ── État de liste, lu de l'URL et borné ────────────────────────────────────
  const paymentRaw = params.get('payment') ?? 'all';
  const payment: B2bPaymentFilter = (PAYMENT_FILTERS as readonly string[]).includes(paymentRaw)
    ? (paymentRaw as B2bPaymentFilter)
    : 'all';

  const search = params.get('q') ?? '';

  const sortRaw = params.get('sort') ?? '';
  const sortCol: B2bOrdersSortColumn = Object.hasOwn(SORT_TO_COLUMN_ID, sortRaw)
    ? (sortRaw as B2bOrdersSortColumn)
    : 'invoice_date';
  // Le défaut reste ANTICHRONOLOGIQUE. La vue trie du plus ancien au plus récent
  // pour l'imputation FIFO des règlements ; une liste de commandes se lit dans
  // l'autre sens — la dernière commande est celle dont on parle.
  const sortDir: B2bOrdersSortDir = params.get('dir') === 'asc' ? 'asc' : 'desc';

  // La recherche part au SERVEUR : elle se COMMET en débounce, sinon chaque
  // frappe déclencherait une requête comptée `exact` sur toute la vue.
  const [searchDraft, setSearchDraft] = useState(search);
  useEffect(() => { setSearchDraft(search); }, [search]);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (searchTimer.current !== null) clearTimeout(searchTimer.current);
  }, []);
  const commitSearch = useCallback((next: string): void => {
    if (searchTimer.current !== null) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => { patchParams({ q: next }); }, SEARCH_COMMIT_MS);
  }, [patchParams]);

  const pickPayment = useCallback((next: B2bPaymentFilter): void => {
    patchParams({ payment: next === 'all' ? null : next });
  }, [patchParams]);

  const tableSort: DataTableSort = { columnId: SORT_TO_COLUMN_ID[sortCol], direction: sortDir };
  const onSortChange = useCallback((next: DataTableSort): void => {
    const col = COLUMN_ID_TO_SORT[next.columnId];
    if (col === undefined) return;
    patchParams({
      sort: col === 'invoice_date' ? null : col,
      dir:  next.direction === 'desc' ? null : next.direction,
    });
  }, [patchParams]);

  // ── Données ────────────────────────────────────────────────────────────────
  const query = useB2bOrdersList({ payment, search, sort: sortCol, dir: sortDir });
  const countersQuery = useB2bOrdersCounters();
  const c = countersQuery.data;
  const countersDown = countersQuery.isError;

  const rows = useMemo<B2bInvoiceRow[]>(
    () => (query.data?.pages ?? []).flatMap((p) => p.rows),
    [query.data],
  );
  /** Combien de lignes EXISTENT sous les filtres courants, serveur compris. */
  const matching = query.data?.pages[0]?.total ?? 0;

  const counters = useMemo<ListCounter[]>(() => [
    {
      id: 'all',
      label: 'All orders',
      value: countersDown ? '—' : (c?.total ?? 0),
      onSelect: () => { pickPayment('all'); },
    },
    {
      id: 'unpaid',
      label: 'Unpaid',
      value: countersDown ? '—' : (c?.unpaid ?? 0),
      ...((c?.unpaid ?? 0) > 0 && !countersDown ? { tone: 'warning' as const } : {}),
      onSelect: () => { pickPayment('unpaid'); },
    },
    {
      id: 'paid',
      label: 'Settled',
      value: countersDown ? '—' : (c?.paid ?? 0),
      ...((c?.paid ?? 0) > 0 && !countersDown ? { tone: 'success' as const } : {}),
      onSelect: () => { pickPayment('paid'); },
    },
    {
      id: 'outstanding',
      label: 'Outstanding',
      value: c?.outstandingAr === null || c?.outstandingAr === undefined
        ? '—'
        : formatCurrency(c.outstandingAr),
      ...((c?.outstandingAr ?? 0) > 0 ? { tone: 'danger' as const } : {}),
      title: 'Total still owed across every unpaid B2B order — the whole ledger, not the current filter.',
    },
  ], [c, countersDown, pickPayment]);

  const toggle = (id: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const columns: DataTableColumn<B2bInvoiceRow>[] = [
    {
      id: 'order_number',
      header: 'Order no.',
      sortable: true,
      // Le chevron est un BOUTON, pas un ornement. Le clic-ligne reste le
      // raccourci souris, mais il ne se prend ni au Tab ni à Entrée : sans ce
      // bouton, le détail d'une commande était inatteignable au clavier
      // (WCAG 2.1.1). `stopPropagation` évite le double basculement quand le
      // clic sur le chevron remonte jusqu'à la ligne.
      render: (r) => {
        const isOpen = expanded.has(r.invoice_id);
        return (
          <span className="flex items-center gap-1.5">
            <button
              type="button"
              aria-expanded={isOpen}
              aria-label={`${isOpen ? 'Hide' : 'Show'} the lines of order ${r.order_number}`}
              onClick={(e) => { e.stopPropagation(); toggle(r.invoice_id); }}
              className={`rounded-sm text-text-subtle transition-colors duration-fast hover:text-text-primary ${FOCUS_RING}`}
            >
              {isOpen
                ? <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                : <ChevronRight className="h-3.5 w-3.5" aria-hidden />}
            </button>
            <span className="font-data text-xs text-text-primary">{r.order_number}</span>
          </span>
        );
      },
    },
    {
      id: 'invoice_date',
      header: 'Created',
      sortable: true,
      render: (r) => <span className="font-data text-xs tabular-nums">{orderDate(r.invoice_date)}</span>,
    },
    {
      id: 'customer',
      header: 'Customer',
      render: (r) => (
        <span className="text-sm text-text-primary">
          {r.b2b_company_name ?? r.customer_name ?? '—'}
        </span>
      ),
    },
    {
      id: 'pickup_date',
      header: 'Pickup',
      // Le libellé dit « Pickup » et non « Delivery » : la marchandise est
      // retirée au magasin, il n'existe aucune tournée. Un en-tête qui en
      // promettrait une ferait attendre un flux qui n'existe pas.
      render: (r) =>
        r.pickup_date === null ? (
          <span className="font-data text-xs text-text-muted" title="No pickup day agreed on this order">
            not set
          </span>
        ) : (
          <span className="font-data text-xs tabular-nums">{formatDateShortWita(r.pickup_date)}</span>
        ),
    },
    {
      id: 'amount',
      header: 'Amount',
      align: 'right',
      sortable: true,
      render: (r) => <span className="font-data text-xs">{formatCurrency(r.invoice_total)}</span>,
    },
    {
      id: 'status',
      header: 'Status',
      render: statusBadges,
    },
  ];

  return (
    <div className="flex flex-col gap-[13px]">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs text-text-muted">
        {/* Chevron ICÔNE et non glyphe `›` : le glyphe hérite de la ligne de
            base du texte et se pose 1 px trop haut entre deux segments de 12 px,
            là où l'icône se centre et prend sa couleur du jeton. C'est l'idiome
            UNIQUE du dépôt depuis le 2026-08-18 — `ReportShell` le portait déjà
            pour les 43 pages de rapports, les onze pages restées au glyphe l'ont
            rejoint. Couleur `text-text-inert` : DESIGN.md § Colors nomme
            explicitement ce rôle (« le gris des séparateurs de fil d'Ariane »).
            Le `text-border-strong` posé ici au tour 2 était un AUTRE gris —
            3,328:1 contre le papier de page quand l'inerte vaut 1,612:1 : deux
            chevrons manifestement différents à deux pages d'écart. */}
        <span>B2B</span>
        <ChevronRight className="h-3 w-3 text-text-inert" aria-hidden />
        <span className="text-text-secondary">Orders</span>
      </nav>

      <PageHeader
        title="B2B orders"
        subtitle="One row per wholesale order. Click a row to see what was in it. Orders are collected in store — there is no delivery run."
        actions={
          <>
            <button
              type="button"
              className={TOOLBAR_BTN_PRIMARY}
              disabled={!canCreate}
              {...(canCreate ? {} : { title: CREATE_REASON, 'aria-describedby': 'b2b-create-reason' })}
              onClick={() => { setCreateOpen(true); }}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden /> New B2B Order
            </button>
            {/* Un bouton désactivé n'est pas focalisable : le `title` seul
                n'atteint ni le clavier ni le lecteur d'écran. La raison est donc
                aussi un texte `sr-only` référencé par `aria-describedby`. */}
            {!canCreate && <span id="b2b-create-reason" className="sr-only">{CREATE_REASON}</span>}
          </>
        }
      />

      {countersDown && (
        <QueryErrorBanner
          onRetry={() => { void countersQuery.refetch(); }}
          data-testid="b2b-orders-counters-error"
        >
          B2B order counts could not be loaded — the strip shows dashes rather
          than numbers that would be wrong.
        </QueryErrorBanner>
      )}

      <ListCounterStrip
        counters={counters}
        activeId={payment}
        ariaLabel="B2B order filters"
        data-testid="b2b-orders-counters"
      />

      {/* Les compteurs couvrent tout le registre, la recherche non : sans cet
          indice, un « 46 » à côté d'une liste réduite à 2 se lirait comme une
          contradiction. Même geste que la note d'OrdersListPage. */}
      {search.trim() !== '' && (
        <p className="text-xs text-text-muted" data-testid="b2b-orders-counters-hint">
          Counters cover every B2B order, not the search — the table below shows
          the matches.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="b2b-search" className="sr-only">Search B2B orders</label>
        <Input
          id="b2b-search"
          type="search"
          value={searchDraft}
          onChange={(e) => { setSearchDraft(e.target.value); commitSearch(e.target.value); }}
          placeholder="Search customer or order no."
          maxLength={64}
          className="w-full max-w-xs"
          data-testid="b2b-orders-search"
        />
      </div>

      <span className="sr-only" role="status" aria-live="polite">
        {query.isLoading
          ? 'Loading B2B orders'
          : `${matching.toLocaleString('id-ID')} ${matching === 1 ? 'order' : 'orders'} match the current filter`}
      </span>

      {query.error !== null && (
        <QueryErrorBanner
          detail={query.error.message}
          onRetry={() => { void query.refetch(); }}
          data-testid="b2b-orders-error"
        >
          B2B orders could not be loaded — the rows below may be out of date.
        </QueryErrorBanner>
      )}

      {/* Erreur ET aucune ligne : la table n'est pas rendue, son état vide
          dirait « aucune commande B2B » là où c'est la requête qui a échoué. */}
      {(query.error === null || rows.length > 0) && (
        <DataTable<B2bInvoiceRow>
          caption="Order number, creation date, customer, pickup date, amount and status per B2B order"
          columns={columns}
          rows={rows}
          getRowKey={(r) => r.invoice_id}
          isLoading={query.isLoading}
          // Le squelette faisait 5 lignes (le défaut du primitif) pour une
          // fenêtre qui en rend jusqu'à 50 : la page sautait à l'arrivée des
          // données. Il fait désormais la taille de la fenêtre.
          loadingRowCount={B2B_ORDERS_PAGE_SIZE}
          density="compact"
          sort={tableSort}
          onSortChange={onSortChange}
          onRowClick={(r) => { toggle(r.invoice_id); }}
          expandedKeys={expanded}
          renderExpanded={(r) => (
            <B2bOrderItemsPanel orderId={r.invoice_id} orderTotal={Number(r.invoice_total)} />
          )}
          emptyTitle="No B2B order"
          emptyDescription={
            search.trim() !== ''
              ? `Nothing matches “${search.trim()}”. Clear the search, or pick another counter above.`
              : payment === 'all'
                ? 'Wholesale orders appear here as soon as one is created.'
                : `No ${payment === 'unpaid' ? 'unpaid' : 'settled'} order right now.`
          }
          data-testid="b2b-orders-table"
          footer={
            <div className="flex items-center justify-between">
              {/* CHARGÉ contre EXISTANT. L'ancien pied disait « N of N » : les
                  deux nombres venaient du même tableau reçu, donc il ne pouvait
                  rien dire d'autre que « tout ». Le second nombre est désormais
                  le `count: 'exact'` du serveur. */}
              <span
                className="font-data text-xs tabular-nums text-text-muted"
                data-testid="b2b-orders-footer-count"
              >
                {rows.length.toLocaleString('id-ID')} of {matching.toLocaleString('id-ID')} loaded
              </span>
              {/* Primitif partagé en `sm`, PAS `TOOLBAR_BTN_SECONDARY` :
                  DESIGN.md § Boutons réserve ces chaînes au bandeau de page « et
                  à lui seul », et un pied de table n'en est pas un. C'est aussi
                  ce qui ramène « Load more » à une hauteur unique — il rendait
                  32 px ici, 36 px sur trois pages et 56 px au grand livre. */}
              {query.hasNextPage && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => { void query.fetchNextPage(); }}
                  disabled={query.isFetchingNextPage}
                >
                  {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
                </Button>
              )}
            </div>
          }
        />
      )}

      <CreateB2bOrderModal open={createOpen} onClose={() => { setCreateOpen(false); }} />
    </div>
  );
}
