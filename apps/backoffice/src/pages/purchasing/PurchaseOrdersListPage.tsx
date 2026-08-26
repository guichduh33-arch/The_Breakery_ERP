// apps/backoffice/src/pages/purchasing/PurchaseOrdersListPage.tsx
//
// Liste des bons de commande — instance de l'archétype LIST.
//
// Ce que l'audit UX/UI change ici, et pourquoi :
//   · Les quatre tuiles de KPI et les cinq pastilles dorées disaient DEUX FOIS
//     la même chose — « 12 en attente » au-dessus, un bouton « Pending » en
//     dessous — sans que la tuile serve à rien : elle affichait le nombre que
//     la pastille permettait d'atteindre. Les deux cèdent à une seule bande de
//     compteurs (`ListCounterStrip`), où le compteur EST le filtre.
//   · Les compteurs suivent le fournisseur et la recherche, mais JAMAIS le
//     statut actif : un compteur qui se recalcule sur son propre filtre ne
//     compte plus que lui-même. C'est la règle déjà tenue par la liste des
//     commandes (ADR-025 D2).
//   · Le montant engagé par statut passe en infobulle plutôt qu'en seconde
//     bande : la bande répond à « combien de lignes vais-je voir », pas à
//     « combien ça coûte ».
//
// Reste inchangé : le DataTable thémé (lien PO, fournisseur, pastille de
// statut, dates, total) et l'import/export historique.

import { useMemo, useState, type JSX } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Download,
  FileText,
  Package,
  Plus,
  Search,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  Badge,
  Button,
  DataTable,
  type DataTableColumn,
} from '@breakery/ui';
import { ImportEntityModal } from '@/features/data-import/components/ImportEntityModal.js';
// `buildEntityWorkbook` tire `xlsx` (159 Ko gzip) : chargé à la demande dans les
// deux handlers, pas à l'ouverture de la liste.
import { purchasesImportDef } from '@/features/purchasing/import/purchasesImportDef.js';
import { useHistoricalPurchasesExport } from '@/features/purchasing/hooks/useHistoricalPurchasesExport.js';
import { formatCurrency, formatDate } from '@breakery/utils';
import { useAuthStore } from '@/stores/authStore.js';
import {
  usePurchaseOrdersList,
  type POStatus,
  type PurchaseOrderListRow,
  type PurchaseOrdersFilters,
} from '@/features/purchasing/hooks/usePurchaseOrdersList.js';
import { POStatusBadge } from '@/features/purchasing/components/POStatusBadge.js';
import { useSuppliersList } from '@/features/suppliers/hooks/useSuppliersList.js';
import {
  TOOLBAR_BTN_PRIMARY,
  TOOLBAR_BTN_SECONDARY,
  TOOLBAR_ICON,
} from '@/components/toolbarButton.js';
import { ListCounterStrip, type ListCounter } from '@/components/ListCounterStrip.js';
import { PageHeader } from '@/components/PageHeader.js';
import { FOCUS_RING } from '@/components/focusRing.js';

type POFilterKey = POStatus | 'all';

interface POBucket { count: number; amount: number }

/** Un seau par statut filtrable, plus le total. Les clés sont celles du filtre. */
type POBuckets = Record<POFilterKey, POBucket>;

function aggregate(rows: readonly PurchaseOrderListRow[]): POBuckets {
  const acc: POBuckets = {
    all:       { count: rows.length, amount: 0 },
    pending:   { count: 0, amount: 0 },
    partial:   { count: 0, amount: 0 },
    received:  { count: 0, amount: 0 },
    cancelled: { count: 0, amount: 0 },
    draft:     { count: 0, amount: 0 },
  };
  for (const r of rows) {
    const amount = Number(r.total_amount ?? 0);
    acc.all.amount += amount;
    const bucket = acc[r.status as POFilterKey] as POBucket | undefined;
    if (bucket === undefined) continue;
    bucket.count  += 1;
    bucket.amount += amount;
  }
  return acc;
}

// Les cinq entrées de la bande — mêmes valeurs de filtre que les pastilles
// qu'elle remplace, `draft` compris nulle part : aucune RPC ne crée de brouillon
// aujourd'hui, et un filtre qui ne peut rien rendre est un état menteur.
const PO_COUNTERS: readonly { value: POFilterKey; label: string; tone?: 'warning' }[] = [
  { value: 'all',       label: 'All POs' },
  { value: 'pending',   label: 'Pending',   tone: 'warning' },
  { value: 'partial',   label: 'Partial',   tone: 'warning' },
  { value: 'received',  label: 'Received' },
  { value: 'cancelled', label: 'Cancelled' },
];

export default function PurchaseOrdersListPage(): JSX.Element {
  const navigate      = useNavigate();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canRead   = hasPermission('purchasing.po.read');
  const canCreate = hasPermission('purchasing.po.create');

  const [status, setStatus]         = useState<POFilterKey>('all');
  const [supplierId, setSupplierId] = useState<string>('');
  const [search, setSearch]         = useState<string>('');
  const [importing, setImporting]   = useState<boolean>(false);

  const exportMut = useHistoricalPurchasesExport();

  async function handleTemplate(): Promise<void> {
    const { buildTemplateWorkbook, downloadWorkbook } = await import(
      '@/features/data-import/buildEntityWorkbook.js'
    );
    downloadWorkbook(buildTemplateWorkbook(purchasesImportDef), 'breakery-purchases-template.xlsx');
  }
  async function handleExport(): Promise<void> {
    try {
      const exportRows = await exportMut.mutateAsync();
      if (exportRows.length === 0) { toast.info('No historical imports to export yet'); return; }
      const { buildExportWorkbook, downloadWorkbook } = await import(
        '@/features/data-import/buildEntityWorkbook.js'
      );
      downloadWorkbook(
        buildExportWorkbook(purchasesImportDef, exportRows),
        `breakery-purchases-export-${new Date().toISOString().slice(0, 10)}.xlsx`,
      );
    } catch (e) {
      toast.error(`Export failed: ${(e as Error).message}`);
    }
  }

  // Les filtres HORS statut : ce sur quoi les compteurs se calculent. Le statut
  // s'ajoute pour la table seule — sans quoi chaque compteur ne compterait que
  // les lignes que son propre filtre a déjà retenues.
  const counterFilters = useMemo<PurchaseOrdersFilters>(() => ({
    ...(supplierId !== '' ? { supplierId } : {}),
    ...(search.trim() !== '' ? { search } : {}),
  }), [supplierId, search]);

  const filters = useMemo<PurchaseOrdersFilters>(() => ({
    ...counterFilters,
    ...(status !== 'all' ? { status } : {}),
  }), [counterFilters, status]);

  const list      = usePurchaseOrdersList(filters);
  const allList   = usePurchaseOrdersList(counterFilters);
  const suppliers = useSuppliersList({ active: 'active' });

  const rows    = list.data ?? [];
  const buckets = useMemo(() => aggregate(allList.data ?? []), [allList.data]);
  const countersDown = allList.isError;

  const counters = useMemo<ListCounter[]>(() => PO_COUNTERS.map((c) => {
    const bucket = buckets[c.value];
    return {
      id:    c.value,
      label: c.label,
      // Un échec de chargement rend un tiret, jamais un zéro : « aucun bon en
      // attente » et « je n'ai pas pu compter » ne se ressemblent pas.
      value: countersDown ? '—' : bucket.count,
      ...(c.tone !== undefined && bucket.count > 0 && !countersDown ? { tone: c.tone } : {}),
      ...(countersDown ? {} : {
        title: `${formatCurrency(bucket.amount)} committed across ${String(bucket.count)} purchase order(s). Counted over the 50 most recent POs matching the supplier and search filters.`,
      }),
      onSelect: () => { setStatus(c.value); },
    };
  }), [buckets, countersDown]);

  const columns: readonly DataTableColumn<PurchaseOrderListRow>[] = useMemo(() => [
    {
      id:    'po_number',
      header: 'PO Number',
      render: (r) => (
        <Link
          to={`/backoffice/purchasing/purchase-orders/${r.id}`}
          className={`font-mono text-xs text-gold hover:underline ${FOCUS_RING}`}
          onClick={(e) => e.stopPropagation()}
        >
          {r.po_number}
        </Link>
      ),
    },
    {
      id:    'supplier',
      header: 'Supplier',
      render: (r) => <span className="text-text-primary">{r.suppliers?.name ?? '—'}</span>,
    },
    {
      id:    'status',
      header: 'Status',
      width: '120px',
      render: (r) => (
        <span className="flex items-center gap-1">
          <POStatusBadge status={r.status as POStatus} />
          {r.is_historical_import && (
            <Badge variant="secondary" className="ml-1">Imported</Badge>
          )}
        </span>
      ),
    },
    {
      id:    'order_date',
      header: 'Order date',
      width: '120px',
      align: 'left',
      // The Mono-Carries-Data Rule nomme l'horodatage : la colonne de montant
      // juste en dessous porte déjà `font-data`, les deux colonnes de DATE
      // avaient été oubliées par le même lot.
      render: (r) => <span className="font-data tabular-nums text-text-secondary">{r.order_date !== null ? formatDate(r.order_date) : '—'}</span>,
    },
    {
      id:    'expected_date',
      header: 'Expected',
      width: '120px',
      align: 'left',
      render: (r) => <span className="font-data tabular-nums text-text-secondary">{r.expected_date !== null ? formatDate(r.expected_date) : '—'}</span>,
    },
    {
      id:    'total',
      header: 'Total',
      width: '160px',
      align: 'right',
      // `tabular-nums` sans `font-data` ne fait que demander des chiffres de
      // chasse égale À INSTRUMENT SANS : le montant sortait en sans-serif.
      // The Mono-Carries-Data Rule — un montant rend en mono tabulaire.
      render: (r) => <span className="font-data tabular-nums">{formatCurrency(Number(r.total_amount ?? 0))}</span>,
    },
  ], []);

  if (!canRead) {
    return <div className="text-text-secondary">You do not have permission to view purchase orders.</div>;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        className="items-start gap-4"
        title="Purchase Orders"
        subtitle="Track open and historical POs; receive goods to post inventory + accounting entries."
        actions={
          <>
            {/* Une seule hauteur dans le bandeau : les trois gestes de service
                passent des 36 px du primitif aux 32 px des chaînes de bandeau,
                à côté de l'unique aplat encre (« New purchase order »). */}
            <button type="button" className={TOOLBAR_BTN_SECONDARY} onClick={() => void handleTemplate()} aria-label="Download purchases template">
              <FileText className={TOOLBAR_ICON} aria-hidden /> Template
            </button>
            {canCreate && (
              <button type="button" className={TOOLBAR_BTN_SECONDARY} onClick={() => setImporting(true)} aria-label="Import historical purchases">
                <Upload className={TOOLBAR_ICON} aria-hidden /> Import
              </button>
            )}
            <button type="button" className={TOOLBAR_BTN_SECONDARY} onClick={() => void handleExport()} disabled={exportMut.isPending} aria-label="Export historical purchases">
              <Download className={TOOLBAR_ICON} aria-hidden /> {exportMut.isPending ? 'Exporting…' : 'Export'}
            </button>
            {canCreate && (
              <Link to="/backoffice/purchasing/purchase-orders/new" className={TOOLBAR_BTN_PRIMARY}>
                <Plus className="h-3.5 w-3.5" aria-hidden /> New purchase order
              </Link>
            )}
          </>
        }
      />

      <ListCounterStrip
        counters={counters}
        activeId={status}
        ariaLabel="Purchase order status filter"
        data-testid="po-counters"
      />

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border-subtle bg-bg-elevated px-4 py-3">
        <div className="relative flex-1 min-w-[16rem]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" aria-hidden />
          <input
            id="po-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by PO number…"
            maxLength={64}
            aria-label="Search purchase orders"
            className={`h-9 w-full rounded-md border border-border-strong bg-bg-input pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted ${FOCUS_RING}`}
          />
        </div>
        <select
          id="po-supplier"
          value={supplierId}
          onChange={(e) => setSupplierId(e.target.value)}
          aria-label="Supplier filter"
          className={`h-9 rounded-md border border-border-strong bg-bg-input px-3 text-sm text-text-primary ${FOCUS_RING}`}
        >
          <option value="">All suppliers</option>
          {(suppliers.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>{s.name} ({s.code})</option>
          ))}
        </select>
      </div>

      {list.error !== null && list.error !== undefined ? (
        <div role="alert" className="rounded-md border border-danger bg-danger-soft p-3 text-sm text-danger">
          Failed to load purchase orders: {list.error.message}
        </div>
      ) : (
        <DataTable
          caption="Purchase-order number, supplier, status, order date, expected date and total per purchase order"
          data-testid="po-table"
          columns={columns}
          rows={rows}
          getRowKey={(r) => r.id}
          isLoading={list.isLoading}
          onRowClick={(row) => { void navigate(`/backoffice/purchasing/purchase-orders/${row.id}`); }}
          emptyState={
            <div className="px-6 py-12 text-center">
              <Package className="mx-auto h-10 w-10 text-text-muted" aria-hidden />
              {/* `<h2>` et non `<h3>` : la page n'a que le `<h1>` de PageHeader,
                  le niveau sautait de 1 à 3 (WCAG 1.3.1). Et `font-display
                  italic` est parti avec : sous `.theme-backoffice`,
                  `--font-display` est remappé sur la pile du CORPS — la classe
                  nommait le contraire de ce qu'elle faisait, et l'italique
                  restait seul. Deux défauts déjà corrigés deux fois ailleurs
                  dans cette campagne (2026-08-18). */}
              <h2 className="mt-3 text-xl font-semibold text-text-primary">No purchase orders yet</h2>
              <p className="mx-auto mt-1 max-w-prose text-sm text-text-secondary">
                {canCreate
                  ? 'Draft a purchase order to start tracking incoming stock and supplier balances.'
                  : 'A manager must draft a purchase order before any will appear here.'}
              </p>
              {canCreate && (
                // Le primitif partagé, pas `TOOLBAR_BTN_PRIMARY` : DESIGN.md
                // § Boutons borne les chaînes `TOOLBAR_BTN_*` au BANDEAU de page.
                // Un bouton d'état vide est une action de panneau — il prend le
                // primitif, comme ceux des modales et des pieds de table.
                <div className="mt-4">
                  <Button asChild variant="ink" size="sm">
                    <Link to="/backoffice/purchasing/purchase-orders/new">
                      <Plus className="h-3.5 w-3.5" aria-hidden /> New purchase order
                    </Link>
                  </Button>
                </div>
              )}
            </div>
          }
        />
      )}

      <ImportEntityModal
        open={importing}
        onClose={() => setImporting(false)}
        def={purchasesImportDef}
        title="Import historical purchases"
        description="Upload a filled .xlsx template. Rows are grouped by po_reference into received purchase orders for reporting only — no stock movement, no accounting entry. The file is validated before any writes."
      />
    </div>
  );
}
