// apps/backoffice/src/pages/reports/WastagePage.tsx
//
// Lot F (campagne Reports 2026-08-15) — vague Inventory, page 1/10. Migrée sur
// le socle Report shell v2 (archétype maquette 4c, patron : DailySalesPage).
//
// CE QUI NE CHANGE PAS : les montants viennent de `get_wastage_report_v2` —
// total, ventilation manuel/péremption et `by_product` sont servis tels quels.
// Aucune perte n'est re-valorisée ici. La bannière de troncature (500 lignes de
// détail côté serveur) reste, et elle continue de dire que le TOTAL, lui,
// couvre toute la période.
//
// Ce qui change :
//  1. `lot_id` / `lot_batch_number` / `reason` sont ENFIN AFFICHÉS. Le hook les
//     câble depuis le lot A1 et la page les jetait, alors que la tuile du hub
//     promet « manual waste + auto spoilage by product & lot ». Le motif ouvre
//     une carte de ventilation, le lot prend une colonne dans la table : sans
//     eux, l'écran disait COMBIEN on perd sans jamais dire POURQUOI.
//  2. La table « By product », qui rangeait des barres proportionnelles au pire
//     produit, devient un PARETO. La question d'un écran de pertes est « qu'est-
//     ce qui pèse » : les barres triées et la courbe de cumul y répondent d'un
//     coup d'œil, une barre relative au maximum ne répond à rien.
//     Le cumul se rapporte au jeu COMPLET (`grandTotal`) et non aux barres
//     affichées : huit produits sur quarante refermeraient leur courbe à 100 %,
//     ce qui dirait « ces huit font toute la perte ».
//  3. La comparaison est méritée sur un écran de pertes — chaque tuile porte sa
//     variation contre la période précédente, la HAUSSE en rouge (`invert`).
//
// Params URL : `start` / `end` / `cmp` — les bornes portaient déjà les noms du
// socle, aucun repli legacy n'est nécessaire.

import { useMemo, type JSX } from 'react';
import type { CsvColumn } from '@breakery/domain';
import { PanelCard } from '@/components/PanelCard.js';
import { KpiTile, KPI_NOTE, KPI_NOTE_HERO } from '@/components/kpi/KpiTile.js';
import { Delta } from '@/components/kpi/Delta.js';
import { ReportShell } from '@/features/reports/components/ReportShell.js';
import { KpiBand } from '@/features/reports/components/KpiBand.js';
import { PeriodControl } from '@/features/reports/components/PeriodControl.js';
import { ExportMenu } from '@/features/reports/components/ExportMenu.js';
import {
  BreakdownCard, type BreakdownRow, type ShareSegment,
} from '@/features/reports/components/BreakdownCard.js';
import { ParetoChart } from '@/features/reports/components/charts/ParetoChart.js';
import { DrilldownLink } from '@/features/reports/components/DrilldownLink.js';
import { useReportPeriod } from '@/features/reports/hooks/useReportPeriod.js';
import {
  COGS_BASE, OPEX_BASE, familyColor, formatIdrCompact, formatIdrFull,
} from '@/features/reports/utils/chartColors.js';
import {
  formatCount, formatPct1, pctChange, periodLabel, sharePct, topSlice,
} from '@/features/reports/utils/reportFigures.js';
import {
  useWastageReport,
  type WastageByProductRow,
  type WastageReportLine,
} from '@/features/reports/hooks/useWastageReport.js';

/** Barres du Pareto. Au-delà, les noms de produit se chevauchent sur l'axe —
 *  et le cumul reste juste puisqu'il se rapporte au total du jeu complet. */
const PARETO_BARS = 8;

const csvColumns: CsvColumn<WastageReportLine>[] = [
  { header: 'Product',    accessor: (r) => r.product_name, format: 'text' },
  { header: 'Type',       accessor: (r) => r.type,         format: 'text' },
  { header: 'Qty',        accessor: (r) => r.qty,          format: 'number' },
  { header: 'Value (IDR)', accessor: (r) => r.value,       format: 'idr-round100' },
  { header: 'Date',       accessor: (r) => r.created_at,   format: 'datetime' },
];

const NUM_CELL = 'py-2 text-right font-data tabular-nums';

interface ReasonRow { key: string; label: string; value: number; count: number }

/**
 * Ventilation des lignes par MOTIF. Un motif absent n'est pas un motif « autre »
 * — c'est une saisie sans explication, et le libellé le dit : c'est justement
 * ce que le gérant doit pouvoir repérer.
 */
function byReason(lines: WastageReportLine[]): ReasonRow[] {
  const acc = new Map<string, ReasonRow>();
  for (const l of lines) {
    // `typeof` et non `!== null` : le champ est typé `string | null`, mais une
    // ligne d'un payload plus ancien ne porte pas la clé du tout — `undefined`
    // passe un test de nullité stricte et fait exploser le `.trim()`.
    const label = typeof l.reason === 'string' && l.reason.trim() !== ''
      ? l.reason
      : 'No reason given';
    const cur = acc.get(label) ?? { key: label, label, value: 0, count: 0 };
    cur.value += l.value;
    cur.count += 1;
    acc.set(label, cur);
  }
  return [...acc.values()].sort((a, b) => b.value - a.value);
}

/** Nom raccourci pour l'axe du Pareto — un libellé long y passe en travers. */
function shortName(name: string): string {
  return name.length > 13 ? `${name.slice(0, 12)}…` : name;
}

interface KpiDescriptor {
  key: string; label: string; value: string; title?: string;
  delta?: number | null; invert?: boolean; note?: string | undefined;
}

export default function WastagePage(): JSX.Element {
  const period = useReportPeriod();
  const { start, end, compareRange } = period;

  const current = useWastageReport({ start, end });
  const compare = useWastageReport({ start: compareRange.start, end: compareRange.end });

  const data     = current.data;
  const prevData = compare.data;
  const showDelta = period.compare && prevData !== undefined;

  const lines     = useMemo(() => data?.lines ?? [], [data?.lines]);
  const byProduct = useMemo(
    () => (data?.by_product ?? []).slice().sort((a, b) => b.total_value - a.total_value),
    [data?.by_product],
  );

  const totalValue    = data?.total_value ?? 0;
  const manualValue   = data?.manual_value ?? 0;
  const spoilageValue = data?.spoilage_value ?? 0;
  const truncated     = data?.truncated === true;

  // Le Pareto affiche une COUPE et totalise le jeu complet : `grandTotal` porte
  // la somme de tous les produits, pas celle des huit barres.
  const paretoTotal = byProduct.reduce((s, r) => s + r.total_value, 0);
  const paretoData  = useMemo(
    () => byProduct.slice(0, PARETO_BARS).map((r) => ({
      name:  shortName(r.product_name),
      value: r.total_value,
    })),
    [byProduct],
  );

  const reasons    = useMemo(() => byReason(lines), [lines]);
  const reasonTop  = topSlice(reasons, (r) => r.value, 'value lost');
  const reasonRows: BreakdownRow[] = reasonTop.rows.map((r, i) => ({
    key: r.key, label: r.label, amount: r.value,
    sharePct: sharePct(r.value, reasonTop.total),
    color: familyColor('opex', i),
    count: `${formatCount(r.count)}×`,
  }));

  // Manuel vs péremption : deux familles de perte qui ne se lisent pas pareil —
  // l'une est un geste, l'autre une conséquence du temps.
  const splitSegments: ShareSegment[] = [
    { label: 'Manual',   pct: sharePct(manualValue,   totalValue), color: OPEX_BASE },
    { label: 'Spoilage', pct: sharePct(spoilageValue, totalValue), color: COGS_BASE },
  ].filter((s) => s.pct > 0);

  const worst: WastageByProductRow | undefined = byProduct[0];

  const pctOfTotal = (n: number): string | undefined =>
    totalValue > 0 ? `${formatPct1(sharePct(n, totalValue))} of total` : undefined;

  const prevProductCount = prevData?.by_product.length;

  const tiles: KpiDescriptor[] = [
    {
      key: 'total', label: 'Total wasted',
      value: formatIdrCompact(totalValue), title: formatIdrFull(totalValue),
      delta: pctChange(totalValue, prevData?.total_value), invert: true,
      note: `${formatCount(byProduct.length)} product${byProduct.length === 1 ? '' : 's'} affected`,
    },
    {
      key: 'manual', label: 'Manual waste',
      value: formatIdrCompact(manualValue), title: formatIdrFull(manualValue),
      delta: pctChange(manualValue, prevData?.manual_value), invert: true,
      note: pctOfTotal(manualValue),
    },
    {
      key: 'spoilage', label: 'Auto spoilage',
      value: formatIdrCompact(spoilageValue), title: formatIdrFull(spoilageValue),
      delta: pctChange(spoilageValue, prevData?.spoilage_value), invert: true,
      note: pctOfTotal(spoilageValue),
    },
    {
      key: 'products', label: 'Products affected',
      value: formatCount(byProduct.length),
      delta: pctChange(byProduct.length, prevProductCount), invert: true,
    },
    {
      // Le pire produit n'a pas de variation : d'une période à l'autre ce n'est
      // pas le même produit, et comparer deux grandeurs qui ne désignent pas la
      // même chose serait un faux.
      key: 'worst', label: 'Worst product',
      value: formatIdrCompact(worst?.total_value ?? 0),
      title: formatIdrFull(worst?.total_value ?? 0),
      note: worst?.product_name ?? 'nothing wasted',
    },
    {
      key: 'events', label: 'Waste events',
      value: formatCount(lines.length),
      note: truncated ? 'first 500 shown' : undefined,
    },
  ];

  const meta = [
    periodLabel(start, end),
    'manual waste and auto spoilage, by product, lot and reason',
  ].join(' · ');

  const toolbar = (
    <>
      <PeriodControl period={period} showCompare />
      <ExportMenu
        csv={{ rows: lines, columns: csvColumns, filename: `wastage-${start}_${end}` }}
        {...(data !== undefined
          ? {
              pdf: {
                template: 'wastage' as const,
                data,
                period: { start, end },
                filename: `wastage-${start}_${end}`,
              },
            }
          : {})}
        disabled={data === undefined || lines.length === 0}
      />
    </>
  );

  return (
    <ReportShell
      title="Wastage"
      subtitle={meta}
      breadcrumb={[{ label: 'Reports', to: '/backoffice/reports' }, { label: 'Inventory' }]}
      toolbar={toolbar}
      error={current.error}
      isEmpty={!current.isLoading && data !== undefined && lines.length === 0 && totalValue === 0}
      emptyState={{
        title: 'No wastage',
        description: 'No waste and no spoilage recorded for this period.',
      }}
      kpis={
        <KpiBand isLoading={current.isLoading} tiles={tiles.length} labels={tiles.map((t) => t.label)}>
          {tiles.map((t, i) => (
            <KpiTile
              key={t.key}
              label={t.label}
              value={t.value}
              {...(t.title !== undefined ? { valueTitle: t.title } : {})}
              hero={i === 0}
              testId={`kpi-${t.key}`}
            >
              {t.delta !== undefined && (
                <Delta value={t.delta} period="prev" invert={t.invert === true} onInk={i === 0} />
              )}
              {t.note !== undefined && (
                <span className={i === 0 ? KPI_NOTE_HERO : KPI_NOTE}>{t.note}</span>
              )}
            </KpiTile>
          ))}
        </KpiBand>
      }
    >
      {truncated && (
        <p
          className="rounded-sm border border-warning bg-warning-soft px-4 py-2 text-sm text-warning"
          role="status"
          data-testid="wastage-truncated-banner"
        >
          First 500 lines shown — narrow the date range to see them all. The total
          above still covers the whole period.
        </p>
      )}

      <div className="mt-3 grid gap-3 xl:grid-cols-[1.7fr_1fr]">
        <PanelCard
          title="What weighs"
          subtitle={byProduct.length > PARETO_BARS
            ? `Top ${PARETO_BARS} of ${formatCount(byProduct.length)} products by value lost — the cumulative line runs against the full period.`
            : 'Products ranked by value lost, with the cumulative share.'}
          aside={showDelta ? (
            <span className="text-xs text-text-muted">
              prev. total {formatIdrCompact(prevData?.total_value ?? 0)}
            </span>
          ) : undefined}
          isLoading={current.isLoading}
          testId="chart-wastage-pareto"
        >
          {paretoData.length > 0 ? (
            <ParetoChart
              data={paretoData}
              xKey="name"
              valueKey="value"
              valueName="Value lost"
              grandTotal={paretoTotal}
              ariaLabel={`Products ranked by wastage value with a cumulative line, ${start} to ${end}.`}
            />
          ) : (
            <p className="py-2 text-xs text-text-muted">No product-level wastage in this period.</p>
          )}
        </PanelCard>

        <BreakdownCard
          title="By reason"
          subtitle={reasonTop.note
            ?? 'Why the stock was written off, across the listed lines.'}
          variant="track"
          rows={reasonRows}
          total={{ label: 'Listed lines', amount: reasonTop.total }}
          isLoading={current.isLoading}
          shareBar={{
            title:     'Manual vs spoilage',
            ariaLabel: 'Share of wastage value between manual waste and auto spoilage',
            segments:  splitSegments,
          }}
          shareBarPlacement="after-total"
          emptyText="No wastage line to ventilate for this period."
          testId="breakdown-wastage-reasons"
        />
      </div>

      <PanelCard
        title="Wastage lines"
        className="mt-3"
        subtitle="Every write-off of the period, with its lot and its reason."
        isLoading={current.isLoading}
        testId="wastage-lines"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">
              Product, lot, type, reason, quantity, value and date per wastage line
            </caption>
            <thead>
              <tr className="border-b border-border-subtle text-text-secondary">
                <th scope="col" className="py-2 text-left">Product</th>
                <th scope="col" className="py-2 text-left">Lot</th>
                <th scope="col" className="py-2 text-left">Type</th>
                <th scope="col" className="py-2 text-left">Reason</th>
                <th scope="col" className="py-2 text-right">Qty</th>
                <th scope="col" className="py-2 text-right">Value</th>
                <th scope="col" className="py-2 text-left">Date</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((r) => (
                <tr key={r.id} className="border-b border-border-subtle">
                  <td className="py-2 font-medium">
                    <DrilldownLink entity="product" id={r.product_id} label={r.product_name} icon={false} />
                  </td>
                  {/* Un lot absent n'est pas une donnée manquante : les produits
                      non lotés n'en portent jamais. Tiret, pas d'alerte. */}
                  <td className="py-2 font-data text-xs text-text-secondary">
                    {typeof r.lot_batch_number === 'string' && r.lot_batch_number !== ''
                      ? r.lot_batch_number
                      : '—'}
                  </td>
                  <td className="py-2 text-text-secondary">{r.type}</td>
                  <td
                    className="max-w-[18rem] truncate py-2 text-xs text-text-secondary"
                    title={typeof r.reason === 'string' ? r.reason : undefined}
                  >
                    {typeof r.reason === 'string' && r.reason !== '' ? r.reason : '—'}
                  </td>
                  <td className={NUM_CELL}>{formatCount(r.qty)}</td>
                  <td className={NUM_CELL}>{formatIdrFull(r.value)}</td>
                  <td className="py-2 font-data text-xs text-text-secondary">{r.created_at.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
            {lines.length > 0 && (
              <tfoot>
                <tr className="border-t border-border-subtle font-semibold">
                  {/* Le total est celui de la PÉRIODE, pas celui des lignes
                      listées — la bannière de troncature le dit aussi. */}
                  <td className="py-2" colSpan={5}>Total wastage value (whole period)</td>
                  <td className={NUM_CELL}>{formatIdrFull(totalValue)}</td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </PanelCard>
    </ReportShell>
  );
}
