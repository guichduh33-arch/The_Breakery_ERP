// apps/backoffice/src/pages/reports/GrossMarginPage.tsx
//
// Lot E (campagne Reports 2026-08-15) — vague Finance, page 2/8. Migrée sur le
// socle Report shell v2 (archétype maquette 4c, patron : DailySalesPage).
//
// CE QUI NE CHANGE PAS : la marge reste celle de
// `get_gross_margin_by_product_v1` — revenus, COGS et taux par produit, servis
// tels quels. Le CAVEAT reste affiché : le COGS est valorisé au coût moyen
// pondéré COURANT (`products.cost_price`), pas à un instantané pris au moment
// de chaque vente. Une marge affichée ici bouge quand le prix fournisseur bouge,
// même sur des ventes anciennes — le dire est une obligation, pas une note.
//
// Le graphe est un PARETO : « qu'est-ce qui porte la marge ». La courbe cumule
// la MÊME unité que les barres, sur le MÊME axe (jamais un second axe en %), et
// son pourcentage se rapporte au jeu COMPLET, pas aux seules barres montrées —
// sinon douze produits sur quatre-vingts refermeraient la courbe à 100 %, ce qui
// dirait « ces douze font toute la marge ».
//
// Params URL : `start` / `end` (noms déjà standards) + `category_id`, inchangé.
// Pas de comparaison : la vague Finance ne l'arbitre que là où elle existait
// déjà ou la mérite ; ici les tuiles portent des parts, pas des variations.

import { useMemo, type JSX } from 'react';
import { selectClassName, cn } from '@breakery/ui';
import type { CsvColumn } from '@breakery/domain';
import { formatPercent } from '@breakery/utils';
import { PanelCard } from '@/components/PanelCard.js';
import { KpiTile, KPI_NOTE, KPI_NOTE_HERO } from '@/components/kpi/KpiTile.js';
import { ReportShell } from '@/features/reports/components/ReportShell.js';
import { KpiBand } from '@/features/reports/components/KpiBand.js';
import { PeriodControl } from '@/features/reports/components/PeriodControl.js';
import { ExportMenu } from '@/features/reports/components/ExportMenu.js';
import { DrilldownLink } from '@/features/reports/components/DrilldownLink.js';
import {
  BreakdownCard, type BreakdownRow, type ShareSegment,
} from '@/features/reports/components/BreakdownCard.js';
import { ParetoChart } from '@/features/reports/components/charts/ParetoChart.js';
import { useReportPeriod } from '@/features/reports/hooks/useReportPeriod.js';
import {
  useGrossMargin, type GrossMarginProductRow,
} from '@/features/reports/hooks/useGrossMargin.js';
import { useAllCategories } from '@/features/categories/hooks/useAllCategories.js';
import { useUrlState } from '@/hooks/useUrlState.js';
import {
  CHART_1, TEXT_INERT, categoricalColor, formatIdrCompact, formatIdrFull,
} from '@/features/reports/utils/chartColors.js';
import {
  formatCount, formatPct1, periodLabel, sharePct, topSlice,
} from '@/features/reports/utils/reportFigures.js';

const csvColumns: CsvColumn<GrossMarginProductRow>[] = [
  { header: 'Product',    accessor: (r) => r.name,                  format: 'text' },
  { header: 'Category',   accessor: (r) => r.category_name ?? '',    format: 'text' },
  { header: 'Qty',        accessor: (r) => r.qty,                    format: 'number' },
  { header: 'Revenue',    accessor: (r) => r.revenue,                format: 'idr-round100' },
  { header: 'COGS (WAC)', accessor: (r) => r.cogs,                   format: 'idr-round100' },
  { header: 'Margin',     accessor: (r) => r.margin,                 format: 'idr-round100' },
  { header: 'Margin %',   accessor: (r) => r.margin_pct.toFixed(1),  format: 'text' },
];

const NUM_CELL = 'py-2 text-right font-data tabular-nums';
/** Au-delà, l'axe devient une frise illisible — la table dit le reste, et
 *  l'aside annonce la coupe. */
const MAX_BARS = 12;
const MAX_TICK_CHARS = 14;

function truncate(s: string): string {
  return s.length > MAX_TICK_CHARS ? `${s.slice(0, MAX_TICK_CHARS - 1)}…` : s;
}

function fmtPct(n: number): string {
  return formatPercent(n);
}

interface KpiDescriptor {
  key: string; label: string; value: string; title?: string; note?: string;
}

export default function GrossMarginPage(): JSX.Element {
  const period = useReportPeriod();
  const { start, end } = period;
  const [categoryId, setCategoryId] = useUrlState('category_id', '');

  const { data: categories } = useAllCategories();
  const { data, isLoading, error } = useGrossMargin({
    start, end, categoryId: categoryId || null,
  });

  const rows = useMemo(
    () => (data !== undefined ? [...data.by_product].sort((a, b) => b.margin - a.margin) : []),
    [data],
  );

  const chartRows = useMemo(
    () => rows.slice(0, MAX_BARS).map((r) => ({ product: r.name, margin: r.margin })),
    [rows],
  );

  // Ventilation par catégorie — le payload la sert déjà, la page la jetait.
  const byCategory = useMemo(
    () => (data?.by_category ?? []).slice().sort((a, b) => b.margin - a.margin),
    [data?.by_category],
  );
  const cat = topSlice(byCategory, (c) => c.margin, 'margin');

  // UNE PART D'UN TOTAL NÉGATIF N'EXISTE PAS. Sur une période où le COGS
  // dépasse le revenu, le total de marge est négatif : rapporter une ligne
  // positive à cette base rendrait 0 % (plancher de `sharePct`) sur CHAQUE
  // ligne, et une barre de partage vide se lirait « aucune catégorie ne pèse ».
  // Base non positive → pas de part, donc un tiret, et pas de barre.
  const shareable = cat.total > 0;
  const catRows: BreakdownRow[] = cat.rows.map((c, i) => ({
    key:    c.category_id ?? c.category_name ?? `cat-${i}`,
    label:  c.category_name ?? 'Uncategorized',
    amount: c.margin,
    color:  categoricalColor(i),
    count:  fmtPct(c.margin_pct),
    ...(shareable ? { sharePct: sharePct(c.margin, cat.total) } : {}),
  }));
  const shownShare = catRows.reduce((s, r) => s + (r.sharePct ?? 0), 0);
  const catSegments: ShareSegment[] = shareable
    ? [
        ...catRows.map((r) => ({ label: r.label, pct: r.sharePct ?? 0, color: r.color ?? CHART_1 })),
        ...(shownShare < 99.95
          ? [{ label: 'Others', pct: 100 - shownShare, color: TEXT_INERT }]
          : []),
      ]
    : [];

  const summary = data?.summary;
  const leader  = rows[0];

  const tiles: KpiDescriptor[] = [
    {
      key: 'margin', label: 'Margin',
      value: formatIdrCompact(summary?.margin ?? 0), title: formatIdrFull(summary?.margin ?? 0),
      note:  `${fmtPct(summary?.margin_pct ?? 0)} of revenue`,
    },
    {
      key: 'revenue', label: 'Revenue',
      value: formatIdrCompact(summary?.revenue ?? 0), title: formatIdrFull(summary?.revenue ?? 0),
    },
    {
      key: 'cogs', label: 'COGS (WAC)',
      value: formatIdrCompact(summary?.cogs ?? 0), title: formatIdrFull(summary?.cogs ?? 0),
      note:  'current weighted-average cost',
    },
    {
      key: 'margin-pct', label: 'Margin %',
      value: fmtPct(summary?.margin_pct ?? 0),
    },
    {
      key: 'products', label: 'Products sold', value: formatCount(rows.length),
    },
    {
      // Une variation n'a pas de sens sur un NOM : la tuile porte la part —
      // sauf quand la marge totale est négative, où une part n'existe pas :
      // elle porte alors le TAUX du produit, qui reste vrai.
      key: 'top-product', label: 'Top margin',
      value: leader?.name ?? '—',
      note:  leader === undefined
        ? 'no sale in this period'
        : (summary?.margin ?? 0) > 0
          ? `${formatPct1(sharePct(leader.margin, summary?.margin ?? 0))} of margin`
          : `${fmtPct(leader.margin_pct)} margin rate`,
    },
  ];

  const meta = [
    periodLabel(start, end),
    `${formatCount(rows.length)} product${rows.length === 1 ? '' : 's'}`,
    'COGS valued at current WAC',
  ].join(' · ');

  const toolbar = (
    <>
      <PeriodControl period={period} />
      <label className="flex items-center gap-1.5 text-xs text-text-muted">
        <span>Category</span>
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          aria-label="Category filter"
          className={cn(selectClassName, 'h-9 w-auto')}
        >
          <option value="">All categories</option>
          {(categories ?? []).map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </label>
      <ExportMenu
        csv={{ rows, columns: csvColumns, filename: `gross-margin-${start}_${end}` }}
        disabled={rows.length === 0}
      />
    </>
  );

  return (
    <ReportShell
      title="Gross Margin"
      subtitle={meta}
      breadcrumb={[{ label: 'Reports', to: '/backoffice/reports' }, { label: 'Financial' }]}
      toolbar={toolbar}
      error={error}
      isEmpty={!isLoading && data !== undefined && rows.length === 0}
      emptyState={{
        title: 'No sales',
        description: 'No sales in the selected date range and category.',
      }}
      kpis={
        <KpiBand isLoading={isLoading} tiles={tiles.length} labels={tiles.map((t) => t.label)}>
          {tiles.map((t, i) => (
            <KpiTile
              key={t.key}
              label={t.label}
              value={t.value}
              {...(t.title !== undefined ? { valueTitle: t.title } : {})}
              hero={i === 0}
              testId={`kpi-${t.key}`}
            >
              {t.note !== undefined && (
                <span className={i === 0 ? KPI_NOTE_HERO : KPI_NOTE}>{t.note}</span>
              )}
            </KpiTile>
          ))}
        </KpiBand>
      }
    >
      {/* Le caveat n'est pas une note de bas de page : il conditionne la lecture
          de chaque chiffre de l'écran. */}
      <p
        className="rounded-sm border border-border-subtle bg-surface-4 px-3 py-2 text-xs text-text-secondary"
        data-testid="wac-caveat"
      >
        Cost basis = current weighted-average cost (<code>products.cost_price</code>), not a
        snapshot captured at the moment of each sale. Margins shift when supplier prices change.
      </p>

      <div className="mt-3 grid gap-3 xl:grid-cols-[1.7fr_1fr]">
        <PanelCard
          title="Margin concentration"
          aside={rows.length > MAX_BARS ? (
            <span className="text-xs text-text-muted">
              Top {MAX_BARS} of {formatCount(rows.length)}
            </span>
          ) : undefined}
          isLoading={isLoading}
          testId="chart-margin-pareto"
        >
          <ParetoChart
            data={chartRows}
            xKey="product"
            valueKey="margin"
            valueName="Margin"
            grandTotal={summary?.margin ?? 0}
            xTickFormatter={(v) => truncate(String(v))}
            ariaLabel={`Margin per product, highest first, with the cumulative margin over the whole period from ${start} to ${end}.`}
          />
        </PanelCard>
        <BreakdownCard
          title="Margin by category"
          subtitle={shareable
            ? cat.note
            : 'Margin is negative over this period — shares are not shown.'}
          variant="track"
          rows={catRows}
          total={{ label: 'Total margin', amount: cat.total }}
          isLoading={isLoading}
          error={error}
          shareBar={{
            title:     'Share of margin',
            ariaLabel: 'Share of margin by product category',
            segments:  catSegments,
          }}
          shareBarPlacement="after-total"
          emptyText="No margin to ventilate for this period."
          testId="breakdown-margin-categories"
        />
      </div>

      <PanelCard
        title="Product detail"
        className="mt-3"
        isLoading={isLoading}
        testId="gm-product-detail"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Revenue, COGS and margin per product</caption>
            <thead>
              <tr className="border-b border-border-subtle text-text-secondary">
                <th scope="col" className="py-2 text-left">Product</th>
                <th scope="col" className="py-2 text-left">Category</th>
                <th scope="col" className="py-2 text-right">Qty</th>
                <th scope="col" className="py-2 text-right">Revenue</th>
                <th scope="col" className="py-2 text-right">COGS</th>
                <th scope="col" className="py-2 text-right">Margin</th>
                <th scope="col" className="py-2 text-right">Margin %</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.product_id} className="border-b border-border-subtle">
                  <td className="py-2">
                    <DrilldownLink entity="product" id={r.product_id} label={r.name} icon={false} />
                  </td>
                  <td className="py-2 text-text-secondary">{r.category_name ?? '—'}</td>
                  <td className={NUM_CELL}>{formatCount(r.qty)}</td>
                  <td className={NUM_CELL}>{formatIdrFull(r.revenue)}</td>
                  <td className={NUM_CELL}>{formatIdrFull(r.cogs)}</td>
                  <td className={NUM_CELL}>{formatIdrFull(r.margin)}</td>
                  <td className={NUM_CELL}>{fmtPct(r.margin_pct)}</td>
                </tr>
              ))}
            </tbody>
            {rows.length > 0 && summary !== undefined && (
              <tfoot>
                <tr className="border-t border-border-subtle font-semibold">
                  <td className="py-2">Total</td>
                  <td />
                  <td className={NUM_CELL}>{formatCount(rows.reduce((s, r) => s + r.qty, 0))}</td>
                  <td className={NUM_CELL}>{formatIdrFull(summary.revenue)}</td>
                  <td className={NUM_CELL}>{formatIdrFull(summary.cogs)}</td>
                  <td className={NUM_CELL}>{formatIdrFull(summary.margin)}</td>
                  <td className={NUM_CELL}>{fmtPct(summary.margin_pct)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </PanelCard>
    </ReportShell>
  );
}
