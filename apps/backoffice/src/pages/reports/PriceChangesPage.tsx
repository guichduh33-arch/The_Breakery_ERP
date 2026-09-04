// apps/backoffice/src/pages/reports/PriceChangesPage.tsx
//
// Lot G (campagne Reports 2026-08-15) — vague Journaux, page 3/5. Migrée sur le
// socle Report shell v2 (archétype maquette 4c, patron : PurchaseItemsPage).
//
// C'EST UN JOURNAL DES PRIX DE VENTE, pas un rapport de marge. Chaque ligne est
// un changement daté, avec son auteur : l'écran répond à « qui a touché à quoi,
// et de combien », pas à « combien ça rapporte ». D'où : pas de bande de KPI —
// « 47 changements » n'est ni un objectif ni un signal —, et pas de comparaison,
// une trace ne se met pas en regard de la trace précédente.
//
// CE QUI NE CHANGE PAS : les lignes viennent de `get_price_changes_v1` et sont
// servies telles quelles ; le FILTRE PRODUIT reste, en URL-state (R-17 : la vue
// est partageable et survit au rechargement) ; le drill-down produit reste ; la
// bannière du plafond serveur (500 lignes) reste, alignée sur la forme du lot A2.
// `old_price` à NULL garde sa mention « first recorded » : c'est le premier prix
// connu de ce produit, ce n'est PAS un prix de zéro — et c'est pour cette même
// raison que la colonne « Change » n'a alors pas de pourcentage.
//
// Params URL : `start` / `end` / `product_id` — les bornes portaient DÉJÀ les
// noms du socle (`useUrlState('start'/'end')`), aucun repli legacy n'est
// nécessaire. Seul le défaut change : 29 jours maison → 28 jours du socle.

import { useMemo, type JSX } from 'react';
import { selectClassName, cn } from '@breakery/ui';
import { useQuery } from '@tanstack/react-query';
import type { CsvColumn } from '@breakery/domain';
import { formatDateTimeShortWita, formatPercent } from '@breakery/utils';
import { supabase } from '@/lib/supabase.js';
import { PanelCard } from '@/components/PanelCard.js';
import { ReportShell } from '@/features/reports/components/ReportShell.js';
import { PeriodControl } from '@/features/reports/components/PeriodControl.js';
import { ExportMenu } from '@/features/reports/components/ExportMenu.js';
import { SortableTh } from '@/features/reports/components/SortableTh.js';
import { DrilldownLink } from '@/features/reports/components/DrilldownLink.js';
import { useReportPeriod } from '@/features/reports/hooks/useReportPeriod.js';
import { useSortedRows, type SortSpec } from '@/features/reports/hooks/useSortedRows.js';
import { formatIdrFull } from '@/features/reports/utils/chartColors.js';
import { periodLabel } from '@/features/reports/utils/reportFigures.js';
import {
  usePriceChanges,
  type PriceChangeLine,
} from '@/features/reports/hooks/usePriceChanges.js';
import { useUrlState } from '@/hooks/useUrlState.js';

const csvColumns: CsvColumn<PriceChangeLine>[] = [
  { header: 'Date',      accessor: (r) => r.changed_at.slice(0, 10), format: 'text' },
  { header: 'Product',   accessor: (r) => r.product_name,            format: 'text' },
  { header: 'Actor',     accessor: (r) => r.actor_name,              format: 'text' },
  { header: 'Old Price', accessor: (r) => r.old_price ?? '',         format: 'text' },
  { header: 'New Price', accessor: (r) => r.new_price,               format: 'idr-round100' },
  { header: 'Delta (%)', accessor: (r) => r.delta_pct ?? '',         format: 'text' },
];

type SortKey = 'date' | 'product' | 'actor' | 'old' | 'new' | 'delta';

const SORT_SPECS: Record<SortKey, SortSpec<PriceChangeLine>> = {
  date:    { kind: 'date',   value: (r) => r.changed_at },
  product: { kind: 'string', value: (r) => r.product_name },
  actor:   { kind: 'string', value: (r) => r.actor_name },
  // `old_price` et `delta_pct` sont nullables : le hook range les absents en
  // bas dans les DEUX sens, un premier prix n'est pas un extrême.
  old:     { kind: 'number', value: (r) => r.old_price },
  new:     { kind: 'number', value: (r) => r.new_price },
  delta:   { kind: 'number', value: (r) => r.delta_pct },
};

interface ProductOption { id: string; name: string }

function useActiveProducts() {
  return useQuery<ProductOption[]>({
    queryKey: ['products-for-price-filter'],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('id, name')
        .is('deleted_at', null)
        .eq('is_active', true)
        .order('name', { ascending: true })
        .limit(500);
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Une hausse est rouge, une baisse est verte : c'est le prix PAYÉ PAR LE
 *  CLIENT, pas une recette. */
function DeltaBadge({ pct }: { pct: number | null }): JSX.Element {
  if (pct === null) {
    return <span className="text-xs text-text-secondary">—</span>;
  }
  const tone = pct > 0
    ? 'bg-danger-soft text-danger'
    : pct < 0
      ? 'bg-success-soft text-success'
      : 'bg-surface-4 text-text-secondary';
  return (
    <span className={cn('inline-flex rounded px-1 py-0.5 font-data text-xs font-medium', tone)}>
      {formatPercent(pct, { signed: true })}
    </span>
  );
}

const NUM_CELL = 'py-2 text-right font-data tabular-nums';

export default function PriceChangesPage(): JSX.Element {
  const period = useReportPeriod();
  const { start, end } = period;
  // R-17 — filtre en URL-state (convention S57) : la vue devient partageable et
  // survit au rechargement.
  const [productId, setProductId] = useUrlState('product_id', '');

  const { data, isLoading, error } = usePriceChanges({
    start, end, product_id: productId || null,
  });
  const { data: products } = useActiveProducts();

  const changes = useMemo(() => data?.changes ?? [], [data]);
  const sorted = useSortedRows(changes, SORT_SPECS);
  const truncated = data?.truncated === true;

  const toolbar = (
    <>
      <PeriodControl period={period} />
      {/* <select> natif — le module cadre ses filtres de bandeau ainsi. */}
      <label className="flex items-center gap-2 text-sm text-text-secondary">
        <span className="sr-only">Product</span>
        <select
          className={cn(selectClassName, 'h-9 w-auto')}
          value={productId}
          onChange={(e) => { setProductId(e.target.value); }}
          aria-label="Filter by product"
        >
          <option value="">All products</option>
          {(products ?? []).map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </label>
      <ExportMenu
        csv={{ rows: changes, columns: csvColumns, filename: `price-changes-${start}_${end}` }}
        disabled={changes.length === 0}
      />
    </>
  );

  return (
    <ReportShell
      title="Price Changes"
      subtitle={`${periodLabel(start, end)} · retail price change log, newest first`}
      breadcrumb={[{ label: 'Reports', to: '/backoffice/reports' }, { label: 'Financial' }]}
      toolbar={toolbar}
      error={error}
      isEmpty={!isLoading && error === null && data !== undefined && changes.length === 0}
      emptyState={{
        title: 'No price changes',
        description: 'No retail price was changed over this period for this product selection.',
      }}
    >
      {truncated && (
        <p role="status" className="rounded-sm border border-warning bg-warning-soft px-4 py-2 text-sm text-warning">
          First 500 rows shown — narrow the date range to see all changes.
        </p>
      )}

      <PanelCard
        title="Price change log"
        className={truncated ? 'mt-3' : ''}
        subtitle="One line per recorded change, with the author and the resulting move."
        isLoading={isLoading}
        testId="price-changes-table"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">
              Date, product, actor, old price, new price and relative change per price change
            </caption>
            <thead>
              <tr className="border-b border-border-subtle text-text-secondary">
                <SortableTh label="Date"      sortKey="date"    sorted={sorted} />
                <SortableTh label="Product"   sortKey="product" sorted={sorted} />
                <SortableTh label="Actor"     sortKey="actor"   sorted={sorted} />
                <SortableTh label="Old Price" sortKey="old"     sorted={sorted} align="right" />
                <SortableTh label="New Price" sortKey="new"     sorted={sorted} align="right" />
                <SortableTh label="Change"    sortKey="delta"   sorted={sorted} align="right" />
              </tr>
            </thead>
            <tbody>
              {sorted.rows.map((r, idx) => (
                <tr key={`${r.product_id}-${r.changed_at}-${idx}`} className="border-b border-border-subtle">
                  <td className="py-2 font-data text-xs text-text-secondary">{formatDateTimeShortWita(r.changed_at)}</td>
                  <td className="py-2 font-medium">
                    <DrilldownLink entity="product" id={r.product_id} label={r.product_name} icon={false} />
                  </td>
                  <td className="py-2 text-text-secondary">{r.actor_name}</td>
                  <td className={cn(NUM_CELL, 'text-text-secondary')}>
                    {r.old_price === null
                      ? <span className="italic">first recorded</span>
                      : formatIdrFull(r.old_price)}
                  </td>
                  <td className={NUM_CELL}>{formatIdrFull(r.new_price)}</td>
                  <td className={NUM_CELL}><DeltaBadge pct={r.delta_pct} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </PanelCard>
    </ReportShell>
  );
}
