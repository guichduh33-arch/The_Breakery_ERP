// apps/backoffice/src/pages/customers/CustomersListPage.tsx
//
// Liste des clients — instance de l'archétype LIST.
//
// Ce que la refonte change, et pourquoi :
//   · Les tuiles KPI à icônes cèdent à la bande de compteurs de l'archétype
//     (`ListCounterStrip`). Ici les compteurs sont INFORMATIFS et non
//     cliquables : aucun filtre serveur ne correspond à « actif ce mois » ou
//     « encours B2B », et un compteur qui ne filtre pas ne doit pas se
//     présenter comme un contrôle. Les compteurs viennent d'une RPC dédiée
//     (`useCustomersStats`), pas des lignes rendues : ils restent donc justes
//     alors même que la requête de liste est bornée (`CUSTOMERS_FETCH_CAP`) —
//     ce n'est pas le cas paginé des commandes (ADR-025).
//   · La recherche héroïque cartée et les filtres en cartes cèdent à une
//     rangée de contrôles plats de 34 px.
//   · Le `DataTable` passe en densité compacte avec un pied TOUJOURS rendu
//     (« N of M ») ; les colonnes chiffrées rendent en mono tabulaire.
//   · Les actions du bandeau rejoignent la famille des boutons de barre
//     (32 px) — elles mélangeaient deux familles de hauteurs.
//   · L'état de liste — recherche, catégorie, palier, tri, page, taille de
//     page — vit dans l'URL : le retour depuis une fiche client rend la liste
//     qu'on regardait (audit Sales 2026-11-21). Une valeur inconnue de l'URL
//     retombe sur le défaut.
//   · L'export est soumis à `reports.export`, comme celui des commandes.

import { Link, useNavigate } from 'react-router-dom';
import { useEffect, useMemo, useState, type JSX } from 'react';
import { Download, FileText, Plus, Tag, Upload } from 'lucide-react';
import { Input, Select, useDebouncedValue } from '@breakery/ui';
import { DataTable } from '@/components/BackofficeUi.js';
import { formatCurrency } from '@breakery/utils';
import { PageHeader } from '@/components/PageHeader.js';
import { Breadcrumb } from '@/components/Breadcrumb.js';
import { useListParams } from '@/hooks/useListParams.js';
import { ListCounterStrip, type ListCounter } from '@/components/ListCounterStrip.js';
import { QueryErrorBanner } from '@/components/QueryErrorBanner.js';
import { LIST_PAGE_SIZES, ListPagination, pageSlice } from '@/components/ListPagination.js';
import { TOOLBAR_BTN_PRIMARY, TOOLBAR_BTN_SECONDARY, TOOLBAR_ICON } from '@/components/toolbarButton.js';
import { FOCUS_RING } from '@/components/focusRing.js';
import { useAuthStore } from '@/stores/authStore.js';
import {
  useCustomersList,
  CUSTOMERS_FETCH_CAP,
  type CustomersTier,
  type CustomersSort,
} from '@/features/customers/hooks/useCustomersList.js';
import {
  COLUMN_SORT,
  CUSTOMERS_LIST_COLUMNS as columns,
  SORT_DIRECTION,
} from '@/features/customers/customersListColumns.js';
import { useCustomerCategories } from '@/features/customers/hooks/useCustomerCategories.js';
import { useCustomersStats } from '@/features/customers/hooks/useCustomersStats.js';
import { CustomerFormModal } from '@/features/loyalty/components/CustomerFormModal.js';
import { toast } from 'sonner';
import { ImportEntityModal } from '@/features/data-import/components/ImportEntityModal.js';
// `buildEntityWorkbook` tire `xlsx` (159 Ko gzip). En import STATIQUE, ce poids
// partait dans le chargement de la liste alors qu'il ne sert qu'au clic sur
// « Template » ou « Export ». Import dynamique DANS le handler — patron de
// `ProductsImportExportPage`.
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

const CUSTOMERS_PAGE_SIZE_DEFAULT = 50;

const TIERS = new Set<string>(TIER_OPTIONS.map((o) => o.value));
const SORTS = new Set<string>(SORT_OPTIONS.map((o) => o.value));
// Un id de catégorie est un UUID : tout autre texte de l'URL est ignoré avant
// d'atteindre la requête.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readPositiveInt(raw: string | null, fallback: number): number {
  const n = raw === null ? NaN : Number.parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

// Le cran du Command Palette et des écritures comptables — le dépôt n'en a
// qu'un.
const SEARCH_DEBOUNCE_MS = 250;

export default function CustomersListPage(): JSX.Element {
  const navigate      = useNavigate();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canRead       = hasPermission('customers.read');
  const canCreate     = hasPermission('customers.create');
  const canManageCats = hasPermission('customer_categories.read');
  const canExport     = hasPermission('reports.export');

  // ── État de liste, lu de l'URL et borné ────────────────────────────────────
  const [params, patchParams] = useListParams();
  const urlSearch   = params.get('q') ?? '';
  const categoryRaw = params.get('category');
  const categoryId  = categoryRaw !== null && UUID.test(categoryRaw) ? categoryRaw : null;
  const tierRaw     = params.get('tier') ?? '';
  const tier        = (TIERS.has(tierRaw) ? tierRaw : 'all') as CustomersTier;
  const sortRaw     = params.get('sort') ?? '';
  const sort        = (SORTS.has(sortRaw) ? sortRaw : 'last_visit') as CustomersSort;
  // Pagination CLIENT : le hook charge d'un coup la tête du classement, dans la
  // limite de `CUSTOMERS_FETCH_CAP` lignes ; le pied ne fait que découper — et
  // dit quand la borne est touchée. Une page hors bornes se ramène à la
  // dernière page réelle (`pageSlice`).
  const page        = readPositiveInt(params.get('page'), 1);
  const sizeRaw     = readPositiveInt(params.get('size'), CUSTOMERS_PAGE_SIZE_DEFAULT);
  const pageSize    = (LIST_PAGE_SIZES as readonly number[]).includes(sizeRaw) ? sizeRaw : CUSTOMERS_PAGE_SIZE_DEFAULT;

  const [creating,   setCreating  ] = useState<boolean>(false);
  const [importing,  setImporting ] = useState<boolean>(false);
  const exportMut = useCustomersExport();

  // Tout changement de filtre ou de tri ramène en page 1, dans UN patch (le
  // filtre ET la page) : rester en page 7 d'un résultat qui n'en compte plus
  // que 2 afficherait une table vide qu'on croirait cassée. Une valeur par
  // défaut sort de l'URL, qui reste propre.
  function applyCategory(next: string | null): void { patchParams({ category: next, page: null }); }
  function applyTier(next: CustomersTier): void { patchParams({ tier: next === 'all' ? null : next, page: null }); }
  function applySort(next: CustomersSort): void { patchParams({ sort: next === 'last_visit' ? null : next, page: null }); }

  // La saisie vit en local ; seule la valeur POSÉE atteint l'URL et les
  // filtres. Poussée à la frappe, elle changeait la `queryKey` à chaque
  // caractère et lançait donc une requête PostgREST par touche — « Bali
  // Organic » en émettait treize.
  const [search, setSearch] = useState<string>(urlSearch);
  const debouncedSearch = useDebouncedValue(search, SEARCH_DEBOUNCE_MS);
  useEffect(() => {
    if (debouncedSearch !== urlSearch) patchParams({ q: debouncedSearch, page: null });
    // `urlSearch` exclu à dessein : seul le geste de saisie écrit l'URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, patchParams]);
  // Retour arrière, lien collé : l'URL a changé sans saisie, le champ suit.
  useEffect(() => { setSearch(urlSearch); }, [urlSearch]);

  const cats  = useCustomerCategories();
  // Une catégorie de l'URL qui n'existe plus est ignorée dès que la liste des
  // catégories est connue — sinon le filtre serveur rendrait une table vide.
  const knownCategory = categoryId !== null && cats.data !== undefined
    && !cats.data.some((c) => c.id === categoryId) ? null : categoryId;

  // La requête lit l'URL, pas le brouillon : l'URL EST l'état de liste.
  const filters = useMemo(
    () => ({
      ...(urlSearch !== '' ? { search: urlSearch } : {}),
      categoryId: knownCategory,
      tier,
      sort,
    }),
    [urlSearch, knownCategory, tier, sort],
  );

  const list  = useCustomersList(filters);
  const stats = useCustomersStats();

  async function handleTemplate(): Promise<void> {
    const { buildTemplateWorkbook, downloadWorkbook } = await import(
      '@/features/data-import/buildEntityWorkbook.js'
    );
    downloadWorkbook(buildTemplateWorkbook(customersImportDef), 'breakery-customers-template.xlsx');
  }
  async function handleExport(): Promise<void> {
    try {
      const rows = await exportMut.mutateAsync();
      const { buildExportWorkbook, downloadWorkbook } = await import(
        '@/features/data-import/buildEntityWorkbook.js'
      );
      downloadWorkbook(
        buildExportWorkbook(customersImportDef, rows),
        `breakery-customers-export-${new Date().toISOString().slice(0, 10)}.xlsx`,
      );
    } catch (e) {
      toast.error(`Export failed: ${(e as Error).message}`);
    }
  }

  // La requête des compteurs est tombée. Une seule source pour la bande, le
  // bandeau et le pied : sans elle, les trois divergent.
  const statsDown = stats.isError;

  // Compteurs informatifs — pas de `onSelect` : aucun filtre serveur ne leur
  // correspond, la bande annonce l'état de la base clients, elle ne filtre pas.
  //
  // Tant que le compte n'est pas SU, la bande rend un tiret cadratin grisé
  // plutôt qu'un zéro. « 0 client » et « je ne sais pas encore » ne se
  // ressemblent pas. Même règle que les compteurs du catalogue
  // (`features/products/counters.ts`) et que ceux des commandes. Les infobulles
  // suivent : chiffrées quand le compte est su, réduites à leur définition
  // sinon — « 0% of the customer base » était le même mensonge en plus petit.
  //
  // « Su » exige les DEUX conditions : des données présentes ET une requête qui
  // n'est pas en échec. Tester `stats.data === undefined` seul ne suffit pas —
  // React Query conserve la dernière réponse réussie quand un refetch échoue,
  // si bien que la bande aurait affiché quatre chiffres pendant que le bandeau
  // juste au-dessus annonçait qu'elle affichait des tirets. Un correctif
  // d'honnêteté qui décrit un écran inexistant est le défaut qu'il prétend
  // corriger.
  const counters = useMemo<ListCounter[]>(() => {
    const s = statsDown ? undefined : stats.data;
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
  }, [stats.data, statsDown]);


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

  const rows = list.data?.rows ?? [];
  // `undefined` tant que le total n'est pas su : le pied dira ce qu'il a chargé
  // plutôt que de rapporter les lignes rendues à un total qu'il ignore. Replié
  // sur zéro, il annonçait « 50 of 0 » — plus de lignes à l'écran que le total
  // qu'il prétendait connaître.
  const total = statsDown ? undefined : stats.data?.totalCustomers;
  const { pageRows, current } = pageSlice(rows, page, pageSize);
  // La requête est bornée (`CUSTOMERS_FETCH_CAP`). Quand la borne est touchée,
  // le pied cesse de rapporter les lignes chargées à un total : « 500 of 1,832 »
  // se lirait comme une pagination complète alors que les 1 332 autres ne sont
  // NULLE PART dans la table. Il annonce alors la troncature et ce qui la lève.
  //
  // Le verdict vient du HOOK (qui demande CAP+1 lignes) et non d'un
  // `rows.length >= CAP` : un jeu filtré de PILE 500 clients est complet, et la
  // comparaison le déclarait tronqué — le pied refusait un total qu'il savait.
  const capped = list.data?.capped ?? false;
  let footerLabel: string;
  if (capped) {
    footerLabel = `First ${CUSTOMERS_FETCH_CAP.toLocaleString('id-ID')} loaded — refine the filters to see the rest`;
  } else if (total === undefined) {
    // Même geste que le pied des commandes : sans total connu, on compte ce qui
    // est CHARGÉ, on ne le rapporte pas à un tout qu'on ignore.
    footerLabel = `${rows.length} loaded`;
  } else {
    footerLabel = `${rows.length} of ${total.toLocaleString('id-ID')}`;
  }
  // La colonne triée courante, dérivée du même état que le Select : les deux
  // contrôles ne peuvent pas diverger puisqu'il n'y a qu'une source.
  const sortedColumnId = Object.keys(COLUMN_SORT).find((id) => COLUMN_SORT[id] === sort) ?? null;

  return (
    <div className="flex flex-col gap-[13px]">
      <Breadcrumb items={[{ label: 'Sales' }, { label: 'Customers' }]} />

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
            <button type="button" className={TOOLBAR_BTN_SECONDARY} onClick={() => void handleTemplate()} aria-label="Download customers template">
              <FileText className={TOOLBAR_ICON} aria-hidden /> Template
            </button>
            {canCreate && (
              <button type="button" className={TOOLBAR_BTN_SECONDARY} onClick={() => setImporting(true)} aria-label="Import customers">
                <Upload className={TOOLBAR_ICON} aria-hidden /> Import
              </button>
            )}
            {canExport && (
              <button
                type="button"
                className={TOOLBAR_BTN_SECONDARY}
                onClick={() => void handleExport()}
                disabled={exportMut.isPending}
                aria-label="Export customers"
              >
                <Download className={TOOLBAR_ICON} aria-hidden /> {exportMut.isPending ? 'Exporting…' : 'Export'}
              </button>
            )}
            {canCreate && (
              <button type="button" onClick={() => setCreating(true)} className={TOOLBAR_BTN_PRIMARY}>
                <Plus className="h-3.5 w-3.5" aria-hidden /> New customer
              </button>
            )}
          </>
        }
      />

      {/* L'échec des compteurs était MUET : la bande retombait à quatre zéros
          sans qu'aucun pixel ne dise que la requête avait échoué. Le bandeau
          surplombe la bande, il ne remplace rien — la liste, elle, a chargé. */}
      {statsDown && (
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
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, email or phone"
          maxLength={64}
          className="w-full max-w-xs"
        />
        <label htmlFor="cust-category" className="sr-only">Category</label>
        <Select
          id="cust-category"
          value={knownCategory ?? ''}
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
          onChange={(e) => applyTier((TIERS.has(e.target.value) ? e.target.value : 'all') as CustomersTier)}
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
          onChange={(e) => applySort((SORTS.has(e.target.value) ? e.target.value : 'last_visit') as CustomersSort)}
          className="w-44"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </Select>
      </div>

      {list.isError ? (
        <p role="alert" className="rounded-md border border-red bg-bg-elevated p-4 text-sm text-red-as-text">
          Customers could not be loaded. The list may be out of date.{' '}
          <button type="button" className={`rounded-sm underline ${FOCUS_RING}`} onClick={() => { void list.refetch(); }}>
            Try again
          </button>
        </p>
      ) : (
        <DataTable
          caption="Customer, category, loyalty tier, B2B balance, points, total spent and last visit per customer"
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
              onPage={(next) => { patchParams({ page: next <= 1 ? null : String(next) }); }}
              onPageSize={(next) => {
                patchParams({ size: next === CUSTOMERS_PAGE_SIZE_DEFAULT ? null : String(next), page: null });
              }}
              leading={
                <span className="font-data text-xs tabular-nums text-text-muted">
                  {footerLabel}
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
