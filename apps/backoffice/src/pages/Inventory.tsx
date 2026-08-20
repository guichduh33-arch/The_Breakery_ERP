// apps/backoffice/src/pages/Inventory.tsx
//
// Liste de stock du back-office — instance de l'archétype LIST (ADR-024).
//
// Ce que la refonte change, et pourquoi :
//   · La bande de tuiles KPI disparaît. Trois des quatre tuiles ne répondaient
//     à aucune question — le nombre de lignes affichées se compte à l'œil, le
//     nombre de filtres actifs redit ce que l'utilisateur vient de faire — et
//     la quatrième ne comptait que la page courante. Elles cèdent la place à
//     des compteurs qui SONT les filtres (`ListCounterStrip`).
//   · Le bloc « Filters » carté disparaît : une carte bordée, un intertitre et
//     ~88 px de hauteur pour trois contrôles. Recherche et catégorie tiennent
//     dans une ligne, et le troisième contrôle — « low stock only » — est
//     devenu un compteur.
//   · La table à la main cède au `DataTable` partagé, qui apporte `scope="col"`,
//     `aria-sort`, le squelette de chargement, l'état vide et un pied TOUJOURS
//     rendu — « 0 of 318 » est une information, un pied absent n'en est pas une.
//   · Le titre passe par `PageHeader`, source unique du bandeau de titre.
//   · Les trois actions du bandeau prennent les classes de bouton de barre
//     (32 px). Elles mélangeaient auparavant deux familles de hauteurs
//     différentes dans la même rangée.

import { Plus, Truck, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Input, Select } from '@breakery/ui';
import { formatCurrency, formatQuantity, businessDateIso, todayIsoDate } from '@breakery/utils';
import { DataTable, type DataTableColumn } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore.js';
import { PageHeader } from '@/components/PageHeader.js';
import { ListCounterStrip, type ListCounter } from '@/components/ListCounterStrip.js';
import { QueryErrorBanner } from '@/components/QueryErrorBanner.js';
import { TOOLBAR_BTN_PRIMARY, TOOLBAR_BTN_SECONDARY } from '@/components/toolbarButton.js';
import { AdjustModal } from '@/features/inventory/components/AdjustModal.js';
import { WasteModal } from '@/features/inventory/components/WasteModal.js';
import { StockRowActions } from '@/features/inventory/components/StockRowActions.js';
import { MovementHistoryDrawer } from '@/features/inventory/components/MovementHistoryDrawer.js';
import { LowStockBadge } from '@/features/inventory/components/LowStockBadge.js';
import {
  useStockLevels,
  type StockBucket,
  type StockLevelRow as Row,
  type StockLevelsFilters,
  type StockSortKey,
} from '@/features/inventory/hooks/useStockLevels.js';
import { ListPagination, coercePageSize } from '@/components/ListPagination.js';
import { useStockCounters, type StockCounters } from '@/features/inventory/hooks/useStockCounters.js';
import { useInventoryReferenceData } from '@/features/inventory/hooks/useInventoryReferenceData.js';

const PAGE_SIZE = 50;

// Colonne affichée → clé de l'allowlist serveur de `get_stock_levels_v4`. Le
// tri est SERVEUR : la page ne tient que 50 lignes sur plusieurs milliers, un
// tri client ne trierait que la tranche déjà à l'écran et mentirait.
// Les colonnes absentes de cet objet ne sont pas triables — `actions` n'a rien
// à trier, et `min` est une clé serveur sans colonne dans cette table.
const SORT_KEYS: Record<string, StockSortKey> = {
  sku:      'sku',
  name:     'name',
  category: 'category',
  onhand:   'stock',
  value:    'value',
  moved:    'last_movement',
};

// Pas de hook de debounce partagé dans ce dépôt — l'idiome maison est une
// minuterie référencée, portée par l'appelant (voir `AuditLogFilters`, et le
// commentaire d'en-tête de `useIngredientSearch` : « debouncing is the caller's
// concern »). 250 ms : au-dessus, la liste traîne derrière la frappe ; en
// dessous, « croissant » coûte encore une requête par lettre.
const SEARCH_DEBOUNCE_MS = 250;

type ModalState =
  | { kind: 'none' }
  | { kind: 'adjust';  product?: Row }
  | { kind: 'waste';   product?: Row };

interface BucketSpec {
  label:  string;
  tone?:  'warning' | 'danger';
  title?: string;
  count:  (c: StockCounters) => number;
}

// `Record<StockBucket, …>` et non un tableau de littéraux : le type vient de
// l'enum Postgres via la régénération de types, donc ajouter un panier en base
// CASSE LE BUILD ici tant que l'interface ne le traite pas. Un tableau écrit à
// la main aurait laissé passer l'oubli en silence — c'est exactement la classe
// de dérive que la règle d'énumération du projet vise.
const BUCKETS: Record<StockBucket, BucketSpec> = {
  all: {
    label: 'All products',
    count: (c) => c.total_count,
  },
  low: {
    label: 'Low stock',
    tone:  'warning',
    title: 'Below the configured minimum. Includes products at zero or negative — this is the full reorder list, so the counters do not add up to the total.',
    count: (c) => c.low_count,
  },
  zero: {
    label: 'At zero',
    tone:  'danger',
    title: 'Out of stock right now. A product with no minimum configured never shows under Low stock, so this is the only place it surfaces.',
    count: (c) => c.zero_count,
  },
  negative: {
    label: 'Negative',
    tone:  'danger',
    title: 'Stock below zero — a sale was recorded before its receipt. Investigate rather than adjust blindly.',
    count: (c) => c.negative_count,
  },
  untracked: {
    label: 'Not tracked',
    title: 'Products sold without stock deduction. They have no stock level and never appear in the other buckets.',
    count: (c) => c.untracked_count,
  },
};

/** Ordre d'affichage — celui de la déclaration ci-dessus, jamais recopié. */
const BUCKET_ORDER = Object.keys(BUCKETS) as StockBucket[];

// Comparaison en JOURS DE CALENDRIER métier, pas en tranches glissantes de
// 24 h. L'ancien calcul dérivait « today » d'un delta de millisecondes : un
// mouvement d'hier 23 h s'affichait « today » tant qu'on regardait avant 23 h
// le lendemain. Ce n'était pas un défaut de fuseau — c'était une confusion
// entre 24 heures écoulées et un changement de journée de travail, sur un ERP
// dont le jour métier est une constante de déploiement (ADR-019).
function formatLastMovement(iso: string | null): string {
  if (iso === null) return '—';
  // Deux dates de calendrier lues à minuit UTC : la différence est exacte, sans
  // heure d'été ni arrondi.
  const movedMs = Date.parse(`${businessDateIso(iso)}T00:00:00Z`);
  const todayMs = Date.parse(`${todayIsoDate()}T00:00:00Z`);
  const days = Math.round((todayMs - movedMs) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

export default function InventoryPage() {
  const navigate = useNavigate();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canRead    = hasPermission('inventory.read');
  const canAdjust  = hasPermission('inventory.adjust');
  // Q3 (audit 2026-07-27) : receive_stock_v1 droppée — la réception valorisée
  // passe par le flux achat compté (/inventory/incoming, gate purchasing.po.create).
  const canReceive = hasPermission('purchasing.po.create');
  const canWaste   = hasPermission('inventory.waste');

  // TOUT l'état de liste vit dans l'URL : un filtre se partage par lien, survit
  // à un rechargement, et le retour arrière depuis une fiche produit ramène la
  // liste telle qu'on l'avait laissée. Il vivait en `useState`, donc revenir en
  // arrière rendait la page 1 non filtrée.
  //
  // Les écritures passent par `patchParams` et non par plusieurs `useUrlState` :
  // `setSearchParams` reçoit les paramètres COURANTS, donc deux appels dans le
  // même geste s'écrasent l'un l'autre — et changer un filtre doit écrire le
  // filtre ET remettre la page à zéro d'un seul mouvement. Même motif que
  // `Products.tsx`, qui documente le défaut.
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

  const [modal, setModal] = useState<ModalState>({ kind: 'none' });
  // Le journal d'un produit s'ouvre en tiroir, PAS dans l'URL : c'est une
  // consultation, pas un état de liste. Le partager par lien n'aurait pas de
  // sens, et l'empiler dans l'historique casserait le retour arrière que le
  // lot précédent vient de rendre fiable.
  const [movementsFor, setMovementsFor] = useState<Row | undefined>(undefined);

  // Un paramètre d'URL est saisi par n'importe qui. `?bucket=lol` ne doit pas
  // produire une liste vide en silence — même défaut que le panier NULL gardé
  // côté SQL. On retombe sur le défaut, sans rien casser.
  const bucketParam   = params.get('bucket') ?? 'all';
  const bucket: StockBucket = Object.hasOwn(BUCKETS, bucketParam)
    ? (bucketParam as StockBucket)
    : 'all';
  const appliedSearch = params.get('q') ?? '';
  const categoryId    = params.get('category') ?? '';
  const parsedPage    = Number.parseInt(params.get('page') ?? '0', 10);
  const page = Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 0;
  // Le sélecteur « Rows » pilote le `p_limit` de la RPC. Le défaut de cette
  // liste reste 50 — même borne qu'avant la refonte du pied.
  const pageSize      = coercePageSize(params.get('rows') ?? PAGE_SIZE);

  // Tri : même discipline que les filtres — il vit dans l'URL, donc il se
  // partage par lien et survit au retour arrière. Un `?sort=` inconnu retombe
  // sur l'ordre historique plutôt que de partir tel quel vers la RPC.
  const sortParam = params.get('sort') ?? '';
  const sortCol   = Object.hasOwn(SORT_KEYS, sortParam) ? sortParam : null;
  const sortDir: 'asc' | 'desc' = params.get('dir') === 'desc' ? 'desc' : 'asc';

  function setCategoryId(next: string): void { patchParams({ category: next, page: null }); }

  // `search` est ce que l'utilisateur voit dans le champ, à la frappe près ;
  // `appliedSearch` est ce qui part au serveur et dans l'URL.
  const [search, setSearch] = useState<string>(appliedSearch);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (searchTimer.current !== null) clearTimeout(searchTimer.current);
  }, []);

  // Suit l'URL quand elle change SANS passer par le champ : retour arrière,
  // lien collé, rechargement. Quand c'est la frappe qui a poussé la valeur,
  // les deux sont déjà égales et l'effet ne fait rien.
  useEffect(() => { setSearch(appliedSearch); }, [appliedSearch]);

  function setPage(next: number): void {
    patchParams({ page: next <= 0 ? null : String(next) });
  }

  // Changer la taille de page invalide le numéro de page : la ligne du haut de
  // la page 7 à 50 lignes n'est pas celle de la page 7 à 100.
  function setPageSize(next: number): void {
    patchParams({ rows: next === PAGE_SIZE ? null : String(next), page: null });
  }

  // Un tri renvoie en tête de liste : rester à l'offset 400 d'un ordre qui
  // vient de changer montre une tranche arbitraire du nouveau classement.
  function setSort(columnId: string, direction: 'asc' | 'desc'): void {
    patchParams({
      sort: columnId,
      dir:  direction === 'asc' ? null : 'desc',
      page: null,
    });
  }

  function onSearchChange(next: string): void {
    setSearch(next);
    if (searchTimer.current !== null) clearTimeout(searchTimer.current);
    // La recherche et la remise à zéro de la page partent ENSEMBLE, au bout du
    // debounce : les écrire séparément les ferait s'écraser.
    searchTimer.current = setTimeout(() => { patchParams({ q: next, page: null }); }, SEARCH_DEBOUNCE_MS);
  }

  const filters = useMemo<StockLevelsFilters>(
    () => ({
      ...(appliedSearch !== '' ? { search: appliedSearch } : {}),
      ...(categoryId    !== '' ? { categoryId }            : {}),
      bucket,
      limit:  pageSize,
      offset: page * pageSize,
      // `sortCol` a déjà passé le `Object.hasOwn` ci-dessus : la clé existe.
      ...(sortCol !== null
        ? { sort: { key: SORT_KEYS[sortCol]!, dir: sortDir } }
        : {}),
    }),
    [appliedSearch, categoryId, bucket, page, pageSize, sortCol, sortDir],
  );

  // ADR-024 déc. 2 — les compteurs suivent la recherche et la catégorie, JAMAIS
  // le panier actif : sinon la bande n'annoncerait que le panier sélectionné et
  // cesserait d'être un moyen d'en changer.
  const counterFilters = useMemo(
    () => ({
      ...(appliedSearch !== '' ? { search: appliedSearch } : {}),
      ...(categoryId    !== '' ? { categoryId }            : {}),
    }),
    [appliedSearch, categoryId],
  );

  const list     = useStockLevels(filters);
  const counters = useStockCounters(counterFilters);
  const refData  = useInventoryReferenceData();

  const c = counters.data;
  const pageRows = useMemo(() => list.data ?? [], [list.data]);

  // Les compteurs sont tombés. `keepPreviousData` peut laisser `c` garni d'une
  // réponse précédente : on ne la rend pas pour autant, le serveur vient de
  // refuser de la confirmer. Même règle que la bande des commandes.
  const countersDown = counters.isError;

  /**
   * Total du panier affiché — c'est lui que le pied et la pagination comptent.
   * `undefined` tant qu'il n'est pas SU : au premier chargement comme sur
   * échec. Le `0` d'avant faisait dire « of 0 » à un pied qui surplombait
   * cinquante lignes, et posait cinq zéros dans la bande à l'instant précis où
   * la zone `sr-only` annonçait « Loading stock counts ».
   */
  const activeTotal = c === undefined || countersDown
    ? undefined
    : BUCKETS[bucket].count(c);

  function pick(next: StockBucket): void {
    patchParams({ bucket: next === 'all' ? null : next, page: null });
  }

  const counterItems = useMemo<ListCounter[]>(
    () => BUCKET_ORDER.map((id) => {
      const spec = BUCKETS[id];
      const value = c === undefined || countersDown ? undefined : spec.count(c);
      return {
        id,
        label: spec.label,
        // Un compte qu'on ne sait pas rend un tiret cadratin grisé, jamais un
        // zéro : « aucun produit à zéro » et « je ne sais pas encore combien »
        // sont deux états opposés, et c'est le second qui appelle un coup
        // d'œil. Motif de `features/products/counters.ts`.
        ...(value === undefined ? { value: '—', muted: true } : { value }),
        // Le ton d'alerte suit la valeur : pas de rouge sur un tiret.
        ...(spec.tone !== undefined && value !== undefined && value > 0 ? { tone: spec.tone } : {}),
        ...(spec.title !== undefined ? { title: spec.title } : {}),
        onSelect: () => { pick(id); },
      };
    }),
    // `pick` est stable en pratique (setters d'URL mémoïsés) ; la bande ne
    // dépend que des compteurs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [c, countersDown],
  );

  const columns = useMemo<readonly DataTableColumn<Row>[]>(() => [
    {
      id: 'sku', header: 'SKU', width: '7rem', sortable: true,
      render: (r) => <span className="font-data text-xs text-text-secondary">{r.sku}</span>,
    },
    {
      id: 'name', header: 'Product', sortable: true,
      // Un vrai lien, et non un `<td role="button">` : celui-ci écrasait la
      // sémantique de cellule (chaque ligne annonçait une colonne de moins) et
      // interdisait l'ouverture dans un nouvel onglet.
      render: (r) => (
        <span className="flex items-center">
          <a
            href={`/backoffice/inventory/${r.product_id}`}
            onClick={(e) => { e.preventDefault(); void navigate(`/backoffice/inventory/${r.product_id}`); }}
            className="text-gold hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
          >
            {r.name}
          </a>
          {r.track_inventory && (
            <LowStockBadge currentStock={r.current_stock} minStockThreshold={r.min_stock_threshold} />
          )}
        </span>
      ),
    },
    {
      id: 'category', header: 'Category', width: '9rem', sortable: true,
      render: (r) => <span className="text-text-secondary">{r.category_name ?? '—'}</span>,
    },
    {
      id: 'onhand', header: 'On hand', align: 'right', width: '9rem', sortable: true,
      render: (r) => (
        r.track_inventory
          ? (
            <span className="font-data tabular-nums">{formatQuantity(r.current_stock, r.unit)}</span>
          )
          : <span className="text-text-muted">Not tracked</span>
      ),
    },
    {
      id: 'value', header: 'Value at cost', align: 'right', width: '10rem', sortable: true,
      render: (r) => (
        r.track_inventory
          ? <span className="font-data tabular-nums">{formatCurrency(r.stock_value)}</span>
          : <span className="text-text-muted">—</span>
      ),
    },
    {
      id: 'moved', header: 'Last movement', headerClassName: 'whitespace-nowrap', width: '9rem', sortable: true,
      render: (r) => <span className="text-text-secondary">{formatLastMovement(r.last_movement_at)}</span>,
    },
    {
      id: 'actions', header: <span className="sr-only">Row actions</span>, align: 'right', width: '4rem',
      render: (r) => (
        <StockRowActions
          row={r}
          canAdjust={canAdjust}
          canWaste={canWaste}
          onView={(x) => { void navigate(`/backoffice/inventory/${x.product_id}`); }}
          onMovements={(x) => setMovementsFor(x)}
          onAdjust={(x) => setModal({ kind: 'adjust', product: x })}
          onWaste={(x) => setModal({ kind: 'waste', product: x })}
        />
      ),
    },
  ], [canAdjust, canWaste, navigate]);

  if (!canRead) {
    return (
      <div className="flex flex-col gap-[13px]">
        <PageHeader title="Stock &amp; Inventory" />
        <p role="status" className="rounded-md border border-border-subtle bg-bg-elevated p-4 text-sm text-text-secondary">
          You do not have permission to view inventory. Ask an administrator for the
          <span className="font-data"> inventory.read </span> permission.
        </p>
      </div>
    );
  }

  function closeModal(): void { setModal({ kind: 'none' }); }

  return (
    <div className="flex flex-col gap-[13px]">
      <PageHeader
        title="Stock &amp; Inventory"
        subtitle="Every product that carries a stock level, worst first. Corrections are recorded as new movements — nothing here is edited in place."
        actions={
          <>
            {canAdjust && (
              <button type="button" className={TOOLBAR_BTN_SECONDARY} onClick={() => setModal({ kind: 'adjust' })}>
                <Plus className="h-3.5 w-3.5" aria-hidden /> Adjust
              </button>
            )}
            {canWaste && (
              <button type="button" className={`${TOOLBAR_BTN_SECONDARY} text-red-as-text`} onClick={() => setModal({ kind: 'waste' })}>
                <Trash2 className="h-3.5 w-3.5" aria-hidden /> Waste
              </button>
            )}
            {canReceive && (
              <button
                type="button"
                className={TOOLBAR_BTN_PRIMARY}
                onClick={() => { void navigate('/backoffice/inventory/incoming'); }}
              >
                <Truck className="h-3.5 w-3.5" aria-hidden /> Receive
              </button>
            )}
          </>
        }
      />

      {/* L'échec des compteurs n'était rendu NULLE PART : le bandeau existant
          ne couvre que la liste. La bande retombait à des zéros sans qu'aucun
          pixel ne dise que la requête avait échoué. */}
      {countersDown && (
        <QueryErrorBanner
          onRetry={() => { void counters.refetch(); }}
          data-testid="stock-counters-error"
        >
          Stock counts could not be loaded — the strip shows dashes rather than
          numbers that would be wrong.
        </QueryErrorBanner>
      )}

      <ListCounterStrip
        counters={counterItems}
        activeId={bucket}
        ariaLabel="Stock filters"
        data-testid="stock-counters"
      />

      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="inv-search" className="sr-only">Search</label>
        <Input
          id="inv-search"
          value={search}
          onChange={(e) => { onSearchChange(e.target.value); }}
          placeholder="Search by SKU or product name"
          maxLength={64}
          className="w-full max-w-xs"
        />
        <label htmlFor="inv-category" className="sr-only">Category</label>
        <Select
          id="inv-category"
          value={categoryId}
          // `setCategoryId` remet DÉJÀ la page à zéro dans le même patch.
          // Rappeler `resetPage()` ici émettait un second patch construit sur
          // les paramètres d'AVANT, qui effaçait la catégorie qu'on venait
          // d'écrire — le défaut exact que `patchParams` existe pour éviter.
          onChange={(e) => { setCategoryId(e.target.value); }}
          disabled={refData.isLoading}
          className="w-48"
        >
          <option value="">All categories</option>
          {refData.data?.categories.map((cat) => (
            <option key={cat.id} value={cat.id}>{cat.name}</option>
          ))}
        </Select>
      </div>

      {/* Sans annonce, cocher un compteur fait passer la table de 318 à 14
          lignes en silence pour un lecteur d'écran. Les trois états — su, en
          cours, indisponible — s'annoncent ici comme la bande les montre :
          cette zone disait « Loading stock counts » pendant que l'œil lisait
          « 0 ». */}
      <span className="sr-only" role="status" aria-live="polite">
        {activeTotal === undefined
          ? (countersDown ? 'Stock counts unavailable' : 'Loading stock counts')
          : `${activeTotal.toLocaleString('id-ID')} ${activeTotal === 1 ? 'product' : 'products'} in the current filter`}
      </span>

      {list.error !== null ? (
        <p role="alert" className="rounded-md border border-red bg-red-soft p-4 text-sm text-red-as-text">
          Stock levels could not be loaded. The list may be out of date.{' '}
          <button type="button" className="underline" onClick={() => { void list.refetch(); }}>
            Try again
          </button>
        </p>
      ) : (
        <DataTable<Row>
          columns={columns}
          rows={pageRows}
          getRowKey={(r) => r.product_id}
          isLoading={list.isLoading}
          // Les lignes précédentes restent à l'écran pendant qu'une nouvelle
          // requête tourne (`keepPreviousData`) : on les estompe pour ne pas
          // laisser croire que le clic n'a rien fait.
          {...(list.isPlaceholderData ? { className: 'opacity-60 transition-opacity duration-fast' } : {})}
          density="compact"
          emptyTitle="No product here"
          emptyDescription={
            appliedSearch !== '' || categoryId !== '' || bucket !== 'all'
              ? 'Nothing matches this filter. Widen the search, or pick another counter above.'
              : 'No product carries a stock level yet.'
          }
          data-testid="stock-levels-table"
          sort={sortCol === null ? null : { columnId: sortCol, direction: sortDir }}
          onSortChange={(next) => { setSort(next.columnId, next.direction); }}
          footer={
            // `ListPagination` compte en pages 1-based, l'URL de cette liste en
            // offsets 0-based : la conversion vit ici, à la frontière, et nulle
            // part ailleurs.
            <ListPagination
              // Le repli à zéro ne concerne QUE la mécanique de pagination —
              // comportement d'avant, inchangé. Ce qui se LIT passe par
              // `leading` ci-dessous et ne se replie pas.
              total={activeTotal ?? 0}
              page={page + 1}
              pageSize={pageSize}
              onPage={(next) => { setPage(next - 1); }}
              onPageSize={setPageSize}
              leading={
                // Le compte RÉEL des lignes rendues, à côté de la tranche
                // théorique. Les deux divergent quand la liste revient vide sur
                // un panier que les compteurs disent peuplé — et c'est
                // précisément là qu'un pied qui annoncerait « 1–50 » mentirait.
                // Sans total su, on compte le chargé et on s'arrête là : « 50
                // of 0 » était le même mensonge dans l'autre sens.
                <span className="font-data text-xs tabular-nums text-text-muted">
                  {activeTotal === undefined
                    ? `${pageRows.length} loaded`
                    : `${pageRows.length} of ${activeTotal.toLocaleString('id-ID')}`}
                </span>
              }
            />
          }
        />
      )}

      <AdjustModal
        open={modal.kind === 'adjust'}
        {...(modal.kind === 'adjust' && modal.product !== undefined ? { initialProduct: modal.product } : {})}
        onClose={closeModal}
      />
      <WasteModal
        open={modal.kind === 'waste'}
        {...(modal.kind === 'waste' && modal.product !== undefined ? { initialProduct: modal.product } : {})}
        onClose={closeModal}
      />
      <MovementHistoryDrawer
        product={movementsFor}
        onClose={() => { setMovementsFor(undefined); }}
      />
    </div>
  );
}
