// apps/backoffice/src/pages/reports/PurchaseItemsPage.tsx
//
// « Purchase Items » — les achats PAR ARTICLE. S3-20 (2026-11-20) : la page
// était un journal de lignes plafonné à 1 000, dont les totaux et le classement
// portaient sur ce plafond. Elle devient la symétrique des ventes par article :
//
//  1. L'AGRÉGAT EST SERVEUR (`get_purchase_items_v2`) : valeur, part, quantité,
//     coût moyen, bons et fournisseurs par article, sur TOUTES les lignes de la
//     période. Aucune bannière de troncature : il n'y a plus de plafond.
//  2. LES QUANTITÉS SONT EN UNITÉ DE BASE. L'ancienne tuile « Units ordered »
//     additionnait des sacs et des kilos ; elle disparaît, la quantité vit par
//     article, dans son unité.
//  3. LES FOURNISSEURS SONT COMPTÉS PAR IDENTIFIANT, côté serveur (la page les
//     dédoublonnait par nom).
//  4. LE PÉRIMÈTRE EST DIT JUSTE : tout bon confirmé (en attente, partiel ou
//     reçu), brouillons et annulés exclus — le sous-titre disait « reçus ».
//  5. CHAQUE ARTICLE SE DESCEND vers ses lignes d'achat, paginées serveur.
//
// Filtres dans l'URL (socle S3-22) : fournisseur, catégorie, statut, plus
// `product_id` posé par un lien entrant. La recherche ne touche que la table.
// Params URL conservés : `start` / `end` / `supplier_id` (liens des autres
// rapports d'achat).

import { useMemo, useState, type JSX } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { CsvColumn } from '@breakery/domain';
import { PanelCard } from '@/components/PanelCard.js';
import { KpiTile, KPI_NOTE, KPI_NOTE_HERO } from '@/components/kpi/KpiTile.js';
import { Delta } from '@/components/kpi/Delta.js';
import { ReportShell } from '@/features/reports/components/ReportShell.js';
import { KpiBand } from '@/features/reports/components/KpiBand.js';
import { PeriodControl } from '@/features/reports/components/PeriodControl.js';
import { ExportMenu } from '@/features/reports/components/ExportMenu.js';
import { ReportFilterBar } from '@/features/reports/components/ReportFilterBar.js';
import { ReportTable } from '@/features/reports/components/ReportTable.js';
import { BreakdownCard, type BreakdownRow } from '@/features/reports/components/BreakdownCard.js';
import { TrendLineChart } from '@/features/reports/components/charts/TrendLineChart.js';
import { PurchaseItemLinesDrawer } from '@/features/reports/components/PurchaseItemLinesDrawer.js';
import {
  PURCHASE_ITEMS_SORT_SPECS, buildPurchaseItemsColumns,
} from '@/features/reports/components/purchaseItemsColumns.js';
import { useReportPeriod } from '@/features/reports/hooks/useReportPeriod.js';
import { useReportFilters, type ReportFilterDef } from '@/features/reports/hooks/useReportFilters.js';
import {
  PURCHASE_ITEM_STATUSES, usePurchaseItems, type PurchaseItemRow, type PurchaseItemStatus,
} from '@/features/reports/hooks/usePurchaseItems.js';
import { useAllCategories } from '@/features/categories/hooks/useAllCategories.js';
import { categoricalColor, formatIdrCompact, formatIdrFull } from '@/features/reports/utils/chartColors.js';
import { formatCount, pctChange, periodLabel, topSlice } from '@/features/reports/utils/reportFigures.js';
import { useUrlState } from '@/hooks/useUrlState.js';
import { supabase } from '@/lib/supabase.js';

interface SupplierOption { id: string; name: string }

const csvColumns: CsvColumn<PurchaseItemRow>[] = [
  { header: 'Article',            accessor: (r) => r.product_name,       format: 'text' },
  { header: 'SKU',                accessor: (r) => r.sku,                format: 'text' },
  { header: 'Category',           accessor: (r) => r.category_name ?? '', format: 'text' },
  { header: 'Quantity (base)',    accessor: (r) => r.base_quantity,      format: 'number' },
  { header: 'Base unit',          accessor: (r) => r.base_unit ?? '',    format: 'text' },
  { header: 'Purchase unit',      accessor: (r) => r.purchase_unit ?? 'mixed', format: 'text' },
  { header: 'Value (IDR)',        accessor: (r) => r.value,              format: 'idr-round100' },
  { header: 'Share %',            accessor: (r) => r.share_pct.toFixed(2), format: 'text' },
  { header: 'Avg unit cost (IDR)', accessor: (r) => r.avg_unit_cost ?? '', format: 'idr' },
  { header: 'Previous value (IDR)', accessor: (r) => r.previous_value,   format: 'idr-round100' },
  { header: 'POs',                accessor: (r) => r.po_count,           format: 'number' },
  { header: 'Suppliers',          accessor: (r) => r.supplier_count,     format: 'number' },
  { header: 'Last received',      accessor: (r) => r.last_received_date ?? '', format: 'text' },
];

type FilterKey = 'supplier_id' | 'category_id' | 'status';

const STATUS_LABELS: Record<PurchaseItemStatus, string> = {
  pending: 'Pending', partial: 'Partially received', received: 'Received',
};

const SEARCH_KEY = 'q';
const PRODUCT_KEY = 'product_id';
const EXTRA_FILTER_KEYS: readonly string[] = [SEARCH_KEY, PRODUCT_KEY];

const isStatus = (v: string): v is PurchaseItemStatus =>
  (PURCHASE_ITEM_STATUSES as readonly string[]).includes(v);

interface KpiDescriptor {
  key: string; label: string; value: string; title?: string; delta?: number | null; note?: string;
}

export default function PurchaseItemsPage(): JSX.Element {
  const period = useReportPeriod();
  const { start, end, compare } = period;
  const [opened, setOpened] = useState<{ id: string; name: string } | null>(null);
  const [productId] = useUrlState(PRODUCT_KEY, '');

  const { data: supplierOptions } = useQuery<SupplierOption[]>({
    queryKey: ['suppliers-options'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('suppliers').select('id, name').eq('is_active', true).order('name');
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 5 * 60 * 1000,
  });
  const { data: categories } = useAllCategories();

  const filterDefs = useMemo<readonly ReportFilterDef<FilterKey>[]>(() => [
    {
      kind: 'select', key: 'supplier_id', label: 'Supplier', allLabel: 'All suppliers',
      options: (supplierOptions ?? []).map((s) => ({ value: s.id, label: s.name })),
    },
    {
      kind: 'select', key: 'category_id', label: 'Category', allLabel: 'All categories',
      options: (categories ?? []).map((c) => ({ value: c.id, label: c.name })),
    },
    {
      kind: 'select', key: 'status', label: 'PO status', allLabel: 'All statuses', strict: true,
      options: PURCHASE_ITEM_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] })),
    },
  ], [supplierOptions, categories]);
  const filters = useReportFilters(filterDefs, { extraKeys: EXTRA_FILTER_KEYS });
  const supplierId = filters.values.supplier_id;
  const categoryId = filters.values.category_id;
  const status = isStatus(filters.values.status) ? filters.values.status : null;

  const q = usePurchaseItems({
    start, end,
    supplierId: supplierId || null, categoryId: categoryId || null,
    productId: productId || null, status,
  });
  const hidden  = q.isError || q.isFetching;
  const rows    = useMemo(() => (hidden ? [] : q.data?.items ?? []), [hidden, q.data]);
  const summary = hidden ? undefined : q.data?.summary;

  const top = topSlice(rows, (r) => r.value, 'purchased value', 8);
  const breakdown: BreakdownRow[] = top.rows.map((r, i) => ({
    key: r.product_id, label: r.product_name, amount: r.value,
    sharePct: r.share_pct, color: categoricalColor(i),
  }));

  const trend = useMemo(() => (hidden ? [] : (q.data?.trend ?? []).map((t) => ({
    day: t.date.slice(5, 10), value: t.value, previous: t.previous_value,
  }))), [hidden, q.data]);

  const tiles: KpiDescriptor[] = [
    {
      key: 'total', label: 'Purchased value',
      value: formatIdrCompact(summary?.total_value ?? 0), title: formatIdrFull(summary?.total_value ?? 0),
      ...(compare ? { delta: pctChange(summary?.total_value ?? 0, summary?.previous_total_value) } : {}),
      note: `${formatCount(summary?.line_count ?? 0)} line${summary?.line_count === 1 ? '' : 's'}`,
    },
    { key: 'orders',    label: 'Purchase orders', value: formatCount(summary?.po_count ?? 0) },
    { key: 'suppliers', label: 'Suppliers',       value: formatCount(summary?.supplier_count ?? 0) },
    { key: 'products',  label: 'Articles',        value: formatCount(summary?.product_count ?? 0) },
  ];

  const columns = useMemo(
    () => buildPurchaseItemsColumns({ summary, compare, onOpen: setOpened }),
    [summary, compare],
  );

  const activeCount = Object.keys(filters.active).length + (productId !== '' ? 1 : 0);
  const meta = [
    periodLabel(start, end),
    'pending, partial and received orders — drafts and cancelled excluded',
    ...(activeCount > 0 ? [`${activeCount} filter${activeCount === 1 ? '' : 's'} active`] : []),
  ].join(' · ');

  const toolbar = (
    <>
      <PeriodControl period={period} showCompare />
      <ExportMenu
        csv={{ rows, columns: csvColumns, filename: `purchase-items-${start}_${end}` }}
        disabled={rows.length === 0 || hidden}
      />
    </>
  );

  return (
    <ReportShell
      title="Purchase Items"
      subtitle={meta}
      breadcrumb={[{ label: 'Reports', to: '/backoffice/reports' }, { label: 'Inventory' }]}
      toolbar={toolbar}
      filters={<ReportFilterBar defs={filterDefs} filters={filters} />}
      error={q.error}
      isEmpty={!q.isLoading && q.data !== undefined && rows.length === 0}
      emptyState={{ title: 'No purchase', description: 'No article was ordered for this period and filters.' }}
      kpis={
        <KpiBand isLoading={q.isLoading} tiles={tiles.length} labels={tiles.map((t) => t.label)}>
          {tiles.map((t, i) => (
            <KpiTile
              key={t.key}
              label={t.label}
              value={t.value}
              {...(t.title !== undefined ? { valueTitle: t.title } : {})}
              hero={i === 0}
              testId={`kpi-${t.key}`}
            >
              {t.delta !== undefined && <Delta value={t.delta} period="prev" onInk={i === 0} />}
              {t.note !== undefined && <span className={i === 0 ? KPI_NOTE_HERO : KPI_NOTE}>{t.note}</span>}
            </KpiTile>
          ))}
        </KpiBand>
      }
    >
      <div className="mt-3 grid gap-3 xl:grid-cols-[1.7fr_1fr]">
        <PanelCard title="Spend over time" isLoading={q.isLoading} testId="chart-purchase-trend">
          <TrendLineChart
            data={trend}
            xKey="day"
            currentKey="value"
            currentName="Purchased value"
            {...(compare ? { compareKey: 'previous', compareName: 'Previous period' } : {})}
            ariaLabel={`Purchased value per day from ${start} to ${end}${compare ? ', with the previous period' : ''}.`}
          />
        </PanelCard>
        <BreakdownCard
          title="Top articles by value"
          subtitle={top.note ?? 'Share of the purchased value over the period.'}
          variant="track"
          rows={breakdown}
          total={{ label: 'Total purchased', amount: summary?.total_value ?? 0 }}
          isLoading={q.isLoading}
          emptyText="No purchase to rank for this period."
          testId="breakdown-purchase-products"
        />
      </div>

      <PanelCard
        title="Articles"
        aside={<span className="text-xs text-text-muted">Pick an article to see its purchase lines</span>}
        className="mt-3"
        isLoading={q.isLoading}
        testId="purchase-items-table"
      >
        <ReportTable
          rows={rows}
          columns={columns}
          sortSpecs={PURCHASE_ITEMS_SORT_SPECS}
          rowKey={(r) => r.product_id}
          caption="Quantity, value, share, average unit cost and orders per purchased article"
          showFooter={summary !== undefined}
          search={{ label: 'Search articles', placeholder: 'Search articles', noun: 'article', urlKey: SEARCH_KEY }}
          emptyText="No article purchased."
          testId="purchase-items-report-table"
        />
      </PanelCard>

      <PurchaseItemLinesDrawer
        product={hidden ? null : opened}
        start={start}
        end={end}
        supplierId={supplierId || null}
        status={status}
        onClose={() => { setOpened(null); }}
      />
    </ReportShell>
  );
}
