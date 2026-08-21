// apps/backoffice/src/pages/reports/ProfitLossPage.tsx
//
// Lot E (campagne Reports 2026-08-15) — vague Finance, page 1/8. Migrée sur le
// socle Report shell v2 (archétype maquette 4c, patron : DailySalesPage).
//
// CE QUI NE CHANGE PAS — et c'est l'essentiel sur un état comptable : les
// SECTIONS du compte de résultat (revenue / COGS / gross profit / OpEx / net
// profit), leur ORDRE, leurs postes de détail et leurs sous-totaux sont ceux de
// `get_profit_loss_v2`, rendus tels quels. Aucun chiffre n'est recalculé ici,
// aucun poste n'est fusionné : la seule arithmétique ajoutée est le TAUX DE
// MARGE affiché en tuile, dérivé de deux montants servis par la RPC.
//
// Ce qui change :
//  1. La comparaison n'est plus une colonne conditionnelle : la période
//     précédente est requêtée en parallèle et CHAQUE tuile porte sa variation.
//     Le bouton « Compare » commande la seconde série du graphe et la colonne
//     de delta de la table, comme avant.
//  2. Un graphe, un seul : les cinq agrégats du compte de résultat appariés à
//     la période précédente. Appariement par POSTE, jamais par rang.
//  3. L'or reste sur la ligne NET PROFIT de la table — total comptable, encre
//     de sens. Le sous-total « Gross profit » passe en teinte neutre : sur la
//     carte blanche du socle, `bg-bg-overlay` valait blanc, donc rien.
//
// Params URL : `start` / `end` / `cmp` (l'ancien drapeau `compare` n'est plus
// lu — les bornes, elles, portaient déjà les noms standards).

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
import { DrilldownLink } from '@/features/reports/components/DrilldownLink.js';
import { PairedBarsChart } from '@/features/reports/components/charts/PairedBarsChart.js';
import { useReportPeriod } from '@/features/reports/hooks/useReportPeriod.js';
import {
  useProfitLoss, type PnlLine, type ProfitLoss,
} from '@/features/reports/hooks/useProfitLoss.js';
import { formatIdrCompact, formatIdrFull } from '@/features/reports/utils/chartColors.js';
import { formatPct1, pctChange, periodLabel, sharePct } from '@/features/reports/utils/reportFigures.js';

const pnlLineColumns: CsvColumn<PnlLine>[] = [
  { header: 'Code',    accessor: (r) => r.code,    format: 'text' },
  { header: 'Name',    accessor: (r) => r.name,    format: 'text' },
  { header: 'Debit',   accessor: (r) => r.debit,   format: 'idr-round100' },
  { header: 'Credit',  accessor: (r) => r.credit,  format: 'idr-round100' },
  { header: 'Balance', accessor: (r) => r.balance, format: 'idr-round100' },
];

const fmt = formatIdrFull;
const NUM_CELL = 'py-2 text-right font-data tabular-nums';

/** Aucune écriture sur la période. */
function isBlankPnl(d: ProfitLoss): boolean {
  return d.lines.length === 0
    && d.revenue.total === 0 && d.cogs.total === 0 && d.opex.total === 0;
}

/** Postes de détail d'une section — libellé et valeur, dans l'ordre du plan. */
const REVENUE_ITEMS = ['sales', 'discounts', 'adjustments'] as const;
const COGS_ITEMS    = ['production', 'waste', 'other'] as const;
const OPEX_ITEMS    = [
  'salary', 'rent', 'utilities', 'supplies', 'marketing', 'maintenance', 'other',
] as const;
const OPEX_LABELS: Record<typeof OPEX_ITEMS[number], string> = {
  salary: 'Salary & wages', rent: 'Rent', utilities: 'Utilities', supplies: 'Supplies',
  marketing: 'Marketing', maintenance: 'Maintenance', other: 'Other',
};

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

interface KpiDescriptor {
  key: string; label: string; value: string;
  title?: string; delta?: number | null; unit?: 'pct' | 'pt'; invert?: boolean; note?: string;
  /** Valeur signée négative — voir `tone` sur KpiTile. */
  tone?: 'neutral' | 'danger';
}

export default function ProfitLossPage(): JSX.Element {
  const period = useReportPeriod();
  const { start, end, compareRange } = period;

  // Deux appels : la fenêtre ET la précédente. Sans la seconde requête, la
  // promesse « chaque chiffre porte sa comparaison » serait décorative.
  const current = useProfitLoss(start, end);
  const compare = useProfitLoss(compareRange.start, compareRange.end);

  const data     = current.data;
  const prevData = compare.data;
  const showDelta = period.compare && prevData !== undefined;

  const marginPct = data !== undefined ? sharePct(data.gross_profit, data.revenue.total) : 0;
  // Un taux ne se compare pas à une période SANS CHIFFRE D'AFFAIRES : `sharePct`
  // rend 0 sur base nulle, et l'écart afficherait « +92 pt » là où il n'y a
  // aucune comparaison. Base nulle → pas de comparaison, donc un tiret.
  const prevMarginPct = prevData !== undefined && prevData.revenue.total > 0
    ? sharePct(prevData.gross_profit, prevData.revenue.total)
    : undefined;

  // Un seul graphe : les cinq agrégats du compte de résultat, appariés par
  // POSTE à la période précédente — un tri qui bougerait comparerait deux
  // postes différents, ce qui n'a aucun sens sur un état comptable.
  const chartData = useMemo(() => {
    if (data === undefined) return [];
    return [
      { item: 'Revenue',      current: data.revenue.total, compare: prevData?.revenue.total ?? 0 },
      { item: 'COGS',         current: data.cogs.total,    compare: prevData?.cogs.total    ?? 0 },
      { item: 'Gross profit', current: data.gross_profit,  compare: prevData?.gross_profit  ?? 0 },
      { item: 'OpEx',         current: data.opex.total,    compare: prevData?.opex.total    ?? 0 },
      { item: 'Net profit',   current: data.net_profit,    compare: prevData?.net_profit    ?? 0 },
    ];
  }, [data, prevData]);

  const tiles: KpiDescriptor[] = [
    {
      // Une PERTE s'affichait exactement comme un bénéfice : même corps, même
      // encre, seul le signe du formatteur les séparait — et il se perd au bout
      // d'un « Rp -12,4 jt » lu de loin. Trois signaux désormais : le signe, le
      // mot, la couleur (ici `--ink-danger`, la tuile étant l'unique héro).
      key: 'net-profit', label: 'Net profit',
      value: formatIdrCompact(data?.net_profit ?? 0), title: formatIdrFull(data?.net_profit ?? 0),
      delta: pctChange(data?.net_profit ?? 0, prevData?.net_profit),
      ...(data !== undefined && data.net_profit < 0
        ? { tone: 'danger' as const, note: 'loss' }
        : {}),
    },
    {
      key: 'revenue', label: 'Revenue',
      value: formatIdrCompact(data?.revenue.total ?? 0), title: formatIdrFull(data?.revenue.total ?? 0),
      delta: pctChange(data?.revenue.total ?? 0, prevData?.revenue.total),
    },
    {
      key: 'cogs', label: 'COGS',
      value: formatIdrCompact(data?.cogs.total ?? 0), title: formatIdrFull(data?.cogs.total ?? 0),
      delta: pctChange(data?.cogs.total ?? 0, prevData?.cogs.total), invert: true,
    },
    {
      key: 'gross-profit', label: 'Gross profit',
      value: formatIdrCompact(data?.gross_profit ?? 0), title: formatIdrFull(data?.gross_profit ?? 0),
      delta: pctChange(data?.gross_profit ?? 0, prevData?.gross_profit),
    },
    {
      key: 'opex', label: 'Operating expenses',
      value: formatIdrCompact(data?.opex.total ?? 0), title: formatIdrFull(data?.opex.total ?? 0),
      delta: pctChange(data?.opex.total ?? 0, prevData?.opex.total), invert: true,
    },
    {
      // Un TAUX se compare en points, pas en pour-cent d'un pour-cent.
      key: 'gross-margin', label: 'Gross margin',
      value: formatPct1(marginPct),
      delta: prevMarginPct !== undefined ? marginPct - prevMarginPct : null,
      unit:  'pt',
      note:  'gross profit ÷ revenue',
    },
  ];

  const meta = [
    periodLabel(start, end),
    'revenue, COGS and operating expenses from the journal',
  ].join(' · ');

  const toolbar = (
    <>
      <PeriodControl period={period} showCompare />
      <ExportMenu
        csv={{ rows: data?.lines ?? [], columns: pnlLineColumns, filename: `pnl-${start}_${end}` }}
        {...(data !== undefined
          ? {
              pdf: {
                template: 'pnl' as const,
                data,
                period:   { start, end },
                filename: `pnl-${start}_${end}`,
                ...(showDelta && prevData !== undefined ? { comparePrevious: { data: prevData } } : {}),
              },
            }
          : {})}
        disabled={data === undefined}
      />
    </>
  );

  /** Ligne de poste — indentée, discrète, et sans delta : la comparaison vit
   *  au niveau des sous-totaux, seul palier où elle se lit. */
  const item = (label: string, value: number): JSX.Element => (
    <tr key={label}>
      <td className="py-1 pl-6 text-xs text-text-secondary">{label}</td>
      <td className="py-1 text-right font-data text-xs tabular-nums">{fmt(value)}</td>
      {showDelta && <td />}
    </tr>
  );

  return (
    <ReportShell
      title="Profit & Loss"
      subtitle={meta}
      breadcrumb={[{ label: 'Reports', to: '/backoffice/reports' }, { label: 'Financial' }]}
      toolbar={toolbar}
      error={current.error}
      isEmpty={!current.isLoading && data !== undefined && isBlankPnl(data)}
      emptyState={{
        title: 'No activity',
        description: 'No journal-entry activity in the selected date range.',
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
              {...(t.tone !== undefined ? { tone: t.tone } : {})}
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
      <PanelCard
        title="Profit & loss shape"
        aside={<span className="text-xs text-text-muted">five aggregates, same scale</span>}
        isLoading={current.isLoading}
        testId="chart-pnl-shape"
      >
        <PairedBarsChart
          data={chartData}
          xKey="item"
          currentKey="current"
          currentName="This period"
          {...(showDelta ? { compareKey: 'compare', compareName: 'Previous period' } : {})}
          ariaLabel={`Revenue, COGS, gross profit, operating expenses and net profit from ${start} to ${end}${showDelta ? ', compared with the previous period' : ''}.`}
        />
      </PanelCard>

      <PanelCard title="Statement" className="mt-3" isLoading={current.isLoading} testId="pnl-statement">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">
              Profit and loss statement: revenue, cost of goods sold, gross profit,
              operating expenses and net profit
            </caption>
            <tbody>
              <tr className="border-b border-border-subtle">
                <td className="py-2 font-medium">Revenue</td>
                <td className={`${NUM_CELL} font-medium`}>{fmt(data?.revenue.total ?? 0)}</td>
                {showDelta && prevData !== undefined && (
                  <td className="py-2 pl-2 text-right">
                    <DeltaPct current={data?.revenue.total ?? 0} previous={prevData.revenue.total} />
                  </td>
                )}
              </tr>
              {REVENUE_ITEMS.map((k) => item(capitalize(k), data?.revenue[k] ?? 0))}

              <tr className="border-b border-border-subtle">
                <td className="py-2 font-medium">COGS</td>
                <td className={`${NUM_CELL} font-medium`}>{fmt(data?.cogs.total ?? 0)}</td>
                {showDelta && prevData !== undefined && (
                  <td className="py-2 pl-2 text-right">
                    <DeltaPct current={data?.cogs.total ?? 0} previous={prevData.cogs.total} />
                  </td>
                )}
              </tr>
              {COGS_ITEMS.map((k) => item(capitalize(k), data?.cogs[k] ?? 0))}

              {/* Sous-total intermédiaire : teinte neutre. L'or ne descend pas
                  ici — il est réservé au total de l'état. */}
              <tr className="border-b border-border-subtle bg-surface-4">
                <td className="py-2 font-semibold">Gross profit</td>
                <td className={`${NUM_CELL} font-semibold`}>{fmt(data?.gross_profit ?? 0)}</td>
                {showDelta && prevData !== undefined && (
                  <td className="py-2 pl-2 text-right">
                    <DeltaPct current={data?.gross_profit ?? 0} previous={prevData.gross_profit} />
                  </td>
                )}
              </tr>

              <tr className="border-b border-border-subtle">
                <td className="py-2 font-medium">Operating expenses</td>
                <td className={`${NUM_CELL} font-medium`}>{fmt(data?.opex.total ?? 0)}</td>
                {showDelta && prevData !== undefined && (
                  <td className="py-2 pl-2 text-right">
                    <DeltaPct current={data?.opex.total ?? 0} previous={prevData.opex.total} />
                  </td>
                )}
              </tr>
              {OPEX_ITEMS.map((k) => item(OPEX_LABELS[k], data?.opex[k] ?? 0))}

              {/* Pied sur papier inerte (DESIGN.md § Tableaux) — le `border-t-2`
                  porte la séparation, l'or ne remplit rien. */}
              <tr className="border-t-2 border-border-subtle bg-surface-inert">
                <td className="py-3 font-semibold uppercase tracking-wider">Net profit</td>
                <td className={`${NUM_CELL} py-3 font-semibold`}>{fmt(data?.net_profit ?? 0)}</td>
                {showDelta && prevData !== undefined && (
                  <td className="py-3 pl-2 text-right">
                    <DeltaPct current={data?.net_profit ?? 0} previous={prevData.net_profit} />
                  </td>
                )}
              </tr>
            </tbody>
          </table>
        </div>
      </PanelCard>

      <PanelCard
        title="Lines (per account)"
        className="mt-3"
        isLoading={current.isLoading}
        testId="pnl-account-detail"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Debit, credit and balance per account</caption>
            <thead>
              <tr className="border-b border-border-subtle text-text-secondary">
                <th scope="col" className="py-2 text-left">Code</th>
                <th scope="col" className="py-2 text-left">Name</th>
                <th scope="col" className="py-2 text-right">Debit</th>
                <th scope="col" className="py-2 text-right">Credit</th>
                <th scope="col" className="py-2 text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {(data?.lines ?? []).map((l) => (
                <tr key={l.code} className="border-b border-border-subtle">
                  <td className="py-2">
                    <DrilldownLink
                      entity="account"
                      id={l.account_id}
                      label={l.code}
                      filter={{ start, end }}
                      icon={false}
                    />
                  </td>
                  <td className="py-2">{l.name}</td>
                  <td className={NUM_CELL}>{fmt(l.debit)}</td>
                  <td className={NUM_CELL}>{fmt(l.credit)}</td>
                  <td className={NUM_CELL}>{fmt(l.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </PanelCard>
    </ReportShell>
  );
}
