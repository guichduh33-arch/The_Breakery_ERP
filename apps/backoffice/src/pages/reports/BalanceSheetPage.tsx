// apps/backoffice/src/pages/reports/BalanceSheetPage.tsx
//
// Lot E (campagne Reports 2026-08-15) — vague Finance, page 6/8. Migrée sur le
// socle Report shell v2 (archétype maquette 4c, patron : DailySalesPage).
//
// CE QUI NE CHANGE PAS : les trois sections de `get_balance_sheet_v2` — actif
// (courant, immobilisé), passif (courant, long terme), capitaux propres — avec
// leurs postes, leur ordre et leurs totaux, servis tels quels. L'INDICATEUR
// D'ÉQUILIBRE reste : A = L + E + CYE au centime, et il crie quand ce n'est
// plus vrai. Aucun solde n'est recalculé ici.
//
// La période est une PHOTO, pas une fenêtre. Le contrôle du socle est donc en
// variante `as-of` : une seule date, jamais un « From / To » qui laisserait
// croire à un cumul. Les anciens liens `?asOf=` restent honorés.
//
// SÉMANTIQUE DU DÉFAUT — sans param d'URL, le bilan s'ouvre sur AUJOURD'HUI, et
// il ne participe pas à la période partagée de la session (`sharedSession:
// false`). Le partage n'a de sens qu'entre rapports qui lisent une FENÊTRE, et
// il cassait ici dans les deux sens : à l'ouverture, le bilan héritait d'une
// date passée que personne n'avait demandée — sur un état de comptes, montrer
// hier pour aujourd'hui n'est pas une commodité, c'est un chiffre faux ; à la
// sortie, il réinjectait `start = end` dans la clé, et le rapport suivant
// s'ouvrait alors sur une seule journée.
//
// COMPARAISON CUSTOM, CONSERVÉE TELLE QUELLE : `previousPeriod(asOf, asOf)`
// retournerait LA VEILLE, ce qui sur un instantané ne dit rien — les soldes
// bougent peu en 24 h. La page compare à la MÊME DATE UN MOIS PLUS TÔT, et le
// libellé le dit. C'est le seul écart au socle de la vague, il est délibéré.
//
// Aucun graphe : un bilan est un état d'équilibre à un instant, pas une série.
// Les trois sections et leur détail par compte sont la lecture.

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
import { useReportPeriod } from '@/features/reports/hooks/useReportPeriod.js';
import { useBalanceSheet, type BalanceSheet } from '@/features/reports/hooks/useBalanceSheet.js';
import { formatIdrCompact, formatIdrFull } from '@/features/reports/utils/chartColors.js';
import { longDate, pctChange } from '@/features/reports/utils/reportFigures.js';

interface BsRow { section: string; account: string; value: number }

function buildBsRows(d: BalanceSheet): BsRow[] {
  return [
    { section: 'Assets',      account: 'Cash',                  value: d.assets.current.cash },
    { section: 'Assets',      account: 'Accounts receivable',   value: d.assets.current.ar },
    { section: 'Assets',      account: 'Inventory',             value: d.assets.current.inventory },
    { section: 'Assets',      account: 'Other current',         value: d.assets.current.other },
    { section: 'Assets',      account: 'Fixed assets',          value: d.assets.fixed.total },
    { section: 'Assets',      account: 'Total assets',          value: d.assets.total },
    { section: 'Liabilities', account: 'Accounts payable',      value: d.liabilities.current.ap },
    { section: 'Liabilities', account: 'Tax payable',           value: d.liabilities.current.tax_payable },
    { section: 'Liabilities', account: 'Loyalty liability',     value: d.liabilities.current.loyalty },
    { section: 'Liabilities', account: 'Other current',         value: d.liabilities.current.other },
    { section: 'Liabilities', account: 'Long-term liabilities', value: d.liabilities.long_term.total },
    { section: 'Liabilities', account: 'Total liabilities',     value: d.liabilities.total },
    { section: 'Equity',      account: 'Share capital',         value: d.equity.share_capital },
    { section: 'Equity',      account: 'Retained earnings',     value: d.equity.retained_earnings },
    { section: 'Equity',      account: 'Current year earnings', value: d.equity.current_year_earnings },
    { section: 'Equity',      account: 'Other',                 value: d.equity.other },
    { section: 'Equity',      account: 'Total equity',          value: d.equity.total },
  ];
}

const bsCsvColumns: CsvColumn<BsRow>[] = [
  { header: 'Section', accessor: (r) => r.section, format: 'text' },
  { header: 'Account', accessor: (r) => r.account, format: 'text' },
  { header: 'Value',   accessor: (r) => r.value,   format: 'idr-round100' },
];

const fmt = formatIdrFull;
const NUM_CELL = 'py-2 text-right font-data tabular-nums';
const SUB_CELL = 'py-1 text-right font-data text-xs tabular-nums';
const TOTAL_ROW = 'border-t-2 border-border-subtle bg-gold-soft';

/** Aucun compte ne porte de solde à cette date. */
function isBlankBalanceSheet(d: BalanceSheet): boolean {
  return d.lines.length === 0
    && d.assets.total === 0 && d.liabilities.total === 0 && d.equity.total === 0;
}

/** La même date un mois plus tôt. Un 31 reporté sur un mois court déborde
 *  (31 mars → 31 février = 3 mars) : on retombe alors sur le dernier jour du
 *  mois visé. */
function oneMonthEarlier(asOf: string): string {
  const d = new Date(`${asOf}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return asOf;
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, d.getUTCDate()));
  if (target.getUTCMonth() !== (d.getUTCMonth() + 11) % 12) {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0)).toISOString().slice(0, 10);
  }
  return target.toISOString().slice(0, 10);
}

interface KpiDescriptor {
  key: string; label: string; value: string; title?: string;
  delta?: number | null; note?: string | undefined;
  /** Valeur signée négative — voir `tone` sur KpiTile. */
  tone?: 'neutral' | 'danger';
}

export default function BalanceSheetPage(): JSX.Element {
  // Le bilan n'a qu'une date : les deux bornes du socle la portent, et l'ancien
  // `?asOf=` alimente les deux. Défaut déterministe (aujourd'hui) et hors
  // période partagée — voir l'en-tête du fichier.
  const period = useReportPeriod({
    legacyKeys:    { start: 'asOf', end: 'asOf' },
    defaultPreset: 'today',
    sharedSession: false,
  });
  const asOf = period.end;

  const prevAsOf = useMemo(() => oneMonthEarlier(asOf), [asOf]);

  // Le solde affiché est CUMULÉ jusqu'à `asOf`. Ouvrir le grand livre sur la
  // seule journée `asOf` ne montrerait jamais la composition du solde cliqué :
  // on ouvre l'exercice en cours jusqu'à `asOf`.
  const drilldownStart = `${asOf.slice(0, 4)}-01-01`;

  const current  = useBalanceSheet(asOf);
  const compare  = useBalanceSheet(prevAsOf);
  const data     = current.data;
  const prevData = compare.data;
  const showDelta = period.compare && prevData !== undefined;

  const tiles: KpiDescriptor[] = [
    {
      key: 'assets', label: 'Total assets',
      value: formatIdrCompact(data?.assets.total ?? 0), title: formatIdrFull(data?.assets.total ?? 0),
      delta: pctChange(data?.assets.total ?? 0, prevData?.assets.total),
    },
    {
      key: 'liabilities', label: 'Total liabilities',
      value: formatIdrCompact(data?.liabilities.total ?? 0),
      title: formatIdrFull(data?.liabilities.total ?? 0),
      delta: pctChange(data?.liabilities.total ?? 0, prevData?.liabilities.total),
    },
    {
      // Des capitaux propres NÉGATIFS — le passif dépasse l'actif — rendaient
      // comme des capitaux propres sains. Le mot est celui du métier : un
      // déficit de capitaux propres se dit « deficit », pas « loss » (qui
      // appartient au compte de résultat, cf. ProfitLossPage).
      key: 'equity', label: 'Total equity',
      value: formatIdrCompact(data?.equity.total ?? 0), title: formatIdrFull(data?.equity.total ?? 0),
      delta: pctChange(data?.equity.total ?? 0, prevData?.equity.total),
      ...(data !== undefined && data.equity.total < 0
        ? { tone: 'danger' as const, note: 'deficit' }
        : {}),
    },
    {
      key: 'cash', label: 'Cash',
      value: formatIdrCompact(data?.assets.current.cash ?? 0),
      title: formatIdrFull(data?.assets.current.cash ?? 0),
      delta: pctChange(data?.assets.current.cash ?? 0, prevData?.assets.current.cash),
    },
    {
      key: 'cye', label: 'Current year earnings',
      value: formatIdrCompact(data?.equity.current_year_earnings ?? 0),
      title: formatIdrFull(data?.equity.current_year_earnings ?? 0),
      note:  'computed live, never posted',
    },
    {
      // Un équilibre n'a pas de variation : il tient ou il ne tient pas.
      key: 'balance-check', label: 'Balance check',
      value: data === undefined ? '—' : data.balanced ? 'Balanced' : 'Off',
      note:  data === undefined ? undefined : `delta ${fmt(data.delta)}`,
    },
  ];

  const meta = [
    `As of ${longDate(asOf)}`,
    'assets, liabilities and equity · CYE computed live',
  ].join(' · ');

  const toolbar = (
    <>
      <PeriodControl period={period} variant="as-of" showCompare />
      <ExportMenu
        csv={{
          rows: data !== undefined ? buildBsRows(data) : [],
          columns: bsCsvColumns,
          filename: `balance-sheet-${asOf}`,
        }}
        {...(data !== undefined
          ? {
              pdf: {
                template: 'bs' as const,
                data,
                filename: `balance-sheet-${asOf}`,
                ...(showDelta && prevData !== undefined ? { comparePrevious: { data: prevData } } : {}),
              },
            }
          : {})}
        disabled={data === undefined}
      />
    </>
  );

  /** Poste de détail d'une section. */
  const item = (label: string, value: number): JSX.Element => (
    <tr key={label}>
      <td className="py-1 pl-4 text-xs text-text-secondary">{label}</td>
      <td className={SUB_CELL}>{fmt(value)}</td>
    </tr>
  );

  /** Ligne « vs 1 month earlier » — le libellé nomme la base de comparaison,
   *  qui n'est PAS la période précédente symétrique du socle. */
  const vsPrev = (currentValue: number, previousValue: number): JSX.Element => (
    <tr>
      <td className="py-1 text-xs text-text-secondary">vs 1 month earlier</td>
      <td className="py-1 text-right">
        <DeltaPct current={currentValue} previous={previousValue} />
      </td>
    </tr>
  );

  return (
    <ReportShell
      title="Balance Sheet"
      subtitle={meta}
      breadcrumb={[{ label: 'Reports', to: '/backoffice/reports' }, { label: 'Financial' }]}
      toolbar={toolbar}
      error={current.error}
      isEmpty={!current.isLoading && data !== undefined && isBlankBalanceSheet(data)}
      emptyState={{
        title: 'No balances',
        description: 'No account carries a balance as of this date.',
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
              {t.delta !== undefined && <Delta value={t.delta} period="1 mo" onInk={i === 0} />}
              {t.note !== undefined && (
                <span className={i === 0 ? KPI_NOTE_HERO : KPI_NOTE}>{t.note}</span>
              )}
            </KpiTile>
          ))}
        </KpiBand>
      }
    >
      {data !== undefined && (
        <div
          className={data.balanced
            ? 'rounded-sm border border-success bg-success-soft px-4 py-2 text-sm text-success'
            : 'rounded-sm border border-danger bg-danger-soft px-4 py-2 text-sm text-danger'}
          role={data.balanced ? 'status' : 'alert'}
          aria-label="Balanced indicator"
          data-testid="bs-balanced"
        >
          {data.balanced
            ? `Balanced: Assets = Liabilities + Equity (delta ${fmt(data.delta)})`
            : `Not balanced (delta ${fmt(data.delta)})`}
        </div>
      )}

      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <PanelCard title="Assets" isLoading={current.isLoading} testId="bs-assets">
          <table className="w-full text-sm">
            <caption className="sr-only">Current and fixed assets</caption>
            <tbody>
              <tr className="border-b border-border-subtle">
                <td className="py-2 font-medium">Current assets</td>
                <td className={`${NUM_CELL} font-medium`}>{fmt(data?.assets.current.total ?? 0)}</td>
              </tr>
              {item('Cash',                data?.assets.current.cash      ?? 0)}
              {item('Accounts receivable', data?.assets.current.ar        ?? 0)}
              {item('Inventory',           data?.assets.current.inventory ?? 0)}
              {item('Other current',       data?.assets.current.other     ?? 0)}
              <tr className="border-b border-border-subtle">
                <td className="py-2 font-medium">Fixed assets</td>
                <td className={`${NUM_CELL} font-medium`}>{fmt(data?.assets.fixed.total ?? 0)}</td>
              </tr>
              <tr className={TOTAL_ROW}>
                <td className="py-3 font-semibold uppercase tracking-wider">Total assets</td>
                <td className={`${NUM_CELL} py-3 font-semibold`}>{fmt(data?.assets.total ?? 0)}</td>
              </tr>
              {showDelta && prevData !== undefined
                && vsPrev(data?.assets.total ?? 0, prevData.assets.total)}
            </tbody>
          </table>
        </PanelCard>

        <PanelCard title="Liabilities" isLoading={current.isLoading} testId="bs-liabilities">
          <table className="w-full text-sm">
            <caption className="sr-only">Current and long-term liabilities</caption>
            <tbody>
              <tr className="border-b border-border-subtle">
                <td className="py-2 font-medium">Current liabilities</td>
                <td className={`${NUM_CELL} font-medium`}>
                  {fmt(data?.liabilities.current.total ?? 0)}
                </td>
              </tr>
              {item('Accounts payable',  data?.liabilities.current.ap          ?? 0)}
              {item('Tax payable',       data?.liabilities.current.tax_payable ?? 0)}
              {item('Loyalty liability', data?.liabilities.current.loyalty     ?? 0)}
              {item('Other current',     data?.liabilities.current.other       ?? 0)}
              <tr className="border-b border-border-subtle">
                <td className="py-2 font-medium">Long-term liabilities</td>
                <td className={`${NUM_CELL} font-medium`}>
                  {fmt(data?.liabilities.long_term.total ?? 0)}
                </td>
              </tr>
              <tr className={TOTAL_ROW}>
                <td className="py-3 font-semibold uppercase tracking-wider">Total liabilities</td>
                <td className={`${NUM_CELL} py-3 font-semibold`}>{fmt(data?.liabilities.total ?? 0)}</td>
              </tr>
              {showDelta && prevData !== undefined
                && vsPrev(data?.liabilities.total ?? 0, prevData.liabilities.total)}
            </tbody>
          </table>
        </PanelCard>

        <PanelCard title="Equity" isLoading={current.isLoading} testId="bs-equity">
          <table className="w-full text-sm">
            <caption className="sr-only">Share capital, retained and current-year earnings</caption>
            <tbody>
              <tr className="border-b border-border-subtle">
                <td className="py-2">Share capital</td>
                <td className={NUM_CELL}>{fmt(data?.equity.share_capital ?? 0)}</td>
              </tr>
              <tr className="border-b border-border-subtle">
                <td className="py-2">Retained earnings</td>
                <td className={NUM_CELL}>{fmt(data?.equity.retained_earnings ?? 0)}</td>
              </tr>
              <tr className="border-b border-border-subtle">
                <td className="py-2">Current year earnings</td>
                <td className={NUM_CELL}>{fmt(data?.equity.current_year_earnings ?? 0)}</td>
              </tr>
              <tr className="border-b border-border-subtle">
                <td className="py-2">Other</td>
                <td className={NUM_CELL}>{fmt(data?.equity.other ?? 0)}</td>
              </tr>
              <tr className={TOTAL_ROW}>
                <td className="py-3 font-semibold uppercase tracking-wider">Total equity</td>
                <td className={`${NUM_CELL} py-3 font-semibold`}>{fmt(data?.equity.total ?? 0)}</td>
              </tr>
              {showDelta && prevData !== undefined
                && vsPrev(data?.equity.total ?? 0, prevData.equity.total)}
            </tbody>
          </table>
        </PanelCard>
      </div>

      {(data?.lines.length ?? 0) > 0 && (
        <PanelCard
          title="Per-account detail"
          className="mt-3"
          isLoading={current.isLoading}
          testId="bs-account-detail"
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Debit, credit and balance per account as of the date</caption>
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
                  <tr key={l.account_id || l.code} className="border-b border-border-subtle">
                    <td className="py-2">
                      <DrilldownLink
                        entity="account"
                        id={l.account_id}
                        label={l.code}
                        filter={{ start: drilldownStart, end: asOf }}
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
      )}
    </ReportShell>
  );
}
