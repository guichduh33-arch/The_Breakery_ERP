// apps/backoffice/src/pages/reports/Pb1ReportPage.tsx
//
// Lot E (campagne Reports 2026-08-15) — vague Finance, page 4/8. Migrée sur le
// socle Report shell v2 (archétype maquette 4c, patron : DailySalesPage).
//
// CE QUI NE CHANGE PAS, ET NE DOIT PAS : aucun montant PB1 n'est calculé ici.
// La famille `get_pb1_report` sert le taux, la base taxable, la PB1 collectée,
// la PB1 due et le solde du compte de dette ; la page les rend. The Breakery est
// NON-PKP (ADR-003, juridiction corrigée par ADR-005 : PBJT municipale, Lombok/
// NTB) et la PB1 est INCLUSIVE — elle se dé-cumule serveur, jamais ici.
//
// Ce qui change :
//  1. LA PÉRIODE EST CELLE DU SOCLE, en granularité MOIS. Les params `month` et
//     `year` cèdent la place aux bornes standard `start` / `end`, ramenées au
//     mois civil : une déclaration mensuelle n'a pas de fenêtre glissante. Les
//     anciens liens `?month=5&year=2026` restent honorés.
//  2. La série journalière, qui n'existait qu'en table, gagne son graphe.
//  3. Le sélecteur d'année passe sur le primitif `Input` (il était un `<input>`
//     nu aux classes recopiées), dans le panneau du contrôle de période.
//
// Le drill-down du montant dû vers le grand livre du compte 2110 est conservé :
// la tuile ELLE-MÊME est le lien, au lieu d'un lien niché dans une carte.

import { type JSX } from 'react';
import type { CsvColumn } from '@breakery/domain';
import { PanelCard } from '@/components/PanelCard.js';
import { KpiTile, KPI_NOTE, KPI_NOTE_HERO } from '@/components/kpi/KpiTile.js';
import { ReportShell } from '@/features/reports/components/ReportShell.js';
import { KpiBand } from '@/features/reports/components/KpiBand.js';
import { PeriodControl } from '@/features/reports/components/PeriodControl.js';
import { ExportMenu } from '@/features/reports/components/ExportMenu.js';
import { PairedBarsChart } from '@/features/reports/components/charts/PairedBarsChart.js';
import { useReportPeriod, monthRange } from '@/features/reports/hooks/useReportPeriod.js';
import { useAccountIdByCode } from '@/features/accounting/hooks/useAccountIdByCode.js';
import { buildDrilldownUrl } from '@/features/reports/utils/buildDrilldownUrl.js';
import { formatIdrCompact, formatIdrFull } from '@/features/reports/utils/chartColors.js';
import { MONTH_NAMES, formatCount, shortDate } from '@/features/reports/utils/reportFigures.js';
import {
  usePb1Report, type Pb1ByDay, type Pb1ReportData,
} from '@/features/reports/hooks/usePb1Report.js';

const csvColumns: CsvColumn<Pb1ByDay>[] = [
  { header: 'Date',          accessor: (r) => r.day,           format: 'text' },
  { header: 'Taxable base',  accessor: (r) => r.taxable_base,  format: 'idr-round100' },
  { header: 'PB1 collected', accessor: (r) => r.pb1_collected, format: 'idr-round100' },
];

const NUM_CELL = 'py-2 text-right font-data tabular-nums';

/** Aucune vente taxable sur le mois. */
function isBlankPb1(d: Pb1ReportData): boolean {
  return d.by_day.length === 0 && d.taxable_base === 0;
}

/**
 * Repli LEGACY : les liens partagés avant l'unification portaient `?month=5&
 * year=2026`. Ce ne sont pas des bornes renommées, ce sont deux nombres dont
 * les bornes se déduisent — d'où `legacyResolve` plutôt que `legacyKeys`.
 * Défini au niveau MODULE : une identité neuve à chaque rendu relancerait le
 * calcul du défaut sans fin.
 */
function pb1LegacyBounds(params: URLSearchParams): { start: string; end: string } | null {
  const m = Number(params.get('month'));
  const y = Number(params.get('year'));
  if (!Number.isInteger(m) || m < 1 || m > 12) return null;
  if (!Number.isInteger(y) || y < 2000 || y > 2999) return null;
  return monthRange(y, m);
}

/** Mois et année portés par la borne de début (le mois est civil par `snapTo`). */
function partsOf(iso: string): { year: number; month: number } {
  const m = /^(\d{4})-(\d{2})/.exec(iso);
  const now = new Date();
  return m !== null
    ? { year: Number(m[1]), month: Number(m[2]) }
    : { year: now.getFullYear(), month: now.getMonth() + 1 };
}

interface KpiDescriptor {
  key: string; label: string; value: string; title?: string; note?: string;
  to?: string; srHint?: string;
}

export default function Pb1ReportPage(): JSX.Element {
  const period = useReportPeriod({ snapTo: 'month', legacyResolve: pb1LegacyBounds });
  const { year, month } = partsOf(period.start);

  const { data, isLoading, error } = usePb1Report({ month, year });
  const { data: pb1PayableAccountId } = useAccountIdByCode('2110');

  const titlePeriod = `${MONTH_NAMES[month - 1] ?? String(month)} ${year}`;
  const byDay       = data?.by_day ?? [];
  const glUrl       = buildDrilldownUrl('account', pb1PayableAccountId ?? '', {
    start: data?.period.start ?? period.start,
    end:   data?.period.end   ?? period.end,
  });

  const chartData = byDay.map((d) => ({
    day: String(d.day).slice(0, 10), collected: d.pb1_collected,
  }));

  const tiles: KpiDescriptor[] = [
    {
      key: 'pb1-payable', label: 'PB1 payable',
      value: formatIdrCompact(data?.pb1_payable ?? 0), title: formatIdrFull(data?.pb1_payable ?? 0),
      note:  'due to the Bapenda for the month',
      ...(glUrl !== null ? { to: glUrl, srHint: 'Opens the general ledger for account 2110' } : {}),
    },
    {
      key: 'taxable-base', label: 'Taxable base',
      value: formatIdrCompact(data?.taxable_base ?? 0), title: formatIdrFull(data?.taxable_base ?? 0),
    },
    {
      key: 'pb1-collected', label: 'PB1 collected',
      value: formatIdrCompact(data?.pb1_collected ?? 0), title: formatIdrFull(data?.pb1_collected ?? 0),
      note:  'included in the ticket price',
    },
    {
      key: 'pb1-rate', label: 'PB1 rate',
      value: `${((data?.pb1_rate ?? 0) * 100).toFixed(0)}%`,
      note:  'NON-PKP · PBJT, Lombok',
    },
    {
      key: 'account-balance', label: 'Account balance',
      value: formatIdrCompact(data?.balance_at_period_end ?? 0),
      title: formatIdrFull(data?.balance_at_period_end ?? 0),
      note:  data?.balance_account_code !== undefined && data.balance_account_code !== ''
        ? `account ${data.balance_account_code} at period end`
        : 'at period end',
    },
    {
      key: 'taxable-days', label: 'Days with sales', value: formatCount(byDay.length),
    },
  ];

  const meta = [titlePeriod, 'monthly restaurant tax (PB1 10%) — NON-PKP mode'].join(' · ');

  const toolbar = (
    <>
      <PeriodControl period={period} variant="month" />
      <ExportMenu
        csv={{
          rows: byDay, columns: csvColumns,
          filename: `pb1-${year}-${String(month).padStart(2, '0')}`,
        }}
        {...(data !== undefined
          ? {
              pdf: {
                template: 'pb1' as const,
                data,
                period:   { start: data.period.start, end: data.period.end },
                filename: `pb1-${year}-${String(month).padStart(2, '0')}`,
              },
            }
          : {})}
        disabled={byDay.length === 0}
      />
    </>
  );

  return (
    <ReportShell
      title="PB1 Report"
      subtitle={meta}
      breadcrumb={[{ label: 'Reports', to: '/backoffice/reports' }, { label: 'Financial' }]}
      toolbar={toolbar}
      error={error}
      isEmpty={!isLoading && data !== undefined && isBlankPb1(data)}
      emptyState={{
        title: 'No taxable sales',
        description: 'No taxable sales recorded for this month.',
      }}
      kpis={
        <KpiBand isLoading={isLoading} tiles={tiles.length} labels={tiles.map((t) => t.label)}>
          {tiles.map((t, i) => (
            <KpiTile
              key={t.key}
              label={t.label}
              value={t.value}
              {...(t.title  !== undefined ? { valueTitle: t.title } : {})}
              {...(t.to     !== undefined ? { to: t.to } : {})}
              {...(t.srHint !== undefined ? { srHint: t.srHint } : {})}
              hero={i === 0}
              testId={t.key === 'pb1-payable' ? 'pb1-payable-card' : `kpi-${t.key}`}
            >
              {t.note !== undefined && (
                <span className={i === 0 ? KPI_NOTE_HERO : KPI_NOTE}>{t.note}</span>
              )}
            </KpiTile>
          ))}
        </KpiBand>
      }
    >
      <PanelCard
        title="PB1 collected by day"
        subtitle={`${titlePeriod} — tax embedded in the ticket price`}
        isLoading={isLoading}
        testId="chart-pb1-by-day"
      >
        <PairedBarsChart
          data={chartData}
          xKey="day"
          currentKey="collected"
          currentName="PB1 collected"
          xTickFormatter={(v) => shortDate(String(v))}
          ariaLabel={`PB1 collected per day over ${titlePeriod}.`}
        />
      </PanelCard>

      <PanelCard
        title={`${titlePeriod} — by day`}
        className="mt-3"
        isLoading={isLoading}
        testId="pb1-by-day-table"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Taxable base and PB1 collected per day</caption>
            <thead>
              <tr className="border-b border-border-subtle text-text-secondary">
                <th scope="col" className="py-2 text-left">Date</th>
                <th scope="col" className="py-2 text-right">Taxable base</th>
                <th scope="col" className="py-2 text-right">PB1 collected</th>
              </tr>
            </thead>
            <tbody>
              {byDay.map((d) => (
                <tr key={d.day} className="border-b border-border-subtle">
                  <td className="py-2 font-data tabular-nums text-text-secondary">
                    {String(d.day).slice(0, 10)}
                  </td>
                  <td className={NUM_CELL}>{formatIdrFull(d.taxable_base)}</td>
                  <td className={NUM_CELL}>{formatIdrFull(d.pb1_collected)}</td>
                </tr>
              ))}
            </tbody>
            {byDay.length > 0 && data !== undefined && (
              // Les totaux sont ceux du SERVEUR, pas une somme des lignes
              // affichées : sur un état fiscal, la page ne recalcule rien.
              <tfoot>
                <tr className="border-t-2 border-border-subtle bg-gold-soft font-semibold">
                  <td className="py-3">Month total</td>
                  <td className={`${NUM_CELL} py-3`}>{formatIdrFull(data.taxable_base)}</td>
                  <td className={`${NUM_CELL} py-3`}>{formatIdrFull(data.pb1_collected)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </PanelCard>
    </ReportShell>
  );
}
