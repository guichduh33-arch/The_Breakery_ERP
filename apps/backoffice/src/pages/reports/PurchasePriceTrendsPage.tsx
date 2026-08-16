// apps/backoffice/src/pages/reports/PurchasePriceTrendsPage.tsx
//
// « Purchase Price Trends » — l'évolution des prix d'achat. Famille Purchase,
// archétype Report (socle Report shell v2) ; patron : SalesByProductPage.
// Question tranchée : « ce fournisseur me coûte-t-il plus cher qu'avant —
// renégocier ou basculer ? » (conception validée par Mamat le 2026-08-16).
//
// TROIS CHOSES QUE CETTE PAGE DIT ET QU'AUCUNE AUTRE NE DISAIT :
//
//  1. LE PRIX EST COMPARABLE. get_purchase_by_date/by_supplier disent COMBIEN on
//     achète ; ici chaque prix est ramené à l'UNITÉ DE BASE de l'article
//     (unit_cost ÷ unit_factor_to_base) — un sac de 25 kg et un kg au détail
//     tracent la même courbe.
//  2. LA DÉRIVE EST PONDÉRÉE. L'inflation du panier pèse chaque article par sa
//     dépense (Σ spend·Δ ÷ Σ spend, packages/domain) — 2 % sur la farine pèse
//     plus que 20 % sur le safran. La classification hausse/baisse (seuil ±2 %,
//     constante domain) et les KPI se recalculent depuis les lignes de la
//     table : la bande ne peut pas diverger de ce qu'elle surplombe.
//  3. CHAQUE PRIX A SES POINTS. Un clic sur un article trace ses achats réels —
//     un point par PO, une série par fournisseur — le lecteur VOIT qui a monté
//     ses prix et quand, au lieu de le déduire d'une moyenne.

import { useMemo, useState, type JSX } from 'react';
import {
  CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { EmptyState, selectClassName, cn } from '@breakery/ui';
import { TrendingUp } from 'lucide-react';
import {
  PURCHASE_PRICE_RISE_THRESHOLD_PCT, classifyPriceDelta, risingSpendSharePct,
  weightedInflationPct, type CsvColumn,
} from '@breakery/domain';
import { PanelCard } from '@/components/PanelCard.js';
import { KpiTile, KPI_NOTE, KPI_NOTE_HERO } from '@/components/kpi/KpiTile.js';
import { Delta } from '@/components/kpi/Delta.js';
import { FOCUS_RING } from '@/components/focusRing.js';
import { ReportShell } from '@/features/reports/components/ReportShell.js';
import { KpiBand } from '@/features/reports/components/KpiBand.js';
import { PeriodControl } from '@/features/reports/components/PeriodControl.js';
import { ExportMenu } from '@/features/reports/components/ExportMenu.js';
import { SortableTh } from '@/features/reports/components/SortableTh.js';
import { ParetoChart } from '@/features/reports/components/charts/ParetoChart.js';
import { useReportPeriod } from '@/features/reports/hooks/useReportPeriod.js';
import { useSortedRows, type SortSpec } from '@/features/reports/hooks/useSortedRows.js';
import {
  usePurchasePriceTrends, type PurchasePriceProductRow,
} from '@/features/reports/hooks/usePurchasePriceTrends.js';
import { usePurchasePricePoints } from '@/features/reports/hooks/usePurchasePricePoints.js';
import { useSuppliersList } from '@/features/suppliers/hooks/useSuppliersList.js';
import { useUrlState } from '@/hooks/useUrlState.js';
import {
  CHART_AXIS_STROKE, CHART_AXIS_TICK, CHART_GRID_STROKE, CHART_TOOLTIP_STYLE,
  categoricalColor, formatIdrCompact, formatIdrFull, formatIdrPrecise,
} from '@/features/reports/utils/chartColors.js';
import {
  formatCount, formatPct1, pctChange, periodLabel, shortDate,
} from '@/features/reports/utils/reportFigures.js';
import { usePrefersReducedMotion } from '@/features/dashboard/utils/usePrefersReducedMotion.js';

const csvColumns: CsvColumn<PurchasePriceProductRow>[] = [
  { header: 'Article',         accessor: (r) => r.name,                          format: 'text' },
  { header: 'Base unit',       accessor: (r) => r.base_unit,                     format: 'text' },
  { header: 'Last supplier',   accessor: (r) => r.last_supplier.name ?? '',      format: 'text' },
  { header: 'POs',             accessor: (r) => r.po_count,                      format: 'number' },
  { header: 'Last price',      accessor: (r) => r.last_price,                    format: 'number' },
  { header: 'Wavg price',      accessor: (r) => r.wavg_price,                    format: 'number' },
  { header: 'Wavg price prev', accessor: (r) => r.wavg_price_prev ?? '',         format: 'number' },
  { header: 'Delta %',         accessor: (r) => r.delta_pct?.toFixed(2) ?? 'new', format: 'text' },
  { header: 'Min price',       accessor: (r) => r.min_price,                     format: 'number' },
  { header: 'Max price',       accessor: (r) => r.max_price,                     format: 'number' },
  { header: 'Spend',           accessor: (r) => r.spend,                         format: 'idr-round100' },
];

const NUM_CELL = 'py-2 text-right font-data tabular-nums';
const TICK = { fontSize: 10, fill: CHART_AXIS_TICK, fontFamily: 'var(--font-data)' } as const;
/** Au-delà, l'axe du Pareto devient une frise illisible. */
const MAX_BARS = 8;
const MAX_TICK_CHARS = 14;

function truncate(s: string): string {
  return s.length > MAX_TICK_CHARS ? `${s.slice(0, MAX_TICK_CHARS - 1)}…` : s;
}

/** Variation SIGNÉE à une décimale — la valeur d'une tuile, pas un Delta. */
function fmtSignedPct(v: number): string {
  const abs = Math.abs(v).toLocaleString('id-ID', {
    minimumFractionDigits: 1, maximumFractionDigits: 1,
  });
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${abs}%`;
}

type SortKey = 'name' | 'unit' | 'supplier' | 'po' | 'last' | 'wavg' | 'delta' | 'spend';

/** Défini au niveau module : une identité neuve à chaque rendu retrierait sans
 *  fin. Un delta absent (nouvel article) trie APRÈS toute vraie variation. */
const SORT_SPECS: Readonly<Record<SortKey, SortSpec<PurchasePriceProductRow>>> = {
  name:     { kind: 'string', value: (r) => r.name },
  unit:     { kind: 'string', value: (r) => r.base_unit },
  supplier: { kind: 'string', value: (r) => r.last_supplier.name },
  po:       { kind: 'number', value: (r) => r.po_count },
  last:     { kind: 'number', value: (r) => r.last_price },
  wavg:     { kind: 'number', value: (r) => r.wavg_price },
  delta:    { kind: 'number', value: (r) => r.delta_pct ?? Number.NEGATIVE_INFINITY },
  spend:    { kind: 'number', value: (r) => r.spend },
};

interface KpiDescriptor {
  key: string; label: string; value: string;
  title?: string; delta?: number | null; note?: string;
}

export default function PurchasePriceTrendsPage(): JSX.Element {
  const reduced = usePrefersReducedMotion();
  const period = useReportPeriod();
  const { start, end } = period;
  const [supplierId, setSupplierId] = useUrlState('supplier_id', '');

  // L'article dont on trace les points. Local : une lecture transitoire, pas un
  // état de page qu'on partagerait par un lien.
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: suppliers } = useSuppliersList();

  const trends = usePurchasePriceTrends({ start, end, supplierId: supplierId || null });

  const rows    = useMemo(() => trends.data?.by_product ?? [], [trends.data]);
  const summary = trends.data?.summary;

  const sorted = useSortedRows<PurchasePriceProductRow, SortKey>(rows, SORT_SPECS);

  // KPI dérivés des MÊMES lignes que la table (packages/domain) — la bande ne
  // peut pas diverger de ce qu'elle surplombe.
  const inflation   = useMemo(() => weightedInflationPct(rows), [rows]);
  const risingShare = useMemo(() => risingSpendSharePct(rows), [rows]);
  const classes = useMemo(
    () => rows.map((r) => classifyPriceDelta(r.delta_pct)),
    [rows],
  );
  const risingCount  = classes.filter((c) => c === 'up').length;
  const fallingCount = classes.filter((c) => c === 'down').length;
  const comparableCount = rows.filter((r) => r.delta_pct !== null).length;

  const topRiser = useMemo(() => {
    let best: PurchasePriceProductRow | undefined;
    for (const r of rows) {
      if (r.delta_pct === null) continue;
      if (best?.delta_pct == null || r.delta_pct > best.delta_pct) best = r;
    }
    return best !== undefined && classifyPriceDelta(best.delta_pct) === 'up' ? best : undefined;
  }, [rows]);

  // Article tracé : celui qu'on a cliqué, sinon la plus forte hausse, sinon le
  // plus gros poste de dépense.
  const effectiveId = selectedId ?? topRiser?.product_id ?? rows[0]?.product_id ?? null;
  const effectiveRow = rows.find((r) => r.product_id === effectiveId);

  const points = usePurchasePricePoints({
    productId: effectiveId, start, end, supplierId: supplierId || null,
  });

  // Pivot par date pour Recharts : une clé par fournisseur. Deux POs du même
  // fournisseur le même jour ne gardent que le dernier point — le tooltip du
  // détail vit dans la table Purchase Items, pas ici.
  const { chartData, chartSuppliers } = useMemo(() => {
    const pts = points.data?.points ?? [];
    const supplierKeys = new Map<string, string>(); // key -> name, ordre d'apparition
    const byDate = new Map<string, Record<string, number | string>>();
    for (const p of pts) {
      const key = p.supplier_id ?? p.supplier_name;
      if (!supplierKeys.has(key)) supplierKeys.set(key, p.supplier_name);
      const row = byDate.get(p.order_date)
        ?? { date: p.order_date, label: shortDate(p.order_date) };
      row[key] = p.unit_price;
      byDate.set(p.order_date, row);
    }
    return {
      chartData: Array.from(byDate.values())
        .sort((a, b) => String(a.date).localeCompare(String(b.date))),
      chartSuppliers: Array.from(supplierKeys, ([key, name], i) => ({
        key, name, color: categoricalColor(i),
      })),
    };
  }, [points.data]);

  const supplierNameOf = (key: string): string =>
    chartSuppliers.find((s) => s.key === key)?.name ?? key;

  const paretoRows = useMemo(
    () => (trends.data?.by_supplier ?? [])
      .slice(0, MAX_BARS)
      .map((s) => ({ supplier: s.name, spend: s.spend })),
    [trends.data],
  );
  const supplierCount = trends.data?.by_supplier.length ?? 0;

  const risingSpend = useMemo(
    () => rows.reduce(
      (sum, r, i) => (classes[i] === 'up' ? sum + r.spend : sum), 0,
    ),
    [rows, classes],
  );

  const tiles: KpiDescriptor[] = [
    {
      key: 'spend', label: 'Purchase spend',
      value: formatIdrCompact(summary?.spend ?? 0), title: formatIdrFull(summary?.spend ?? 0),
      delta: pctChange(summary?.spend ?? 0, summary?.spend_prev),
      note:  'POs excl. draft & cancelled',
    },
    {
      key: 'inflation', label: 'Basket inflation',
      value: inflation === null ? '—' : fmtSignedPct(inflation),
      note:  inflation === null
        ? 'no comparable article'
        : `weighted by spend · ${formatCount(comparableCount)} comparable articles`,
    },
    {
      key: 'rising', label: 'Articles rising',
      value: `${formatCount(risingCount)} / ${formatCount(rows.length)}`,
      note:  `±${String(PURCHASE_PRICE_RISE_THRESHOLD_PCT)}% threshold · ${formatCount(fallingCount)} falling`,
    },
    {
      // Une variation n'a pas de sens sur un NOM : la tuile porte le delta en note.
      key: 'top-riser', label: 'Top riser',
      value: topRiser?.name ?? '—',
      note:  topRiser?.delta_pct != null
        ? `${fmtSignedPct(topRiser.delta_pct)} · now ${formatIdrFull(topRiser.last_price)}/${topRiser.base_unit}`
        : 'no article above the threshold',
    },
    {
      key: 'rising-spend', label: 'Spend on rising prices',
      value: risingShare === null ? '—' : formatPct1(risingShare),
      note:  risingShare === null
        ? 'no purchase in this period'
        : `${formatIdrCompact(risingSpend)} to renegotiate first`,
    },
  ];

  const meta = [
    periodLabel(start, end),
    `${formatCount(rows.length)} article${rows.length === 1 ? '' : 's'}`,
    'prices per base unit, vs the previous window of same length',
  ].join(' · ');

  const toolbar = (
    <>
      <PeriodControl period={period} />
      <label className="flex items-center gap-1.5 text-xs text-text-muted">
        <span>Supplier</span>
        <select
          value={supplierId}
          onChange={(e) => { setSupplierId(e.target.value); }}
          aria-label="Supplier filter"
          className={cn(selectClassName, 'h-8 w-auto')}
        >
          <option value="">All suppliers</option>
          {(suppliers ?? []).map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </label>
      <ExportMenu
        csv={{ rows, columns: csvColumns, filename: `purchase-price-trends-${start}_${end}` }}
        disabled={rows.length === 0}
      />
    </>
  );

  return (
    <ReportShell
      title="Purchase Price Trends"
      subtitle={meta}
      breadcrumb={[{ label: 'Reports', to: '/backoffice/reports' }, { label: 'Purchases' }]}
      toolbar={toolbar}
      error={trends.error}
      isEmpty={!trends.isLoading && trends.data !== undefined && rows.length === 0}
      emptyState={{
        title: 'No purchases',
        description: 'No purchase order line in the selected date range and supplier.',
      }}
      kpis={
        <KpiBand isLoading={trends.isLoading} tiles={tiles.length} labels={tiles.map((t) => t.label)}>
          {tiles.map((t, i) => (
            <KpiTile
              key={t.key}
              label={t.label}
              value={t.value}
              {...(t.title !== undefined ? { valueTitle: t.title } : {})}
              hero={i === 0}
              testId={`kpi-${t.key}`}
            >
              {/* Une HAUSSE est une mauvaise nouvelle sur un coût : invert. */}
              {t.delta !== undefined && <Delta value={t.delta} period="prev" invert onInk={i === 0} />}
              {t.note !== undefined && (
                <span className={i === 0 ? KPI_NOTE_HERO : KPI_NOTE}>{t.note}</span>
              )}
            </KpiTile>
          ))}
        </KpiBand>
      }
    >
      {/* Les réserves conditionnent la lecture de chaque chiffre de l'écran. */}
      <p
        className="rounded-sm border border-border-subtle bg-surface-4 px-3 py-2 text-xs text-text-secondary"
        data-testid="scope-caveat"
      >
        Prices are <strong>per base unit</strong> (purchase price ÷ unit conversion factor), so
        different pack sizes compare. Scope: purchase orders excluding drafts and cancellations,
        historical imports included, dated by <strong>order date</strong>. Δ compares the
        quantity-weighted average price with the previous window of the same length; an article
        without prior purchases shows as <em>new</em>.
      </p>

      <div className="mt-3 grid gap-3 xl:grid-cols-[1.7fr_1fr]">
        <PanelCard
          title={effectiveRow !== undefined
            ? `Unit price — ${effectiveRow.name} (per ${effectiveRow.base_unit})`
            : 'Unit price'}
          aside={<span className="text-xs text-text-muted">One dot per purchase order</span>}
          isLoading={trends.isLoading || points.isLoading}
          testId="chart-price-points"
        >
          {points.error !== null ? (
            <p role="alert" className="py-8 text-center text-sm text-danger">
              {points.error.message}
            </p>
          ) : chartData.length === 0 ? (
            <EmptyState
              icon={TrendingUp}
              size="sm"
              title="No purchase of this article"
              description="Pick another article in the table below, or widen the period."
            />
          ) : (
            <div
              className="h-72 w-full"
              role="img"
              aria-label={`Unit purchase price of ${effectiveRow?.name ?? 'the selected article'} over time, one line per supplier, one dot per purchase order.`}
            >
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke={CHART_GRID_STROKE} strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tick={TICK} tickLine={false} axisLine={{ stroke: CHART_AXIS_STROKE }} />
                  <YAxis
                    tick={TICK}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={formatIdrCompact}
                    width={68}
                    domain={['auto', 'auto']}
                  />
                  <Tooltip
                    contentStyle={CHART_TOOLTIP_STYLE}
                    // Coût UNITAIRE : les décimales portent du sens (prix au gramme).
                    formatter={(v: number, name: string) => [formatIdrPrecise(v), supplierNameOf(name)]}
                  />
                  {chartSuppliers.length > 1 && (
                    <Legend
                      wrapperStyle={{ fontSize: 12 }}
                      formatter={(value: string) => supplierNameOf(value)}
                    />
                  )}
                  {chartSuppliers.map((s) => (
                    <Line
                      key={s.key}
                      dataKey={s.key}
                      name={s.key}
                      stroke={s.color}
                      strokeWidth={2}
                      // ≥ 8 px de diamètre et un anneau couleur de carte — deux
                      // points voisins ne fusionnent pas (charte data-viz).
                      dot={{ r: 4, fill: s.color, stroke: 'var(--surface-3)', strokeWidth: 2 }}
                      connectNulls
                      isAnimationActive={!reduced}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </PanelCard>

        <PanelCard
          title="Spend by supplier"
          aside={supplierCount > MAX_BARS ? (
            <span className="text-xs text-text-muted">
              Top {MAX_BARS} of {formatCount(supplierCount)}
            </span>
          ) : undefined}
          isLoading={trends.isLoading}
          testId="chart-supplier-pareto"
        >
          <ParetoChart
            data={paretoRows}
            xKey="supplier"
            valueKey="spend"
            valueName="Spend"
            grandTotal={summary?.spend ?? 0}
            xTickFormatter={(v) => truncate(String(v))}
            ariaLabel={`Purchase spend per supplier, highest first, with the cumulative spend over the whole period from ${start} to ${end}.`}
          />
        </PanelCard>
      </div>

      <PanelCard
        title="Price per article"
        aside={<span className="text-xs text-text-muted">Pick an article to plot its purchases</span>}
        className="mt-3"
        isLoading={trends.isLoading}
        testId="ppt-article-table"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">
              Weighted average purchase price, variation and spend per article
            </caption>
            <thead>
              <tr className="border-b border-border-subtle text-text-secondary">
                <SortableTh label="Article"    sortKey="name"     sorted={sorted} />
                <SortableTh label="Unit"       sortKey="unit"     sorted={sorted} />
                <SortableTh label="Supplier"   sortKey="supplier" sorted={sorted} />
                <SortableTh label="POs"        sortKey="po"       sorted={sorted} align="right" />
                <SortableTh label="Last price" sortKey="last"     sorted={sorted} align="right" />
                <SortableTh label="Wavg price" sortKey="wavg"     sorted={sorted} align="right" />
                <SortableTh label="Δ vs prev"  sortKey="delta"    sorted={sorted} align="right" />
                <SortableTh label="Spend"      sortKey="spend"    sorted={sorted} align="right" />
              </tr>
            </thead>
            <tbody>
              {sorted.rows.map((r) => (
                <tr
                  key={r.product_id}
                  className={cn(
                    'border-b border-border-subtle',
                    r.product_id === effectiveId && 'bg-surface-4',
                  )}
                >
                  <td className="py-2">
                    {/* Le drill-down de CE rapport, ce sont les points de prix
                        — le graphe au-dessus, pas une autre page. */}
                    <button
                      type="button"
                      onClick={() => { setSelectedId(r.product_id); }}
                      data-testid={`plot-${r.product_id}`}
                      className={cn(
                        'rounded-sm text-left text-gold underline-offset-2 hover:underline',
                        FOCUS_RING,
                      )}
                    >
                      {r.name}
                    </button>
                  </td>
                  <td className="py-2 text-text-secondary">{r.base_unit || '—'}</td>
                  <td className="py-2 text-text-secondary">{r.last_supplier.name ?? '—'}</td>
                  <td className={NUM_CELL}>{formatCount(r.po_count)}</td>
                  <td className={NUM_CELL} title={formatIdrPrecise(r.last_price)}>
                    {formatIdrFull(r.last_price)}
                  </td>
                  <td className={NUM_CELL} title={formatIdrPrecise(r.wavg_price)}>
                    {formatIdrFull(r.wavg_price)}
                  </td>
                  <td className={NUM_CELL}>
                    {r.delta_pct === null
                      ? <span className="text-text-inert">new</span>
                      : <Delta value={r.delta_pct} invert />}
                  </td>
                  <td className={NUM_CELL}>{formatIdrFull(r.spend)}</td>
                </tr>
              ))}
            </tbody>
            {sorted.rows.length > 0 && summary !== undefined && (
              <tfoot>
                <tr className="border-t border-border-subtle font-semibold">
                  <td className="py-2">Total</td>
                  <td /><td />
                  {/* PAS la somme de la colonne : un PO couvre plusieurs
                      articles, la somme des comptes par article la dépasserait.
                      Le compte DISTINCT vit dans la tuile de dépense. */}
                  <td />
                  <td /><td />
                  <td className={NUM_CELL}>
                    {inflation === null ? '—' : fmtSignedPct(inflation)}
                  </td>
                  <td className={NUM_CELL}>{formatIdrFull(summary.spend)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </PanelCard>
    </ReportShell>
  );
}
