// apps/backoffice/src/pages/reports/CashierVariancePage.tsx
//
// Lot D (campagne Reports 2026-08-15) — vague Sales, page 4/6. Migrée sur le
// socle Report shell v2 (archétype maquette 4c, patron : DailySalesPage).
//
// Trois corrections de fond :
//
//  1. LA MATRICE ÉTAIT UNE HEATMAP DÉGUISÉE — des chiffres teintés en vert ou
//     rouge par un barème local (`varianceClass`), sans légende : un code privé.
//     Elle devient une vraie `HeatmapGrid` sur le barème PARTAGÉ
//     (`varianceScale.ts`), accompagnée de la `VarianceLegend` qui NOMME ses
//     seuils. Conséquence assumée : un EXCÉDENT n'est plus vert — trop d'argent
//     dans un tiroir est aussi une anomalie, le barème signé le dit.
//  2. `totals` (cash / QRIS / card) était câblé au lot A1 et JETÉ par la page
//     (finding F-04) : il porte la bande KPI.
//  3. La période passe sur `useReportPeriod` (params `start` / `end`, déjà les
//     noms en place). Pas de bouton « Compare » : le rapport n'a pas de figure
//     appariable — la RPC ne rend qu'une fenêtre.
//
// Gate `reports.financial.read` (route + RPC v2) : statu quo arbitré, la page
// reste en section Sales alors que sa donnée est du contrôle financier.

import type { JSX } from 'react';
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { CsvColumn } from '@breakery/domain';
import { cn } from '@breakery/ui';
import { PanelCard } from '@/components/PanelCard.js';
import { KpiTile, KPI_NOTE, KPI_NOTE_HERO } from '@/components/kpi/KpiTile.js';
import { ReportShell } from '@/features/reports/components/ReportShell.js';
import { KpiBand } from '@/features/reports/components/KpiBand.js';
import { PeriodControl } from '@/features/reports/components/PeriodControl.js';
import { ExportMenu } from '@/features/reports/components/ExportMenu.js';
import { VarianceLegend } from '@/features/reports/components/VarianceLegend.js';
import { HeatmapGrid, type HeatmapRow } from '@/features/reports/components/charts/HeatmapGrid.js';
import { useReportPeriod } from '@/features/reports/hooks/useReportPeriod.js';
import {
  useCashierVariance, type CashierVarianceRow,
} from '@/features/reports/hooks/useCashierVariance.js';
import { buildDrilldownUrl } from '@/features/reports/utils/buildDrilldownUrl.js';
import { formatIdrCompact, formatIdrFull } from '@/features/reports/utils/chartColors.js';
import {
  VARIANCE_TONE_TEXT, varianceToneSigned,
} from '@/features/reports/utils/varianceScale.js';
import { formatCount, periodLabel } from '@/features/reports/utils/reportFigures.js';

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Seuil d'alerte d'un manquant de caisse, en IDR. Constante de page : le
 *  barème n'est pas encore un réglage métier — le nommer dans la légende est ce
 *  qui le rend lisible. */
const CASH_SHORT_BAD = 50_000;
const SIGNED = { bad: -CASH_SHORT_BAD } as const;

const csvColumns: CsvColumn<CashierVarianceRow>[] = [
  { header: 'Cashier',       accessor: (r) => r.cashier_name,          format: 'text' },
  { header: 'Sessions',      accessor: (r) => r.sessions_count,        format: 'number' },
  { header: 'Cash Variance', accessor: (r) => r.cash.total_variance,   format: 'idr-round100' },
  { header: 'Cash Avg',      accessor: (r) => r.cash.avg_variance,     format: 'idr-round100' },
  { header: 'Short #',       accessor: (r) => r.cash.short_count,      format: 'number' },
  { header: 'Over #',        accessor: (r) => r.cash.over_count,       format: 'number' },
  { header: 'Worst',         accessor: (r) => r.cash.worst_variance,   format: 'idr-round100' },
  { header: 'QRIS Variance', accessor: (r) => r.qris.total_variance,   format: 'idr-round100' },
  { header: 'Card Variance', accessor: (r) => r.card.total_variance,   format: 'idr-round100' },
];

const NUM_CELL = 'py-2 text-right font-data tabular-nums';
const INK_LINK = 'text-gold underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold';

interface KpiDescriptor {
  key: string; label: string; value: string; title?: string; note: string;
  /** Valeur signée négative — voir `tone` sur KpiTile. */
  tone?: 'neutral' | 'danger';
}

/** Cellule signée : le barème PARTAGÉ, jamais un `v < 0 ? rouge : vert` local. */
function signedCell(v: number): string {
  return cn(NUM_CELL, VARIANCE_TONE_TEXT[varianceToneSigned(v, SIGNED)]);
}

/**
 * Ton de TUILE, tiré du MÊME barème que les cellules et la heatmap. La page
 * colorait correctement sa grille, sous légende, et laissait ses tuiles muettes :
 * un manquant de caisse s'y affichait exactement comme un excédent.
 *
 * La tuile n'a que deux tons ; `watch` (un manquant sous le seuil de la légende)
 * y retombe donc en neutre. Il n'est pas perdu pour autant : le MOT, lui,
 * apparaît dès que le signe est négatif.
 */
function signedTileTone(v: number): 'neutral' | 'danger' {
  return varianceToneSigned(v, SIGNED) === 'bad' ? 'danger' : 'neutral';
}

/** Le mot, deuxième signal — la couleur ne porte jamais seule (WCAG 1.4.1). */
function shortfallNote(v: number, rest: string): string {
  return v < 0 ? `shortfall · ${rest}` : rest;
}

export default function CashierVariancePage(): JSX.Element {
  // Bornes déjà nommées `start` / `end` : aucun repli de nom nécessaire.
  const period = useReportPeriod();
  const { start, end } = period;

  const { data, isLoading, error } = useCashierVariance(start, end);

  const rows   = useMemo(() => data?.cashiers ?? [], [data?.cashiers]);
  const totals = data?.totals;

  const heatmapRows: HeatmapRow[] = rows.map((r) => {
    const byDow = new Map(r.dow_cash.map((c) => [c.dow, c.total_variance]));
    const url   = buildDrilldownUrl('user', r.cashier_id);
    return {
      key:   r.cashier_id,
      label: url !== null
        ? <Link to={url} className={INK_LINK}>{r.cashier_name}</Link>
        : r.cashier_name,
      // `undefined` (aucune session ce jour-là) devient `null` : la cellule sort
      // un point, jamais « Rp 0 » — un écart nul et une absence de session ne
      // sont pas la même information.
      cells: DOW_LABELS.map((_, dow) => byDow.get(dow) ?? null),
    };
  });

  const qrisCounted = (totals?.qris.counted_sessions ?? 0) > 0;
  const cardCounted = (totals?.card.counted_sessions ?? 0) > 0;

  const tiles: KpiDescriptor[] = [
    {
      key: 'cash-variance', label: 'Cash variance',
      value: formatIdrCompact(totals?.cash.total_variance ?? 0),
      title: formatIdrFull(totals?.cash.total_variance ?? 0),
      note:  shortfallNote(
        totals?.cash.total_variance ?? 0,
        `${formatCount(totals?.cash.short_count ?? 0)} short · ${formatCount(totals?.cash.over_count ?? 0)} over`,
      ),
      tone:  signedTileTone(totals?.cash.total_variance ?? 0),
    },
    {
      key: 'cash-short', label: 'Total short',
      value: formatIdrCompact(totals?.cash.total_short ?? 0),
      title: formatIdrFull(totals?.cash.total_short ?? 0),
      note:  'shortfalls only, overages excluded',
    },
    {
      key: 'sessions', label: 'Sessions',
      value: formatCount(totals?.sessions_count ?? 0),
      note:  'closed in this period',
    },
    {
      key: 'cashiers', label: 'Cashiers',
      value: formatCount(rows.length),
      note:  'with at least one closed shift',
    },
    {
      // Une caisse non comptée n'a pas un écart nul : elle n'a pas d'écart.
      key: 'qris-variance', label: 'QRIS variance',
      value: qrisCounted ? formatIdrCompact(totals?.qris.total_variance ?? 0) : '—',
      ...(qrisCounted ? { title: formatIdrFull(totals?.qris.total_variance ?? 0) } : {}),
      note:  qrisCounted
        ? shortfallNote(
            totals?.qris.total_variance ?? 0,
            `${formatCount(totals?.qris.counted_sessions ?? 0)} sessions counted`,
          )
        : 'not counted at close',
      // Non comptée, la tuile n'a pas de valeur : elle n'a donc pas de ton.
      tone:  qrisCounted ? signedTileTone(totals?.qris.total_variance ?? 0) : 'neutral',
    },
    {
      key: 'card-variance', label: 'Card variance',
      value: cardCounted ? formatIdrCompact(totals?.card.total_variance ?? 0) : '—',
      ...(cardCounted ? { title: formatIdrFull(totals?.card.total_variance ?? 0) } : {}),
      note:  cardCounted
        ? shortfallNote(
            totals?.card.total_variance ?? 0,
            `${formatCount(totals?.card.counted_sessions ?? 0)} sessions counted`,
          )
        : 'not counted at close',
      tone:  cardCounted ? signedTileTone(totals?.card.total_variance ?? 0) : 'neutral',
    },
  ];

  const meta = [
    periodLabel(start, end),
    `${formatCount(totals?.sessions_count ?? 0)} closed shift${(totals?.sessions_count ?? 0) === 1 ? '' : 's'}`,
    'counted minus expected, per payment method',
  ].join(' · ');

  const toolbar = (
    <>
      <PeriodControl period={period} />
      {/* Pas de PDF : aucun gabarit `cashier_variance` n'est enregistré dans
          l'EF generate-pdf, et un item qui échoue vaut moins qu'une absence. */}
      <ExportMenu
        csv={{ rows, columns: csvColumns, filename: `cashier-variance-${start}_${end}` }}
        disabled={rows.length === 0}
      />
    </>
  );

  return (
    <ReportShell
      title="Cashier Variance"
      subtitle={meta}
      breadcrumb={[{ label: 'Reports', to: '/backoffice/reports' }, { label: 'Sales' }]}
      toolbar={toolbar}
      error={error}
      isEmpty={!isLoading && error === null && rows.length === 0}
      emptyState={{
        title: 'No closed shifts',
        description: 'No shift was closed in the selected date range.',
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
              {...(t.tone !== undefined ? { tone: t.tone } : {})}
              testId={`kpi-${t.key}`}
            >
              <span className={i === 0 ? KPI_NOTE_HERO : KPI_NOTE}>{t.note}</span>
            </KpiTile>
          ))}
        </KpiBand>
      }
    >
      <PanelCard
        title="Cash variance by day of week"
        subtitle="The recurring-shortfall signal: a column that stays red is a schedule problem, not an accident."
        aside={
          <VarianceLegend
            items={[
              { tone: 'bad',     label: `Short over ${formatIdrFull(CASH_SHORT_BAD)}` },
              { tone: 'watch',   label: `Off by up to ${formatIdrFull(CASH_SHORT_BAD)}, or over` },
              { tone: 'good',    label: 'Balanced' },
              { tone: 'neutral', label: 'No session' },
            ]}
          />
        }
        isLoading={isLoading}
        testId="cashier-variance-heatmap"
      >
        <HeatmapGrid
          columns={DOW_LABELS}
          rows={heatmapRows}
          tone={(v) => varianceToneSigned(v, SIGNED)}
          format={formatIdrCompact}
          rowHeader="Cashier"
          caption="Cash variance per cashier and day of week"
        />
      </PanelCard>

      <PanelCard
        title="Per-cashier detail"
        className="mt-3"
        isLoading={isLoading}
        testId="cashier-variance-table"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">
              Cash, QRIS and card variance per cashier over the selected period
            </caption>
            <thead>
              <tr className="border-b border-border-subtle text-text-secondary">
                <th scope="col" className="py-2 text-left">Cashier</th>
                {['Sessions', 'Cash Δ', 'Avg', 'Short', 'Over', 'Worst', 'QRIS Δ', 'Card Δ'].map((h) => (
                  <th key={h} scope="col" className="py-2 text-right">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const url = buildDrilldownUrl('user', r.cashier_id);
                return (
                  <tr key={r.cashier_id} className="border-b border-border-subtle">
                    <td className="py-2 font-medium">
                      {url !== null
                        ? <Link to={url} className={INK_LINK}>{r.cashier_name}</Link>
                        : r.cashier_name}
                    </td>
                    <td className={NUM_CELL}>{formatCount(r.sessions_count)}</td>
                    <td className={signedCell(r.cash.total_variance)}>{formatIdrFull(r.cash.total_variance)}</td>
                    <td className={NUM_CELL}>{formatIdrFull(r.cash.avg_variance)}</td>
                    <td className={NUM_CELL}>{formatCount(r.cash.short_count)}</td>
                    <td className={NUM_CELL}>{formatCount(r.cash.over_count)}</td>
                    <td className={signedCell(r.cash.worst_variance)}>{formatIdrFull(r.cash.worst_variance)}</td>
                    <td className={NUM_CELL}>
                      {r.qris.counted_sessions === 0 ? '—' : formatIdrFull(r.qris.total_variance)}
                    </td>
                    <td className={NUM_CELL}>
                      {r.card.counted_sessions === 0 ? '—' : formatIdrFull(r.card.total_variance)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </PanelCard>
    </ReportShell>
  );
}
