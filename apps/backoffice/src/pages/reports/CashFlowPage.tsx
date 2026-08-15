// apps/backoffice/src/pages/reports/CashFlowPage.tsx
//
// Lot E (campagne Reports 2026-08-15) — vague Finance, page 5/8. Migrée sur le
// socle Report shell v2 (archétype maquette 4c, patron : DailySalesPage).
//
// CE QUI NE CHANGE PAS : la méthode indirecte PAR CONTREPARTIE de
// `get_cash_flow_v3`. Les trois sections, leurs postes explicatifs
// (net_profit, Δ AR, Δ AP, Δ stocks, ajustements non monétaires) et les deux
// soldes de trésorerie sont rendus tels quels, dans le même ordre. Les postes
// de la section opérationnelle EXPLIQUENT son total, ils ne le fondent pas :
// aucun n'est re-sommé ici.
//
// LE CONTRÔLE DE RÉCONCILIATION RESTE, à l'identique. Depuis la v3, l'égalité
// `operating + investing + financing = cash_end − cash_start` est une identité
// de la partie double ; l'indicateur n'avoue donc plus un écart connu, il
// DÉTECTE une régression — écriture déséquilibrée, ou compte mal classé dans
// `accounts.cash_flow_section`. Le retirer parce qu'il est vert serait retirer
// le détecteur.
//
// Le graphe retenu : les trois sections plus la variation nette, appariées à la
// période précédente. C'est le seul graphe évident ici — la RPC ne sert aucune
// série journalière, et une courbe de trésorerie exigerait un autre gisement.
//
// Params URL : `start` / `end` / `cmp` (l'ancien drapeau `compare` n'est plus
// lu — les bornes portaient déjà les noms standards).

import { useMemo, type JSX } from 'react';
import type { CsvColumn } from '@breakery/domain';
import { PanelCard } from '@/components/PanelCard.js';
import { KpiTile, KPI_NOTE, KPI_NOTE_HERO } from '@/components/kpi/KpiTile.js';
import { Delta } from '@/components/kpi/Delta.js';
import { ReportShell } from '@/features/reports/components/ReportShell.js';
import { KpiBand } from '@/features/reports/components/KpiBand.js';
import { PeriodControl } from '@/features/reports/components/PeriodControl.js';
import { ExportMenu } from '@/features/reports/components/ExportMenu.js';
import { DeltaPct } from '@/features/reports/components/DeltaPct.js';
import { PairedBarsChart } from '@/features/reports/components/charts/PairedBarsChart.js';
import { useReportPeriod } from '@/features/reports/hooks/useReportPeriod.js';
import { useCashFlow, type CashFlow } from '@/features/reports/hooks/useCashFlow.js';
import { formatIdrCompact, formatIdrFull } from '@/features/reports/utils/chartColors.js';
import { pctChange, periodLabel } from '@/features/reports/utils/reportFigures.js';

interface CfRow { section: string; label: string; value: number }

/**
 * Seuil de réconciliation. `net_change_in_cash` doit retomber exactement sur
 * `cash_end − cash_start`, lu sur les comptes de trésorerie.
 */
const RECONCILIATION_EPSILON = 0.01;

function reconcile(d: CashFlow): { ok: boolean; delta: number; implied: number } {
  const implied = d.cash_end - d.cash_start;
  const delta   = d.net_change_in_cash - implied;
  return { ok: Math.abs(delta) < RECONCILIATION_EPSILON, delta, implied };
}

/** Aucun flux ni solde de trésorerie sur la période. */
function isBlankCashFlow(d: CashFlow): boolean {
  return d.operating.total === 0 && d.investing.total === 0 && d.financing.total === 0
    && d.cash_start === 0 && d.cash_end === 0;
}

function buildCfRows(d: CashFlow): CfRow[] {
  return [
    { section: 'Operating', label: 'Net profit',            value: d.operating.net_profit },
    { section: 'Operating', label: 'Δ accounts receivable', value: d.operating.delta_ar },
    { section: 'Operating', label: 'Δ accounts payable',    value: d.operating.delta_ap },
    { section: 'Operating', label: 'Δ inventory',           value: d.operating.delta_inventory },
    { section: 'Operating', label: 'Non-cash adjustments',  value: d.operating.non_cash_adjustments },
    { section: 'Operating', label: 'Total operating',       value: d.operating.total },
    { section: 'Investing', label: 'Total investing',       value: d.investing.total },
    { section: 'Financing', label: 'Total financing',       value: d.financing.total },
    { section: 'Summary',   label: 'Net change in cash',    value: d.net_change_in_cash },
    { section: 'Summary',   label: 'Cash, start of period', value: d.cash_start },
    { section: 'Summary',   label: 'Cash, end of period',   value: d.cash_end },
  ];
}

const cfCsvColumns: CsvColumn<CfRow>[] = [
  { header: 'Section', accessor: (r) => r.section, format: 'text' },
  { header: 'Label',   accessor: (r) => r.label,   format: 'text' },
  { header: 'Value',   accessor: (r) => r.value,   format: 'idr-round100' },
];

const fmt = formatIdrFull;
const NUM_CELL = 'py-2 text-right font-data tabular-nums';

const OPERATING_ITEMS = [
  ['Net profit',            'net_profit'],
  ['Δ accounts receivable', 'delta_ar'],
  ['Δ accounts payable',    'delta_ap'],
  ['Δ inventory',           'delta_inventory'],
  ['Non-cash adjustments',  'non_cash_adjustments'],
] as const;

interface KpiDescriptor {
  key: string; label: string; value: string; title?: string;
  delta?: number | null; note?: string;
}

export default function CashFlowPage(): JSX.Element {
  const period = useReportPeriod();
  const { start, end, compareRange } = period;

  const current = useCashFlow(start, end);
  const compare = useCashFlow(compareRange.start, compareRange.end);

  const data     = current.data;
  const prevData = compare.data;
  const showDelta = period.compare && prevData !== undefined;

  const rec = data !== undefined ? reconcile(data) : null;

  const chartData = useMemo(() => {
    if (data === undefined) return [];
    return [
      { item: 'Operating',  current: data.operating.total,   compare: prevData?.operating.total   ?? 0 },
      { item: 'Investing',  current: data.investing.total,   compare: prevData?.investing.total   ?? 0 },
      { item: 'Financing',  current: data.financing.total,   compare: prevData?.financing.total   ?? 0 },
      { item: 'Net change', current: data.net_change_in_cash, compare: prevData?.net_change_in_cash ?? 0 },
    ];
  }, [data, prevData]);

  const tiles: KpiDescriptor[] = [
    {
      key: 'net-change', label: 'Net change in cash',
      value: formatIdrCompact(data?.net_change_in_cash ?? 0),
      title: formatIdrFull(data?.net_change_in_cash ?? 0),
      delta: pctChange(data?.net_change_in_cash ?? 0, prevData?.net_change_in_cash),
    },
    {
      key: 'operating', label: 'Operating',
      value: formatIdrCompact(data?.operating.total ?? 0),
      title: formatIdrFull(data?.operating.total ?? 0),
      delta: pctChange(data?.operating.total ?? 0, prevData?.operating.total),
    },
    {
      key: 'investing', label: 'Investing',
      value: formatIdrCompact(data?.investing.total ?? 0),
      title: formatIdrFull(data?.investing.total ?? 0),
      delta: pctChange(data?.investing.total ?? 0, prevData?.investing.total),
    },
    {
      key: 'financing', label: 'Financing',
      value: formatIdrCompact(data?.financing.total ?? 0),
      title: formatIdrFull(data?.financing.total ?? 0),
      delta: pctChange(data?.financing.total ?? 0, prevData?.financing.total),
    },
    {
      key: 'cash-start', label: 'Cash, start',
      value: formatIdrCompact(data?.cash_start ?? 0), title: formatIdrFull(data?.cash_start ?? 0),
      note:  'balance on cash accounts',
    },
    {
      key: 'cash-end', label: 'Cash, end',
      value: formatIdrCompact(data?.cash_end ?? 0), title: formatIdrFull(data?.cash_end ?? 0),
      delta: pctChange(data?.cash_end ?? 0, prevData?.cash_end),
    },
  ];

  const meta = [
    periodLabel(start, end),
    'indirect method, classified by counterparty',
  ].join(' · ');

  const toolbar = (
    <>
      <PeriodControl period={period} showCompare />
      <ExportMenu
        csv={{
          rows: data !== undefined ? buildCfRows(data) : [],
          columns: cfCsvColumns,
          filename: `cash-flow-${start}_${end}`,
        }}
        {...(data !== undefined
          ? {
              pdf: {
                template: 'cf' as const,
                data,
                period:   { start, end },
                filename: `cash-flow-${start}_${end}`,
                ...(showDelta && prevData !== undefined ? { comparePrevious: { data: prevData } } : {}),
              },
            }
          : {})}
        disabled={data === undefined}
      />
    </>
  );

  return (
    <ReportShell
      title="Cash Flow Statement"
      subtitle={meta}
      breadcrumb={[{ label: 'Reports', to: '/backoffice/reports' }, { label: 'Financial' }]}
      toolbar={toolbar}
      error={current.error}
      isEmpty={!current.isLoading && data !== undefined && isBlankCashFlow(data)}
      emptyState={{
        title: 'No cash movement',
        description: 'No cash movement in the selected date range.',
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
              {t.delta !== undefined && <Delta value={t.delta} period="prev" onInk={i === 0} />}
              {t.note !== undefined && (
                <span className={i === 0 ? KPI_NOTE_HERO : KPI_NOTE}>{t.note}</span>
              )}
            </KpiTile>
          ))}
        </KpiBand>
      }
    >
      {rec !== null && (
        <div
          className={rec.ok
            ? 'rounded-sm border border-success bg-success-soft px-4 py-2 text-sm text-success'
            : 'rounded-sm border border-danger bg-danger-soft px-4 py-2 text-sm text-danger'}
          role={rec.ok ? 'status' : 'alert'}
          aria-label="Cash reconciliation indicator"
          data-testid="cf-reconciliation"
        >
          {rec.ok
            ? `Reconciled: net change matches the movement on cash accounts (delta ${fmt(rec.delta)}).`
            : `Not reconciled — the indirect method gives ${fmt(data?.net_change_in_cash ?? 0)} `
              + `but cash accounts moved by ${fmt(rec.implied)} over the period `
              + `(delta ${fmt(rec.delta)}). Figures below are shown as computed; `
              + `the discrepancy is an accounting issue, not a display one.`}
        </div>
      )}

      <PanelCard
        title="Sections"
        aside={<span className="text-xs text-text-muted">same scale, one axis</span>}
        className="mt-3"
        isLoading={current.isLoading}
        testId="chart-cash-flow-sections"
      >
        <PairedBarsChart
          data={chartData}
          xKey="item"
          currentKey="current"
          currentName="This period"
          {...(showDelta ? { compareKey: 'compare', compareName: 'Previous period' } : {})}
          ariaLabel={`Operating, investing and financing cash flows and the net change in cash from ${start} to ${end}${showDelta ? ', compared with the previous period' : ''}.`}
        />
      </PanelCard>

      <PanelCard title="Statement" className="mt-3" isLoading={current.isLoading} testId="cf-statement">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">
              Cash flow statement, indirect method: operating, investing and financing activities
            </caption>
            <tbody>
              <tr className="border-b border-border-subtle bg-surface-4">
                <td className="py-2 font-medium uppercase tracking-wider">Operating activities</td>
                <td className={`${NUM_CELL} font-medium`}>{fmt(data?.operating.total ?? 0)}</td>
              </tr>
              {OPERATING_ITEMS.map(([label, key]) => (
                <tr key={key}>
                  <td className="py-1 pl-6 text-xs text-text-secondary">{label}</td>
                  <td className="py-1 text-right font-data text-xs tabular-nums">
                    {fmt(data?.operating[key] ?? 0)}
                  </td>
                </tr>
              ))}

              <tr className="border-b border-border-subtle bg-surface-4">
                <td className="py-2 font-medium uppercase tracking-wider">Investing activities</td>
                <td className={`${NUM_CELL} font-medium`}>{fmt(data?.investing.total ?? 0)}</td>
              </tr>
              <tr>
                <td className="py-1 pl-6 text-xs text-text-secondary">
                  Fixed assets &amp; capex (accounts classified investing)
                </td>
                <td className="py-1 text-right font-data text-xs tabular-nums">
                  {fmt(data?.investing.total ?? 0)}
                </td>
              </tr>

              <tr className="border-b border-border-subtle bg-surface-4">
                <td className="py-2 font-medium uppercase tracking-wider">Financing activities</td>
                <td className={`${NUM_CELL} font-medium`}>{fmt(data?.financing.total ?? 0)}</td>
              </tr>
              <tr>
                <td className="py-1 pl-6 text-xs text-text-secondary">
                  Loans &amp; equity (accounts classified financing)
                </td>
                <td className="py-1 text-right font-data text-xs tabular-nums">
                  {fmt(data?.financing.total ?? 0)}
                </td>
              </tr>

              <tr className="border-t-2 border-border-subtle bg-gold-soft">
                <td className="py-3 font-semibold uppercase tracking-wider">Net change in cash</td>
                <td className={`${NUM_CELL} py-3 font-semibold`}>
                  {fmt(data?.net_change_in_cash ?? 0)}
                </td>
              </tr>
              {showDelta && prevData !== undefined && (
                <tr>
                  <td className="py-1 pl-2 text-xs text-text-secondary">Net change vs prev. period</td>
                  <td className="py-1 text-right">
                    <DeltaPct
                      current={data?.net_change_in_cash ?? 0}
                      previous={prevData.net_change_in_cash}
                    />
                  </td>
                </tr>
              )}
              <tr className="border-b border-border-subtle">
                <td className="py-2 text-text-secondary">Cash, start of period</td>
                <td className={NUM_CELL}>{fmt(data?.cash_start ?? 0)}</td>
              </tr>
              <tr>
                <td className="py-2 text-text-secondary">Cash, end of period</td>
                <td className={NUM_CELL}>{fmt(data?.cash_end ?? 0)}</td>
              </tr>
              {showDelta && prevData !== undefined && (
                <tr>
                  <td className="py-1 pl-2 text-xs text-text-secondary">Ending cash vs prev. period</td>
                  <td className="py-1 text-right">
                    <DeltaPct current={data?.cash_end ?? 0} previous={prevData.cash_end} />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </PanelCard>
    </ReportShell>
  );
}
