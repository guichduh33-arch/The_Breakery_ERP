// apps/backoffice/src/pages/reports/OperatingExpensesPage.tsx
//
// Lot E (campagne Reports 2026-08-15) — vague Finance, page 7/8. Migrée sur le
// socle Report shell v2 (archétype maquette 4c, patron : DailySalesPage).
//
// CE QUI NE CHANGE PAS : la ventilation de `get_expenses_by_category_v1` —
// totaux, comptes et parts par catégorie de dépense, série journalière, et la
// règle du filtre de statut (statut NULL = dépense ENGAGÉE, hors brouillon et
// rejeté). Rien n'est re-sommé côté page.
//
// Ce qui change :
//  1. PLUS AUCUN « Rp 0 » AU-DESSUS D'UN « Loading… ». La bande de KPI maison
//     affichait des zéros pendant le chargement — un zéro AFFIRME qu'il n'y a
//     pas eu de dépense. Le socle sort des squelettes, puis des tirets si la
//     donnée reste inconnue.
//  2. LA COMPARAISON EST MÉRITÉE ICI : une charge d'exploitation ne se lit pas
//     seule, elle se lit contre le mois d'avant. La période précédente est
//     requêtée en parallèle et chaque tuile porte sa variation, la HAUSSE en
//     rouge (`invert`) — un écran de coûts qui peint une dérive en vert ment.
//  3. UN SEUL GRAPHE : la tendance journalière. Le donut de répartition devient
//     une carte de ventilation à pistes, étiquetée en direct — l'identité n'y
//     repose plus sur la couleur seule.
//
// Params URL : `start` / `end` / `cmp` + `category_id` / `status`, inchangés.

import { useMemo, type JSX } from 'react';
import { selectClassName, cn } from '@breakery/ui';
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
import { PairedBarsChart } from '@/features/reports/components/charts/PairedBarsChart.js';
import { useReportPeriod } from '@/features/reports/hooks/useReportPeriod.js';
import {
  useExpensesByCategory, type ExpenseCategoryRow,
} from '@/features/reports/hooks/useExpensesByCategory.js';
import { useExpenseCategories } from '@/features/expenses/hooks/useExpensesList.js';
import { useUrlState } from '@/hooks/useUrlState.js';
import {
  CHART_1, TEXT_INERT, categoricalColor, formatIdrCompact, formatIdrFull,
} from '@/features/reports/utils/chartColors.js';
import {
  formatCount, formatPct1, pctChange, periodLabel, sharePct, shortDate, topSlice,
} from '@/features/reports/utils/reportFigures.js';

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: '',          label: 'Committed (default)' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'approved',  label: 'Approved' },
  { value: 'paid',      label: 'Paid' },
  { value: 'draft',     label: 'Draft' },
  { value: 'rejected',  label: 'Rejected' },
];

const csvColumns: CsvColumn<ExpenseCategoryRow>[] = [
  { header: 'Category', accessor: (r) => r.name,            format: 'text' },
  { header: 'Total',    accessor: (r) => r.total,           format: 'idr-round100' },
  { header: 'Count',    accessor: (r) => r.count,           format: 'number' },
  { header: 'Share',    accessor: (r) => r.share_pct / 100, format: 'percent' },
];

const NUM_CELL = 'py-2 text-right font-data tabular-nums';

interface KpiDescriptor {
  key: string; label: string; value: string; title?: string;
  delta?: number | null; invert?: boolean; note?: string;
}

export default function OperatingExpensesPage(): JSX.Element {
  const period = useReportPeriod();
  const { start, end, compareRange } = period;
  const [categoryId, setCategoryId] = useUrlState('category_id', '');
  const [status,     setStatus]     = useUrlState('status', '');

  const { data: categories } = useExpenseCategories();
  const current = useExpensesByCategory({
    start, end, categoryId: categoryId || null, status: status || null,
  });
  // Mêmes filtres sur la fenêtre précédente : comparer des périmètres
  // différents (« toutes catégories » contre « loyer ») ne dirait rien.
  const compare = useExpensesByCategory({
    start: compareRange.start, end: compareRange.end,
    categoryId: categoryId || null, status: status || null,
  });

  const data     = current.data;
  const prevData = compare.data;
  const rows     = useMemo(() => data?.by_category ?? [], [data]);
  const hasCompare = period.compare && prevData !== undefined;

  // La série journalière : la comparaison s'aligne par RANG dans sa propre
  // fenêtre — deux fenêtres n'ont pas les mêmes dates, et la forme de la
  // semaine est ce qui se compare.
  const chartData = useMemo(() => {
    const cur = data?.by_day ?? [];
    const cmp = prevData?.by_day ?? [];
    return cur.map((d, i) => ({
      date: d.date, current: d.total, compare: cmp[i]?.total ?? 0,
    }));
  }, [data?.by_day, prevData?.by_day]);

  const top = topSlice(
    rows.slice().sort((a, b) => b.total - a.total), (r) => r.total, 'spend',
  );
  const topRows: BreakdownRow[] = top.rows.map((r, i) => ({
    key:      r.category_id,
    label:    r.name,
    amount:   r.total,
    sharePct: sharePct(r.total, top.total),
    color:    categoricalColor(i),
    count:    `${formatCount(r.count)}×`,
  }));
  const shownShare = topRows.reduce((s, r) => s + (r.sharePct ?? 0), 0);
  const segments: ShareSegment[] = [
    ...topRows.map((r) => ({ label: r.label, pct: r.sharePct ?? 0, color: r.color ?? CHART_1 })),
    ...(shownShare > 0 && shownShare < 99.95
      ? [{ label: 'Others', pct: 100 - shownShare, color: TEXT_INERT }]
      : []),
  ];

  const leader = rows.reduce<ExpenseCategoryRow | null>(
    (b, r) => (b === null || r.total > b.total ? r : b), null,
  );

  const tiles: KpiDescriptor[] = [
    {
      key: 'total', label: 'Total OpEx',
      value: formatIdrCompact(data?.summary.total ?? 0), title: formatIdrFull(data?.summary.total ?? 0),
      delta: pctChange(data?.summary.total ?? 0, prevData?.summary.total), invert: true,
    },
    {
      key: 'entries', label: 'Entries',
      value: formatCount(data?.summary.count ?? 0),
      delta: pctChange(data?.summary.count ?? 0, prevData?.summary.count),
    },
    {
      key: 'avg-entry', label: 'Avg / entry',
      value: formatIdrCompact(data?.summary.avg ?? 0), title: formatIdrFull(data?.summary.avg ?? 0),
      delta: pctChange(data?.summary.avg ?? 0, prevData?.summary.avg), invert: true,
    },
    {
      key: 'categories', label: 'Categories', value: formatCount(rows.length),
      delta: pctChange(rows.length, prevData !== undefined ? prevData.by_category.length : undefined),
    },
    {
      // Une variation n'a pas de sens sur un NOM : la tuile porte la part.
      key: 'top-category', label: 'Top category',
      value: leader?.name ?? '—',
      note:  leader !== null
        ? `${formatPct1(sharePct(leader.total, data?.summary.total ?? 0))} of spend`
        : 'no expense in this period',
    },
  ];

  const meta = [
    periodLabel(start, end),
    `${formatCount(rows.length)} categor${rows.length === 1 ? 'y' : 'ies'}`,
    status === '' ? 'committed spend' : `status: ${status}`,
  ].join(' · ');

  const toolbar = (
    <>
      <PeriodControl period={period} showCompare />
      <label className="flex items-center gap-1.5 text-xs text-text-muted">
        <span>Category</span>
        <select
          className={cn(selectClassName, 'h-8 w-auto')}
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          aria-label="Filter by expense category"
        >
          <option value="">All categories</option>
          {(categories ?? []).map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1.5 text-xs text-text-muted">
        <span>Status</span>
        <select
          className={cn(selectClassName, 'h-8 w-auto')}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label="Filter by expense status"
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </label>
      <ExportMenu
        csv={{ rows, columns: csvColumns, filename: `operating-expenses-${start}_${end}` }}
        disabled={rows.length === 0}
      />
    </>
  );

  return (
    <ReportShell
      title="Operating Expenses"
      subtitle={meta}
      breadcrumb={[{ label: 'Reports', to: '/backoffice/reports' }, { label: 'Financial' }]}
      toolbar={toolbar}
      error={current.error}
      isEmpty={!current.isLoading && data !== undefined && rows.length === 0}
      emptyState={{
        title: 'No expenses',
        description: 'No expense matches the selected period, category and status.',
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
      <div className="grid gap-3 xl:grid-cols-[1.7fr_1fr]">
        <PanelCard
          title="Daily operating expense"
          isLoading={current.isLoading}
          testId="chart-opex-by-day"
        >
          <PairedBarsChart
            data={chartData}
            xKey="date"
            currentKey="current"
            currentName="This period"
            {...(hasCompare ? { compareKey: 'compare', compareName: 'Previous period' } : {})}
            xTickFormatter={(v) => shortDate(String(v))}
            ariaLabel={`Operating expense per day from ${start} to ${end}${hasCompare ? ', compared with the previous period' : ''}.`}
          />
        </PanelCard>
        <BreakdownCard
          title="By category"
          subtitle={top.note}
          variant="track"
          rows={topRows}
          total={{ label: 'Total OpEx', amount: top.total }}
          isLoading={current.isLoading}
          error={current.error}
          shareBar={{
            title:     'Share of operating expense',
            ariaLabel: 'Share of operating expense by category',
            segments,
          }}
          shareBarPlacement="after-total"
          testId="breakdown-opex-categories"
        />
      </div>

      <PanelCard
        title="Category breakdown"
        className="mt-3"
        isLoading={current.isLoading}
        testId="opex-category-detail"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Total, entry count and share per expense category</caption>
            <thead>
              <tr className="border-b border-border-subtle text-text-secondary">
                <th scope="col" className="py-2 text-left">Category</th>
                <th scope="col" className="py-2 text-right">Total</th>
                <th scope="col" className="py-2 text-right">Count</th>
                <th scope="col" className="py-2 text-right">Share</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.category_id} className="border-b border-border-subtle">
                  <td className="py-2 font-medium text-text-primary">{r.name}</td>
                  <td className={NUM_CELL}>{formatIdrFull(r.total)}</td>
                  <td className={NUM_CELL}>{formatCount(r.count)}</td>
                  <td className={NUM_CELL}>{formatPct1(r.share_pct)}</td>
                </tr>
              ))}
            </tbody>
            {rows.length > 0 && data !== undefined && (
              <tfoot>
                <tr className="border-t border-border-subtle font-semibold">
                  <td className="py-2">Total</td>
                  <td className={NUM_CELL}>{formatIdrFull(data.summary.total)}</td>
                  <td className={NUM_CELL}>{formatCount(data.summary.count)}</td>
                  <td className={NUM_CELL}>100,0%</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </PanelCard>
    </ReportShell>
  );
}
