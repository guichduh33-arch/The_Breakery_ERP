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
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Download,
  FileText,
  Package,
  Plus,
  Search,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge, type DataTableColumn } from '@breakery/ui';
import { Button, DataTable } from '@/components/BackofficeUi.js';
import { ImportEntityModal } from '@/features/data-import/components/ImportEntityModal.js';
// `buildEntityWorkbook` tire `xlsx` (159 Ko gzip) : chargé à la demande dans les
// deux handlers, pas à l'ouverture de la liste.
import { purchasesImportDef } from '@/features/purchasing/import/purchasesImportDef.js';
import { useHistoricalPurchasesExport } from '@/features/purchasing/hooks/useHistoricalPurchasesExport.js';
import { formatCurrency } from '@breakery/utils';
import { useAuthStore } from '@/stores/authStore.js';
import {
  usePurchaseOrderCounts,
  usePurchaseOrdersList,
  type PoCounterKey,
  type PoDateField,
  type PoPaymentFilter,
  type PurchaseOrderListRow,
  type PurchaseOrdersFilters,
} from '@/features/purchasing/hooks/usePurchaseOrdersList.js';
import { POStatusBadge, PO_STATUS_LABELS } from '@/features/purchasing/components/POStatusBadge.js';
import { PoPaymentBadge, PAYMENT_STATUS_LABELS } from '@/features/purchasing/components/PoPaymentBadge.js';
import { PO_DATE_HINTS, PO_DATE_LABELS, formatPoDay } from '@/features/purchasing/poVocabulary.js';
import { DateRangePicker } from '@/features/reports/components/DateRangePicker.js';
import { ListPagination, coercePageSize } from '@/components/ListPagination.js';
import { useSuppliersList } from '@/features/suppliers/hooks/useSuppliersList.js';
import {
  TOOLBAR_BTN_PRIMARY,
  TOOLBAR_BTN_SECONDARY,
  TOOLBAR_ICON,
} from '@/components/toolbarButton.js';
import { ListCounterStrip, type ListCounter } from '@/components/ListCounterStrip.js';
import { PageHeader } from '@/components/PageHeader.js';
import { FOCUS_RING } from '@/components/focusRing.js';

// Les cinq entrées de la bande — `draft` n'y est pas : aucune RPC ne crée de
// brouillon aujourd'hui, et un filtre qui ne peut rien rendre est un état menteur.
// Les libellés sont ceux de la pastille de réception (`PO_STATUS_LABELS`).
const PO_COUNTERS: readonly { value: PoCounterKey; label: string; tone?: 'warning' }[] = [
  { value: 'all',       label: 'All orders' },
  { value: 'pending',   label: PO_STATUS_LABELS.pending,   tone: 'warning' },
  { value: 'partial',   label: PO_STATUS_LABELS.partial,   tone: 'warning' },
  { value: 'received',  label: PO_STATUS_LABELS.received },
  { value: 'cancelled', label: PO_STATUS_LABELS.cancelled },
];

const PAYMENT_FILTERS: readonly PoPaymentFilter[] = ['unpaid', 'partial', 'paid'];
const DATE_FIELDS: readonly { value: PoDateField; label: string }[] = [
  { value: 'order_date',    label: PO_DATE_LABELS.ordered },
  { value: 'expected_date', label: PO_DATE_LABELS.expected },
  { value: 'received_date', label: 'Fully received' },
];

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Lit une valeur d'URL contre une liste fermée ; tout le reste vaut « aucun filtre ». */
function pick<T extends string>(raw: string | null, allowed: readonly T[]): T | undefined {
  return raw !== null && (allowed as readonly string[]).includes(raw) ? (raw as T) : undefined;
}

const SELECT_CLS = `h-9 rounded-md border border-border-strong bg-bg-input px-3 text-sm text-text-primary ${FOCUS_RING}`;

export default function PurchaseOrdersListPage(): JSX.Element {
  const navigate      = useNavigate();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canRead   = hasPermission('purchasing.po.read');
  const canCreate = hasPermission('purchasing.po.create');

  // Les filtres vivent dans l'URL : un lien partagé ou un retour arrière depuis
  // la fiche d'un bon retrouve la même liste, au même endroit.
  const [params, setParams] = useSearchParams();
  const status        = pick(params.get('status'), ['pending', 'partial', 'received', 'cancelled'] as const) ?? 'all';
  const supplierId    = params.get('supplier') ?? '';
  const search        = params.get('q') ?? '';
  const paymentStatus = pick(params.get('payment'), PAYMENT_FILTERS);
  const dateField     = pick(params.get('date_field'), DATE_FIELDS.map((d) => d.value)) ?? 'order_date';
  const rawFrom       = params.get('from') ?? '';
  const rawTo         = params.get('to') ?? '';
  const fromDate      = ISO_DAY.test(rawFrom) ? rawFrom : '';
  const toDate        = ISO_DAY.test(rawTo) ? rawTo : '';
  const page          = Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1);
  const pageSize      = coercePageSize(params.get('size') ?? 50);
  const [importing, setImporting]   = useState<boolean>(false);

  /** Change un filtre et revient en page 1 — sauf quand c'est la page qui change. */
  function setParam(key: string, value: string): void {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value === '' || value === 'all') next.delete(key); else next.set(key, value);
      if (key !== 'page') next.delete('page');
      return next;
    }, { replace: true });
  }
  const hasFilters = params.toString() !== '' && [...params.keys()].some((k) => k !== 'page' && k !== 'size');

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
  const counterFilters = useMemo<Omit<PurchaseOrdersFilters, 'status' | 'limit' | 'offset'>>(() => ({
    ...(supplierId !== '' ? { supplierId } : {}),
    ...(search.trim() !== '' ? { search } : {}),
    ...(paymentStatus !== undefined ? { paymentStatus } : {}),
    dateField,
    ...(fromDate !== '' ? { fromDate } : {}),
    ...(toDate !== '' ? { toDate } : {}),
  }), [supplierId, search, paymentStatus, dateField, fromDate, toDate]);

  const filters = useMemo<PurchaseOrdersFilters>(() => ({
    ...counterFilters,
    ...(status !== 'all' ? { status } : {}),
    limit:  pageSize,
    offset: (page - 1) * pageSize,
  }), [counterFilters, status, page, pageSize]);

  const list      = usePurchaseOrdersList(filters);
  const counts    = usePurchaseOrderCounts(counterFilters);
  // Tous les fournisseurs, inactifs compris : un bon d'un fournisseur désactivé
  // doit rester filtrable.
  const suppliers = useSuppliersList({ active: 'all' });

  const rows  = list.data?.rows ?? [];
  const total = list.data?.total ?? 0;
  const countersDown = counts.isError || counts.data === undefined;

  // Les compteurs suivent tous les filtres SAUF le statut : un compteur qui se
  // recalcule sur son propre filtre ne compte plus que lui-même (ADR-025 D2).
  // Ce sont des comptes serveur exacts — plus le décompte des 50 derniers bons.
  const counters = useMemo<ListCounter[]>(() => PO_COUNTERS.map((c) => {
    const n = counts.data?.[c.value] ?? 0;
    return {
      id:    c.value,
      label: c.label,
      // Un échec de chargement rend un tiret, jamais un zéro.
      value: countersDown ? '—' : n,
      ...(c.tone !== undefined && n > 0 && !countersDown ? { tone: c.tone } : {}),
      onSelect: () => { setParam('status', c.value); },
    };
  // setParam est stable dans les faits (setParams de react-router l'est).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [counts.data, countersDown]);

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
      render: (r) => (
        <Link
          to={`/backoffice/suppliers/${r.supplier_id}`}
          className={`text-text-primary hover:text-gold hover:underline ${FOCUS_RING}`}
          onClick={(e) => e.stopPropagation()}
        >
          {r.suppliers?.name ?? '—'}
        </Link>
      ),
    },
    {
      // Deux colonnes, deux axes indépendants : un bon reçu peut être impayé,
      // un bon à recevoir peut être déjà payé.
      id:    'status',
      header: 'Reception',
      width: '150px',
      render: (r) => (
        <span className="flex items-center gap-1">
          <POStatusBadge status={r.status} />
          {r.is_historical_import && (
            <Badge variant="secondary" className="ml-1">Imported</Badge>
          )}
        </span>
      ),
    },
    {
      id:    'payment',
      header: 'Payment',
      width: '120px',
      render: (r) => (
        <PoPaymentBadge
          status={r.status}
          totalAmount={r.total_amount}
          paidAmount={Number(r.po_paid_amount ?? 0)}
          isHistoricalImport={r.is_historical_import}
        />
      ),
    },
    {
      id:    'order_date',
      header: PO_DATE_LABELS.ordered,
      width: '110px',
      align: 'left',
      // The Mono-Carries-Data Rule nomme l'horodatage : la colonne de montant
      // juste en dessous porte déjà `font-data`, les deux colonnes de DATE
      // avaient été oubliées par le même lot.
      //
      // Critique 2026-08-31 (P1) — `formatDate` rendait `31/08/2026` : c'est le
      // rôle SAISIE ET FILTRE de packages/utils/src/dates.ts, pas le rôle
      // colonne de tableau. Le fichier dit dans son propre commentaire que le
      // mois en LETTRES existe pour tuer l'ambiguïté jour/mois — et l'écran
      // voisin rendait `08/31/2026`. Deux formats numériques contradictoires
      // dans une même session, sur un produit dont le jour métier est un
      // invariant (ADR-019).
      render: (r) => <span className="font-data tabular-nums text-text-secondary">{formatPoDay(r.order_date)}</span>,
    },
    {
      id:    'expected_date',
      header: 'Expected',
      width: '110px',
      align: 'left',
      render: (r) => <span className="font-data tabular-nums text-text-secondary">{formatPoDay(r.expected_date)}</span>,
    },
    {
      id:    'received_date',
      header: PO_DATE_LABELS.received,
      width: '110px',
      align: 'left',
      render: (r) => <span className="font-data tabular-nums text-text-secondary">{formatPoDay(r.received_date)}</span>,
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
        subtitle="Each order has two separate states: reception (goods in stock) and payment (money paid out)."
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

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border-subtle bg-bg-elevated px-4 py-3" data-testid="po-filters">
        <div className="relative flex-1 min-w-[14rem]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" aria-hidden />
          <input
            id="po-search"
            value={search}
            onChange={(e) => setParam('q', e.target.value)}
            placeholder="Search by PO number…"
            maxLength={64}
            aria-label="Search purchase orders"
            className={`h-9 w-full rounded-md border border-border-strong bg-bg-input pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted ${FOCUS_RING}`}
          />
        </div>
        <select id="po-supplier" value={supplierId} onChange={(e) => setParam('supplier', e.target.value)}
          aria-label="Supplier filter" className={SELECT_CLS}>
          <option value="">All suppliers</option>
          {(suppliers.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>{s.name} ({s.code}){s.is_active ? '' : ' — inactive'}</option>
          ))}
        </select>
        <select id="po-payment" value={paymentStatus ?? ''} onChange={(e) => setParam('payment', e.target.value)}
          aria-label="Payment filter" className={SELECT_CLS} data-testid="po-payment-filter">
          <option value="">Any payment</option>
          {PAYMENT_FILTERS.map((p) => <option key={p} value={p}>{PAYMENT_STATUS_LABELS[p]}</option>)}
        </select>
        {/* La plage porte sur la date CHOISIE : les trois ne disent pas la
            même chose (commande, livraison prévue, réception complète). */}
        <div className="flex flex-wrap items-center gap-2">
          <select id="po-date-field" value={dateField} onChange={(e) => setParam('date_field', e.target.value === 'order_date' ? '' : e.target.value)}
            aria-label="Date the range applies to" className={SELECT_CLS} title={PO_DATE_HINTS.ordered}>
            {DATE_FIELDS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select>
          <DateRangePicker
            start={fromDate} end={toDate}
            onStartChange={(v) => setParam('from', v)}
            onEndChange={(v) => setParam('to', v)}
          />
        </div>
        {hasFilters && (
          <button type="button" className={`text-sm text-text-secondary underline-offset-2 hover:text-text-primary hover:underline ${FOCUS_RING}`}
            onClick={() => setParams(new URLSearchParams(), { replace: true })} data-testid="po-clear-filters">
            Clear filters
          </button>
        )}
      </div>

      {list.error !== null && list.error !== undefined ? (
        <div role="alert" className="rounded-md border border-danger bg-danger-soft p-3 text-sm text-danger">
          Failed to load purchase orders: {list.error.message}
        </div>
      ) : (
        <DataTable
          caption="Purchase-order number, supplier, reception status, payment status, order date, expected delivery, received date and total per purchase order"
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
              <h2 className="mt-3 text-xl font-semibold text-text-primary">
                {hasFilters || status !== 'all' ? 'No purchase order matches these filters' : 'No purchase orders yet'}
              </h2>
              <p className="mx-auto mt-1 max-w-prose text-sm text-text-secondary">
                {hasFilters || status !== 'all'
                  ? 'Change or clear the filters above to see more orders.'
                  : canCreate
                  ? 'Draft a purchase order to start tracking incoming stock and supplier balances.'
                  : 'A manager must draft a purchase order before any will appear here.'}
              </p>
              {canCreate && !hasFilters && status === 'all' && (
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
      {total > 0 && (
        <ListPagination
          total={total}
          page={page}
          pageSize={pageSize}
          onPage={(n) => setParam('page', String(n))}
          onPageSize={(n) => setParam('size', String(n))}
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
