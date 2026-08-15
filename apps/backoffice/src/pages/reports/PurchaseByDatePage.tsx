// apps/backoffice/src/pages/reports/PurchaseByDatePage.tsx
//
// Lot F (campagne Reports 2026-08-15) — vague Inventory, page 9/10. Migrée sur
// le socle Report shell v2 (archétype maquette 4c, patron : DailySalesPage).
//
// CE QUI NE CHANGE PAS : résumé et série journalière viennent de
// `get_purchase_by_date_v1` ; rien n'est recalculé ici hormis les deux sommes de
// valeur reçue / en attente, qui ne sont que des additions de la série servie.
//
// Ce qui change :
//  1. La rangée de quatre encadrés maison devient la BANDE DE KPI du socle, et
//     la comparaison est méritée sur un écran d'engagement de dépense : chaque
//     tuile porte sa variation contre la période précédente, et la HAUSSE DE
//     L'EN-ATTENTE est une mauvaise nouvelle (`invert`) — c'est de la
//     marchandise payée-ou-promise qui n'est pas encore entrée.
//  2. L'AIRE EMPILÉE devient des barres appariées. Deux raisons distinctes :
//     une aire INTERPOLE entre deux jours et donne à lire une valeur au milieu
//     d'un segment, qui n'existe pas (il n'y a que des relevés journaliers) ; et
//     l'axe porte désormais la période COURANTE face à la PRÉCÉDENTE, la
//     lecture que la page promettait sans la servir.
//     Le partage reçu / en attente n'est pas perdu : il vit dans deux tuiles de
//     la bande et dans les deux colonnes de la table, qui restent.
//     Un jour sans bon de commande vaut bien ZÉRO ici — c'est un montant, et
//     rien n'a été engagé.
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
import { PairedBarsChart } from '@/features/reports/components/charts/PairedBarsChart.js';
import { useReportPeriod } from '@/features/reports/hooks/useReportPeriod.js';
import { formatIdrCompact, formatIdrFull } from '@/features/reports/utils/chartColors.js';
import {
  eachDay, formatCount, pctChange, periodLabel, shortDate,
} from '@/features/reports/utils/reportFigures.js';
import {
  usePurchaseByDate, type PurchaseByDayRow,
} from '@/features/reports/hooks/usePurchaseByDate.js';

const csvColumns: CsvColumn<PurchaseByDayRow>[] = [
  { header: 'Date',           accessor: (r) => r.date,           format: 'text' },
  { header: 'POs',            accessor: (r) => r.po_count,       format: 'number' },
  { header: 'Total (IDR)',    accessor: (r) => r.total,          format: 'idr-round100' },
  { header: 'Received (IDR)', accessor: (r) => r.received_total, format: 'idr-round100' },
  { header: 'Pending (IDR)',  accessor: (r) => r.pending_total,  format: 'idr-round100' },
];

const NUM_CELL = 'py-2 text-right font-data tabular-nums';

interface DailyPoint {
  date:    string;
  current: number;
  compare: number;
  [k: string]: string | number;
}

/** Série journalière alignée : la comparaison suit le RANG du jour dans sa
 *  propre fenêtre, jamais sa date. */
function buildDaily(
  start: string, end: string,
  cmpStart: string, cmpEnd: string,
  cur: PurchaseByDayRow[], prev: PurchaseByDayRow[],
): DailyPoint[] {
  const cmpDays = eachDay(cmpStart, cmpEnd);
  const curMap = new Map(cur.map((d) => [d.date, d.total]));
  const cmpMap = new Map(prev.map((d) => [d.date, d.total]));
  return eachDay(start, end).map((d, i) => ({
    date:    d,
    current: curMap.get(d) ?? 0,
    compare: cmpMap.get(cmpDays[i] ?? '') ?? 0,
  }));
}

const sum = (rows: PurchaseByDayRow[], pick: (r: PurchaseByDayRow) => number): number =>
  rows.reduce((s, r) => s + pick(r), 0);

interface KpiDescriptor {
  key: string; label: string; value: string; title?: string;
  delta?: number | null; invert?: boolean; note?: string | undefined;
}

export default function PurchaseByDatePage(): JSX.Element {
  const period = useReportPeriod();
  const { start, end, compareRange } = period;

  const current = usePurchaseByDate({ start, end });
  const compare = usePurchaseByDate({ start: compareRange.start, end: compareRange.end });

  const data     = current.data;
  const prevData = compare.data;
  const showCompareSeries = period.compare && prevData !== undefined;

  // `?? []` rend un tableau NEUF à chaque render : posé tel quel en dépendance
  // d'un `useMemo`, il en casse la mémoïsation à chaque fois (c'est la classe de
  // bug R-01, où une dépendance instable relançait la requête en boucle).
  const rows     = useMemo(() => data?.by_day ?? [],     [data?.by_day]);
  const prevRows = useMemo(() => prevData?.by_day ?? [], [prevData?.by_day]);
  const summary  = data?.summary;
  const prev     = prevData?.summary;

  const receivedValue = sum(rows, (r) => r.received_total);
  const pendingValue  = sum(rows, (r) => r.pending_total);
  const prevReceived  = prevData !== undefined ? sum(prevRows, (r) => r.received_total) : undefined;
  const prevPending   = prevData !== undefined ? sum(prevRows, (r) => r.pending_total)  : undefined;

  const daily = useMemo(
    () => buildDaily(start, end, compareRange.start, compareRange.end, rows, prevRows),
    [start, end, compareRange.start, compareRange.end, rows, prevRows],
  );

  const tiles: KpiDescriptor[] = [
    {
      key: 'total', label: 'Ordered value',
      value: formatIdrCompact(summary?.total ?? 0),
      title: formatIdrFull(summary?.total ?? 0),
      delta: pctChange(summary?.total ?? 0, prev?.total),
      note:  `${formatCount(rows.length)} ordering day${rows.length === 1 ? '' : 's'}`,
    },
    {
      key: 'po-count', label: 'Purchase orders',
      value: formatCount(summary?.po_count ?? 0),
      delta: pctChange(summary?.po_count ?? 0, prev?.po_count),
    },
    {
      key: 'received-count', label: 'Received',
      value: formatCount(summary?.received_count ?? 0),
      delta: pctChange(summary?.received_count ?? 0, prev?.received_count),
      note:  'orders fully in',
    },
    {
      // Une hausse de l'en-attente est une mauvaise nouvelle : de la marchandise
      // engagée qui n'est pas entrée.
      key: 'pending-count', label: 'Pending',
      value: formatCount(summary?.pending_count ?? 0),
      delta: pctChange(summary?.pending_count ?? 0, prev?.pending_count), invert: true,
      note:  'orders still open',
    },
    {
      key: 'received-value', label: 'Received value',
      value: formatIdrCompact(receivedValue), title: formatIdrFull(receivedValue),
      delta: pctChange(receivedValue, prevReceived),
    },
    {
      key: 'pending-value', label: 'Pending value',
      value: formatIdrCompact(pendingValue), title: formatIdrFull(pendingValue),
      delta: pctChange(pendingValue, prevPending), invert: true,
    },
  ];

  const toolbar = (
    <>
      <PeriodControl period={period} showCompare />
      <ExportMenu
        csv={{ rows, columns: csvColumns, filename: `purchase-by-date-${start}_${end}` }}
        disabled={rows.length === 0}
      />
    </>
  );

  return (
    <ReportShell
      title="Purchase by Date"
      subtitle={`${periodLabel(start, end)} · purchase order volume and value by order date`}
      breadcrumb={[{ label: 'Reports', to: '/backoffice/reports' }, { label: 'Inventory' }]}
      toolbar={toolbar}
      error={current.error}
      isEmpty={!current.isLoading && data !== undefined && rows.length === 0}
      emptyState={{
        title: 'No purchase orders',
        description: 'No purchase order for this period.',
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
      <PanelCard
        title="Ordered value by day"
        subtitle="Value engaged each day, against the same rank in the previous period."
        isLoading={current.isLoading}
        testId="chart-purchase-by-day"
      >
        <PairedBarsChart
          data={daily}
          xKey="date"
          currentKey="current"
          currentName="This period"
          {...(showCompareSeries ? { compareKey: 'compare', compareName: 'Previous period' } : {})}
          xTickFormatter={(v) => shortDate(String(v))}
          ariaLabel={`Purchase order value per day, current period compared with the previous one, ${start} to ${end}.`}
        />
      </PanelCard>

      <PanelCard
        title="Day by day"
        className="mt-3"
        subtitle="The received / pending split the chart does not carry."
        isLoading={current.isLoading}
        testId="purchase-by-date-table"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">
              Order count, total, received and pending value per day
            </caption>
            <thead>
              <tr className="border-b border-border-subtle text-text-secondary">
                <th scope="col" className="py-2 text-left">Date</th>
                <th scope="col" className="py-2 text-right">POs</th>
                <th scope="col" className="py-2 text-right">Total</th>
                <th scope="col" className="py-2 text-right">Received total</th>
                <th scope="col" className="py-2 text-right">Pending total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.date} className="border-b border-border-subtle">
                  <td className="py-2 font-data text-xs text-text-secondary">{r.date}</td>
                  <td className={NUM_CELL}>{formatCount(r.po_count)}</td>
                  <td className={NUM_CELL}>{formatIdrFull(r.total)}</td>
                  <td className={NUM_CELL}>{formatIdrFull(r.received_total)}</td>
                  <td className={NUM_CELL}>{formatIdrFull(r.pending_total)}</td>
                </tr>
              ))}
            </tbody>
            {rows.length > 0 && summary !== undefined && (
              <tfoot>
                <tr className="border-t border-border-subtle font-semibold">
                  <td className="py-2">Total</td>
                  <td className={NUM_CELL}>{formatCount(summary.po_count)}</td>
                  <td className={NUM_CELL}>{formatIdrFull(summary.total)}</td>
                  <td className={NUM_CELL}>{formatIdrFull(receivedValue)}</td>
                  <td className={NUM_CELL}>{formatIdrFull(pendingValue)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </PanelCard>
    </ReportShell>
  );
}
