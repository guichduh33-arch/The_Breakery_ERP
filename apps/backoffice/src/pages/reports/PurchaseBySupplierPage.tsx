// apps/backoffice/src/pages/reports/PurchaseBySupplierPage.tsx
//
// Lot F (campagne Reports 2026-08-15) — vague Inventory, page 10/10. Migrée sur
// le socle Report shell v2 (archétype maquette 4c, patron : DailySalesPage).
//
// CE QUI NE CHANGE PAS : les lignes viennent de `get_purchase_by_supplier_v1` ;
// la PART (`share_pct`) est celle du SERVEUR et non une part recalculée sur les
// lignes affichées. Page terminale — il n'y a pas de drill-down fournisseur
// (décision documentée : la Wave C possède ce routage).
//
// Ce qui change :
//  1. LE DONUT DEVIENT UNE CARTE DE VENTILATION à pistes. Un anneau force à
//     comparer des angles, réclame une légende pour dire quel arc est quel
//     fournisseur, et devient illisible dès que trois d'entre eux pèsent moins
//     de 5 %. La carte pose libellé, part et montant sur la même ligne :
//     l'identité ne repose plus sur la couleur. Même arbitrage qu'au lot E pour
//     les deux donuts de Cost & Spend Analytics — `CostDonut` n'a plus de
//     consommateur après cette page et disparaît avec elle.
//  2. La comparaison est méritée sur un écran de dépense fournisseur : chaque
//     tuile porte sa variation contre la période précédente, et la hausse des
//     ANNULATIONS comme celle du DÉLAI sont de mauvaises nouvelles (`invert`).
//
// PAS DE GRAPHE : la lecture est un CLASSEMENT de parts étiquetées, que la carte
// sert mieux qu'un axe. La série temporelle de l'achat vit dans Purchase by
// Date, qui en porte le graphe.
//
// Params URL : `start` / `end` / `cmp` — les bornes portaient déjà les noms du
// socle, aucun repli legacy n'est nécessaire.

import { useMemo, type JSX } from 'react';
import type { CsvColumn } from '@breakery/domain';
import { formatNumber, formatPercent } from '@breakery/utils';
import { PanelCard } from '@/components/PanelCard.js';
import { KpiTile, KPI_NOTE, KPI_NOTE_HERO } from '@/components/kpi/KpiTile.js';
import { Delta } from '@/components/kpi/Delta.js';
import { ReportShell } from '@/features/reports/components/ReportShell.js';
import { KpiBand } from '@/features/reports/components/KpiBand.js';
import { PeriodControl } from '@/features/reports/components/PeriodControl.js';
import { ExportMenu } from '@/features/reports/components/ExportMenu.js';
import { BreakdownCard, type BreakdownRow } from '@/features/reports/components/BreakdownCard.js';
import { useReportPeriod } from '@/features/reports/hooks/useReportPeriod.js';
import { categoricalColor, formatIdrCompact, formatIdrFull } from '@/features/reports/utils/chartColors.js';
import {
  formatCount, pctChange, periodLabel, topSlice,
} from '@/features/reports/utils/reportFigures.js';
import {
  usePurchaseBySupplier, type PurchaseBySupplierRow,
} from '@/features/reports/hooks/usePurchaseBySupplier.js';

const csvColumns: CsvColumn<PurchaseBySupplierRow>[] = [
  { header: 'Supplier',       accessor: (r) => r.supplier_name,          format: 'text' },
  { header: 'POs',            accessor: (r) => r.po_count,               format: 'number' },
  { header: 'Total (IDR)',    accessor: (r) => r.total,                  format: 'idr-round100' },
  { header: 'Received',       accessor: (r) => r.received_count,         format: 'number' },
  { header: 'Cancelled',      accessor: (r) => r.cancelled_count,        format: 'number' },
  { header: 'Avg lead days',  accessor: (r) => r.avg_lead_days,          format: 'number' },
  { header: 'Share (%)',      accessor: (r) => r.share_pct / 100,        format: 'percent' },
];

const NUM_CELL = 'py-2 text-right font-data tabular-nums';

const sum = (rows: PurchaseBySupplierRow[], pick: (r: PurchaseBySupplierRow) => number): number =>
  rows.reduce((s, r) => s + pick(r), 0);

/**
 * Délai moyen PONDÉRÉ PAR LES COMMANDES. Une moyenne de moyennes donnerait le
 * même poids à un fournisseur livré une fois qu'à celui livré quarante fois.
 * `null` quand aucun fournisseur ne porte de délai — un zéro dirait « livré le
 * jour même », ce que personne n'a mesuré.
 */
function weightedLeadDays(rows: PurchaseBySupplierRow[]): number | null {
  let acc = 0;
  let weight = 0;
  for (const r of rows) {
    if (r.avg_lead_days === null || r.po_count <= 0) continue;
    acc += r.avg_lead_days * r.po_count;
    weight += r.po_count;
  }
  return weight === 0 ? null : acc / weight;
}

interface KpiDescriptor {
  key: string; label: string; value: string; title?: string;
  delta?: number | null; unit?: 'pct' | 'pt'; invert?: boolean; note?: string | undefined;
}

export default function PurchaseBySupplierPage(): JSX.Element {
  const period = useReportPeriod();
  const { start, end, compareRange } = period;

  const current = usePurchaseBySupplier({ start, end });
  const compare = usePurchaseBySupplier({ start: compareRange.start, end: compareRange.end });

  const data     = current.data;
  const prevData = compare.data;

  const rows     = useMemo(() => data?.by_supplier ?? [], [data]);
  const prevRows = prevData?.by_supplier ?? [];

  const ranked = useMemo(() => rows.slice().sort((a, b) => b.total - a.total), [rows]);
  const top    = topSlice(ranked, (r) => r.total, 'purchased value');
  const supplierRows: BreakdownRow[] = top.rows.map((r, i) => ({
    key: r.supplier_id || r.supplier_name,
    label: r.supplier_name,
    amount: r.total,
    // La part est celle du SERVEUR : elle porte la période entière, pas la
    // coupe d'affichage.
    sharePct: r.share_pct,
    color: categoricalColor(i),
    count: `${formatCount(r.po_count)} PO`,
  }));

  const totalValue = sum(rows, (r) => r.total);
  const poCount    = sum(rows, (r) => r.po_count);
  const received   = sum(rows, (r) => r.received_count);
  const cancelled  = sum(rows, (r) => r.cancelled_count);
  const leadDays   = weightedLeadDays(rows);

  const hasPrev       = prevData !== undefined;
  const prevTotal     = hasPrev ? sum(prevRows, (r) => r.total)           : undefined;
  const prevPoCount   = hasPrev ? sum(prevRows, (r) => r.po_count)        : undefined;
  const prevReceived  = hasPrev ? sum(prevRows, (r) => r.received_count)  : undefined;
  const prevCancelled = hasPrev ? sum(prevRows, (r) => r.cancelled_count) : undefined;
  const prevLeadDays  = hasPrev ? weightedLeadDays(prevRows)              : null;

  const tiles: KpiDescriptor[] = [
    {
      key: 'total', label: 'Purchased value',
      value: formatIdrCompact(totalValue), title: formatIdrFull(totalValue),
      delta: pctChange(totalValue, prevTotal),
      note:  `${formatCount(rows.length)} supplier${rows.length === 1 ? '' : 's'}`,
    },
    {
      key: 'suppliers', label: 'Suppliers',
      value: formatCount(rows.length),
      delta: pctChange(rows.length, hasPrev ? prevRows.length : undefined),
    },
    {
      key: 'po-count', label: 'Purchase orders',
      value: formatCount(poCount),
      delta: pctChange(poCount, prevPoCount),
    },
    {
      key: 'received', label: 'Received',
      value: formatCount(received),
      delta: pctChange(received, prevReceived),
      note:  poCount > 0 ? `of ${formatCount(poCount)} orders` : undefined,
    },
    {
      key: 'cancelled', label: 'Cancelled',
      value: formatCount(cancelled),
      delta: pctChange(cancelled, prevCancelled), invert: true,
    },
    {
      // Un délai se compare en JOURS, pas en pour-cent de jours : `unit: 'pt'`
      // rend l'écart tel quel.
      key: 'lead', label: 'Avg lead time',
      value: leadDays === null ? '—' : `${formatNumber(leadDays, { digits: 1 })} d`,
      delta: leadDays !== null && prevLeadDays !== null ? leadDays - prevLeadDays : null,
      unit:  'pt', invert: true,
      note:  'days, weighted by orders',
    },
  ];

  const toolbar = (
    <>
      <PeriodControl period={period} showCompare />
      <ExportMenu
        csv={{ rows, columns: csvColumns, filename: `purchase-by-supplier-${start}_${end}` }}
        disabled={rows.length === 0}
      />
    </>
  );

  return (
    <ReportShell
      title="Purchase by Supplier"
      subtitle={`${periodLabel(start, end)} · purchase volume, value and lead time per supplier`}
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
                <Delta
                  value={t.delta}
                  unit={t.unit ?? 'pct'}
                  period="prev"
                  invert={t.invert === true}
                  onInk={i === 0}
                />
              )}
              {t.note !== undefined && (
                <span className={i === 0 ? KPI_NOTE_HERO : KPI_NOTE}>{t.note}</span>
              )}
            </KpiTile>
          ))}
        </KpiBand>
      }
    >
      <BreakdownCard
        title="Spend by supplier"
        subtitle={top.note ?? 'Share of the purchased value over the period.'}
        variant="track"
        rows={supplierRows}
        total={{ label: 'Total purchased', amount: top.total }}
        isLoading={current.isLoading}
        emptyText="No purchase order to ventilate for this period."
        testId="breakdown-purchase-suppliers"
      />

      <PanelCard
        title="Per supplier"
        className="mt-3"
        subtitle="Orders, reliability and lead time — the columns the card does not carry."
        isLoading={current.isLoading}
        testId="purchase-by-supplier-table"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">
              Order count, value, received and cancelled counts, average lead days and share per supplier
            </caption>
            <thead>
              <tr className="border-b border-border-subtle text-text-secondary">
                <th scope="col" className="py-2 text-left">Supplier</th>
                <th scope="col" className="py-2 text-right">POs</th>
                <th scope="col" className="py-2 text-right">Total</th>
                <th scope="col" className="py-2 text-right">Received</th>
                <th scope="col" className="py-2 text-right">Cancelled</th>
                <th scope="col" className="py-2 text-right">Avg lead days</th>
                <th scope="col" className="py-2 text-right">Share</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((r) => (
                <tr key={r.supplier_id} className="border-b border-border-subtle">
                  <td className="py-2 font-medium">{r.supplier_name}</td>
                  <td className={NUM_CELL}>{formatCount(r.po_count)}</td>
                  <td className={NUM_CELL}>{formatIdrFull(r.total)}</td>
                  <td className={NUM_CELL}>{formatCount(r.received_count)}</td>
                  <td className={NUM_CELL}>{formatCount(r.cancelled_count)}</td>
                  <td className={`${NUM_CELL} text-text-secondary`}>
                    {r.avg_lead_days ?? '—'}
                  </td>
                  <td className={NUM_CELL}>{formatPercent(r.share_pct, { digits: 2 })}</td>
                </tr>
              ))}
            </tbody>
            {ranked.length > 0 && (
              <tfoot>
                <tr className="border-t border-border-subtle font-semibold">
                  <td className="py-2">Total</td>
                  <td className={NUM_CELL}>{formatCount(poCount)}</td>
                  <td className={NUM_CELL}>{formatIdrFull(totalValue)}</td>
                  <td className={NUM_CELL}>{formatCount(received)}</td>
                  <td className={NUM_CELL}>{formatCount(cancelled)}</td>
                  <td className={`${NUM_CELL} text-text-secondary`}>
                    {leadDays === null ? '—' : formatNumber(leadDays, { digits: 1 })}
                  </td>
                  <td className={NUM_CELL}>—</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </PanelCard>
    </ReportShell>
  );
}
