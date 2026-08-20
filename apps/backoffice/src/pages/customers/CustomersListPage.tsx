// apps/backoffice/src/pages/customers/CustomersListPage.tsx
//
// Liste des clients — instance de l'archétype LIST.
//
// Ce que la refonte change, et pourquoi :
//   · Les tuiles KPI à icônes cèdent à la bande de compteurs de l'archétype
//     (`ListCounterStrip`). Ici les compteurs sont INFORMATIFS et non
//     cliquables : aucun filtre serveur ne correspond à « actif ce mois » ou
//     « encours B2B », et un compteur qui ne filtre pas ne doit pas se
//     présenter comme un contrôle. Le jeu est borné (la liste charge tous les
//     clients), le comptage en mémoire est donc légitime au sens de
//     l'ADR-024 — ce n'est pas le cas paginé des commandes (ADR-025).
//   · La recherche héroïque cartée et les filtres en cartes cèdent à une
//     rangée de contrôles plats de 34 px.
//   · Le `DataTable` passe en densité compacte avec un pied TOUJOURS rendu
//     (« N of M ») ; les colonnes chiffrées rendent en mono tabulaire.
//   · Les actions du bandeau rejoignent la famille des boutons de barre
//     (32 px) — elles mélangeaient deux familles de hauteurs.

import { Link, useNavigate } from 'react-router-dom';
import { useMemo, useState, type JSX } from 'react';
import { ChevronRight, Download, FileText, Plus, Tag, Upload } from 'lucide-react';
import {
  DataTable,
  Input,
  LoyaltyBadge,
  Select,
  type DataTableColumn,
} from '@breakery/ui';
import { tierFromLifetime } from '@breakery/domain';
import { formatCurrency } from '@breakery/utils';
import { PageHeader } from '@/components/PageHeader.js';
import { ListCounterStrip, type ListCounter } from '@/components/ListCounterStrip.js';
import { QueryErrorBanner } from '@/components/QueryErrorBanner.js';
import { ListPagination, pageSlice } from '@/components/ListPagination.js';
import { TOOLBAR_BTN_PRIMARY, TOOLBAR_BTN_SECONDARY, TOOLBAR_ICON } from '@/components/toolbarButton.js';
import { FOCUS_RING } from '@/components/focusRing.js';
import { useAuthStore } from '@/stores/authStore.js';
import { CustomerAvatar } from '@/features/customers/components/CustomerAvatar.js';
import { CustomerCategoryChip } from '@/features/customers/components/CustomerCategoryChip.js';
import {
  useCustomersList,
  type CustomersListRow,
  type CustomersTier,
  type CustomersSort,
} from '@/features/customers/hooks/useCustomersList.js';
import { useCustomerCategories } from '@/features/customers/hooks/useCustomerCategories.js';
import { useCustomersStats } from '@/features/customers/hooks/useCustomersStats.js';
import { CustomerFormModal } from '@/features/loyalty/components/CustomerFormModal.js';
import { toast } from 'sonner';
import { ImportEntityModal } from '@/features/data-import/components/ImportEntityModal.js';
import { buildTemplateWorkbook, buildExportWorkbook, downloadWorkbook } from '@/features/data-import/buildEntityWorkbook.js';
import { customersImportDef } from '@/features/customers/import/customersImportDef.js';
import { useCustomersExport } from '@/features/customers/hooks/useCustomersExport.js';

const TIER_OPTIONS: readonly { value: CustomersTier; label: string }[] = [
  { value: 'all',      label: 'All tiers' },
  { value: 'bronze',   label: 'Bronze' },
  { value: 'silver',   label: 'Silver' },
  { value: 'gold',     label: 'Gold' },
  { value: 'platinum', label: 'Platinum' },
];

const SORT_OPTIONS: readonly { value: CustomersSort; label: string }[] = [
  { value: 'last_visit', label: 'Sort: last visit' },
  { value: 'name',       label: 'Sort: name (A→Z)' },
  { value: 'spend',      label: 'Sort: total spent' },
  { value: 'points',     label: 'Sort: points' },
];

// Colonne de la table → clé de tri du hook. Les quatre clés serveur, pas une de
// plus : `category`, `tier` et `credit` n'ont pas d'ordre côté requête, et une
// entête cliquable qui ne trie rien est un état menteur.
const COLUMN_SORT: Record<string, CustomersSort> = {
  customer: 'name',
  points:   'points',
  spent:    'spend',
  last:     'last_visit',
};

// Chaque clé porte une direction FIXE côté hook (`useCustomersList`) : le nom
// monte, l'argent, les points et la dernière visite descendent. On affiche donc
// la direction réelle du serveur plutôt qu'un chevron réversible que la requête
// ignorerait.
const SORT_DIRECTION: Record<CustomersSort, 'asc' | 'desc'> = {
  name:       'asc',
  spend:      'desc',
  points:     'desc',
  last_visit: 'desc',
};

const CUSTOMERS_PAGE_SIZE_DEFAULT = 50;

function formatLastVisit(iso: string | null): string {
  if (iso === null) return '—';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export default function CustomersListPage(): JSX.Element {
  const navigate      = useNavigate();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canRead       = hasPermission('customers.read');
  const canCreate     = hasPermission('customers.create');
  const canManageCats = hasPermission('customer_categories.read');

  const [search,     setSearch    ] = useState<string>('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [tier,       setTier      ] = useState<CustomersTier>('all');
  const [sort,       setSort      ] = useState<CustomersSort>('last_visit');
  const [creating,   setCreating  ] = useState<boolean>(false);
  const [importing,  setImporting ] = useState<boolean>(false);
  // Pagination CLIENT : le hook charge toute la base cliente d'un coup (jeu
  // borné, cf. l'en-tête de ce fichier), le pied ne fait que découper.
  const [page,       setPage      ] = useState<number>(1);
  const [pageSize,   setPageSize  ] = useState<number>(CUSTOMERS_PAGE_SIZE_DEFAULT);
  const exportMut = useCustomersExport();

  // Tout changement de filtre ou de tri ramène en page 1 : rester en page 7
  // d'un résultat qui n'en compte plus que 2 afficherait une table vide qu'on
  // croirait cassée.
  function applySearch(next: string): void      { setSearch(next);     setPage(1); }
  function applyCategory(next: string | null): void { setCategoryId(next); setPage(1); }
  function applyTier(next: CustomersTier): void { setTier(next);       setPage(1); }
  function applySort(next: CustomersSort): void { setSort(next);       setPage(1); }

  const filters = useMemo(
    () => ({
      ...(search !== '' ? { search } : {}),
      categoryId,
      tier,
      sort,
    }),
    [search, categoryId, tier, sort],
  );

  const list  = useCustomersList(filters);
  const cats  = useCustomerCategories();
  const stats = useCustomersStats();

  function handleTemplate(): void {
    downloadWorkbook(buildTemplateWorkbook(customersImportDef), 'breakery-customers-template.xlsx');
  }
  async function handleExport(): Promise<void> {
    try {
      const rows = await exportMut.mutateAsync();
      downloadWorkbook(
        buildExportWorkbook(customersImportDef, rows),
        `breakery-customers-export-${new Date().toISOString().slice(0, 10)}.xlsx`,
      );
    } catch (e) {
      toast.error(`Export failed: ${(e as Error).message}`);
    }
  }

  // Compteurs informatifs — pas de `onSelect` : aucun filtre serveur ne leur
  // correspond, la bande annonce l'état de la base clients, elle ne filtre pas.
  //
  // Tant que `stats.data` est indéfini — au premier chargement comme après un
  // échec — la bande ne SAIT pas : chaque cellule rend un tiret cadratin grisé
  // plutôt qu'un zéro. « 0 client » et « je ne sais pas encore » ne se
  // ressemblent pas. Même règle que les compteurs du catalogue
  // (`features/products/counters.ts`) et que ceux des commandes. Les infobulles
  // suivent : chiffrées quand le compte est su, réduites à leur définition
  // sinon — « 0% of the customer base » était le même mensonge en plus petit.
  const counters = useMemo<ListCounter[]>(() => {
    const s = stats.data;
    const unknownCell = { value: '—', muted: true } as const;
    return [
      {
        id: 'total',
        label: 'Customers',
        ...(s === undefined ? unknownCell : { value: s.totalCustomers }),
      },
      {
        id: 'active',
        label: 'Active this month',
        ...(s === undefined ? unknownCell : { value: s.activeThisMonth }),
        title: 'Customers with at least one recorded visit since the 1st of the month.',
      },
      {
        id: 'loyalty',
        label: 'Loyalty members',
        ...(s === undefined ? unknownCell : { value: s.loyaltyMembers }),
        title: s === undefined
          ? 'Share of the customer base that has earned loyalty points.'
          : `${s.loyaltyPercent}% of the customer base has earned loyalty points.`,
      },
      {
        id: 'b2b-outstanding',
        label: 'Outstanding B2B',
        ...(s === undefined ? unknownCell : { value: formatCurrency(s.outstandingB2b) }),
        ...(s !== undefined && s.outstandingB2b > 0 ? { tone: 'warning' as const } : {}),
        title: s === undefined
          ? 'Account customers carrying an unpaid balance.'
          : `${s.outstandingCount.toLocaleString('id-ID')} account customers carry an unpaid balance.`,
      },
    ];
  }, [stats.data]);

  const columns = useMemo<readonly DataTableColumn<CustomersListRow>[]>(() => [
    {
      id:     'customer',
      header: 'Customer',
      sortable: true,
      // La navigation vers la fiche est portée par un vrai lien — le clic-ligne
      // du `DataTable` ne se prend ni au Tab ni à Entrée, et la fiche client
      // était donc inatteignable au clavier depuis cette liste (WCAG 2.1.1).
      // Même motif que la colonne « PO Number » des bons de commande :
      // `stopPropagation` empêche la ligne de naviguer une seconde fois.
      render: (row) => (
        <div className="flex items-center gap-3">
          <CustomerAvatar name={row.name} />
          <div className="leading-tight">
            <Link
              to={`/backoffice/customers/${row.id}`}
              onClick={(e) => e.stopPropagation()}
              className={`rounded-sm font-medium text-text-primary hover:text-gold hover:underline ${FOCUS_RING}`}
            >
              {row.name}
            </Link>
            {row.phone !== null && (
              <div className="font-data text-xs tabular-nums text-text-muted">{row.phone}</div>
            )}
          </div>
        </div>
      ),
    },
    {
      id:     'category',
      header: 'Category',
      width:  '10rem',
      render: (row) => (
        <CustomerCategoryChip name={row.category_name} slug={row.category_slug} />
      ),
    },
    {
      id:     'tier',
      header: 'Loyalty tier',
      width:  '10rem',
      render: (row) => {
        const t = tierFromLifetime(row.lifetime_points);
        return <LoyaltyBadge tier={t} points={row.loyalty_points} />;
      },
    },
    {
      id:     'credit',
      header: 'B2B balance',
      headerClassName: 'whitespace-nowrap',
      align:  'right',
      width:  '8.5rem',
      render: (row) =>
        row.customer_type === 'b2b' && row.b2b_current_balance > 0 ? (
          <span className="whitespace-nowrap font-data tabular-nums text-warning">
            {formatCurrency(row.b2b_current_balance)}
          </span>
        ) : (
          <span className="text-text-subtle" aria-hidden>—</span>
        ),
    },
    {
      id:     'points',
      header: 'Points',
      align:  'right',
      width:  '6rem',
      sortable: true,
      render: (row) => (
        <span className="font-data tabular-nums">{row.loyalty_points.toLocaleString('id-ID')}</span>
      ),
    },
    {
      id:     'spent',
      header: 'Total spent',
      align:  'right',
      width:  '8.5rem',
      sortable: true,
      render: (row) => (
        <span className="whitespace-nowrap font-data tabular-nums">{formatCurrency(row.total_spent)}</span>
      ),
    },
    {
      id:     'last',
      header: 'Last visit',
      align:  'right',
      width:  '6.5rem',
      sortable: true,
      render: (row) => (
        <span className="text-xs text-text-secondary">{formatLastVisit(row.last_visit_at)}</span>
      ),
    },
  ], []);

  if (!canRead) {
    return (
      <div className="flex flex-col gap-[13px]">
        <PageHeader title="Customers" />
        <p role="status" className="rounded-md border border-border-subtle bg-bg-elevated p-4 text-sm text-text-secondary">
          You do not have permission to view customers. Ask an administrator for the
          <span className="font-data"> customers.read </span> permission.
        </p>
      </div>
    );
  }

  const rows = list.data ?? [];
  // `undefined` tant que le total n'est pas su : le pied dira ce qu'il a chargé
  // plutôt que de rapporter les lignes rendues à un total qu'il ignore. Replié
  // sur zéro, il annonçait « 50 of 0 » — plus de lignes à l'écran que le total
  // qu'il prétendait connaître.
  const total = stats.data?.totalCustomers;
  const { pageRows, current } = pageSlice(rows, page, pageSize);
  // La colonne triée courante, dérivée du même état que le Select : les deux
  // contrôles ne peuvent pas diverger puisqu'il n'y a qu'une source.
  const sortedColumnId = Object.keys(COLUMN_SORT).find((id) => COLUMN_SORT[id] === sort) ?? null;

  return (
    <div className="flex flex-col gap-[13px]">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs text-text-muted">
        <span>Sales</span>
        <ChevronRight className="h-3 w-3 text-text-inert" aria-hidden />
        <span className="text-text-secondary">Customers</span>
      </nav>

      <PageHeader
        title="Customers"
        subtitle="Relationships, loyalty and account balances — the base the shop sells to."
        actions={
          <>
            {canManageCats && (
              <Link to="/backoffice/customers/categories" className={TOOLBAR_BTN_SECONDARY}>
                <Tag className={TOOLBAR_ICON} aria-hidden /> Categories
              </Link>
            )}
            <button type="button" className={TOOLBAR_BTN_SECONDARY} onClick={handleTemplate} aria-label="Download customers template">
              <FileText className={TOOLBAR_ICON} aria-hidden /> Template
            </button>
            {canCreate && (
              <button type="button" className={TOOLBAR_BTN_SECONDARY} onClick={() => setImporting(true)} aria-label="Import customers">
                <Upload className={TOOLBAR_ICON} aria-hidden /> Import
              </button>
            )}
            <button
              type="button"
              className={TOOLBAR_BTN_SECONDARY}
              onClick={() => void handleExport()}
              disabled={exportMut.isPending}
              aria-label="Export customers"
            >
              <Download className={TOOLBAR_ICON} aria-hidden /> {exportMut.isPending ? 'Exporting…' : 'Export'}
            </button>
            {canCreate && (
              <button type="button" onClick={() => setCreating(true)} className={TOOLBAR_BTN_PRIMARY}>
                <Plus className="h-3.5 w-3.5" aria-hidden /> New Customer
              </button>
            )}
          </>
        }
      />

      {/* L'échec des compteurs était MUET : la bande retombait à quatre zéros
          sans qu'aucun pixel ne dise que la requête avait échoué. Le bandeau
          surplombe la bande, il ne remplace rien — la liste, elle, a chargé. */}
      {stats.isError && (
        <QueryErrorBanner
          onRetry={() => { void stats.refetch(); }}
          data-testid="customers-counters-error"
        >
          Customer counts could not be loaded — the strip shows dashes rather
          than numbers that would be wrong.
        </QueryErrorBanner>
      )}

      <ListCounterStrip
        counters={counters}
        ariaLabel="Customer base overview"
        data-testid="customers-counters"
      />

      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="cust-search" className="sr-only">Search customers</label>
        <Input
          id="cust-search"
          type="search"
          value={search}
          onChange={(e) => applySearch(e.target.value)}
          placeholder="Search by name, email or phone"
          maxLength={64}
          className="w-full max-w-xs"
        />
        <label htmlFor="cust-category" className="sr-only">Category</label>
        <Select
          id="cust-category"
          value={categoryId ?? ''}
          onChange={(e) => applyCategory(e.target.value === '' ? null : e.target.value)}
          disabled={cats.isLoading}
          className="w-44"
        >
          <option value="">All categories</option>
          {(cats.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </Select>
        <label htmlFor="cust-tier" className="sr-only">Loyalty tier</label>
        <Select
          id="cust-tier"
          value={tier}
          onChange={(e) => applyTier(e.target.value as CustomersTier)}
          className="w-36"
        >
          {TIER_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </Select>
        <label htmlFor="cust-sort" className="sr-only">Sort</label>
        <Select
          id="cust-sort"
          value={sort}
          onChange={(e) => applySort(e.target.value as CustomersSort)}
          className="w-44"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </Select>
      </div>

      {list.error !== null && list.error !== undefined ? (
        <p role="alert" className="rounded-md border border-red bg-red-soft p-4 text-sm text-red-as-text">
          Customers could not be loaded. The list may be out of date.{' '}
          <button type="button" className="underline" onClick={() => { void list.refetch(); }}>
            Try again
          </button>
        </p>
      ) : (
        <DataTable
          columns={columns}
          rows={pageRows}
          getRowKey={(r) => r.id}
          isLoading={list.isLoading}
          density="compact"
          onRowClick={(row) => { void navigate(`/backoffice/customers/${row.id}`); }}
          emptyTitle="No customers match"
          emptyDescription="Adjust the filters above, or record your first customer."
          data-testid="customers-table"
          sort={sortedColumnId === null
            ? null
            : { columnId: sortedColumnId, direction: SORT_DIRECTION[sort] }}
          onSortChange={(next) => {
            const key = COLUMN_SORT[next.columnId];
            // La direction vient du serveur, pas du clic : on ne retient que la
            // colonne. Cliquer deux fois ne « renverse » donc rien — ce serait
            // une promesse que la requête ne tient pas.
            if (key !== undefined) applySort(key);
          }}
          footer={
            <ListPagination
              total={rows.length}
              page={current}
              pageSize={pageSize}
              onPage={setPage}
              onPageSize={(next) => { setPageSize(next); setPage(1); }}
              leading={
                <span className="font-data text-xs tabular-nums text-text-muted">
                  {/* Même geste que le pied des commandes : sans total connu,
                      on compte ce qui est CHARGÉ, on ne le rapporte pas à un
                      tout qu'on ignore. */}
                  {total === undefined
                    ? `${rows.length} loaded`
                    : `${rows.length} of ${total.toLocaleString('id-ID')}`}
                </span>
              }
            />
          }
        />
      )}

      <CustomerFormModal
        open={creating}
        mode="create"
        onClose={() => setCreating(false)}
      />
      <ImportEntityModal
        open={importing}
        onClose={() => setImporting(false)}
        def={customersImportDef}
        title="Import customers"
        description="Upload a filled .xlsx template. New customers are created; duplicates (by phone or email) are flagged before any writes."
      />
    </div>
  );
}
