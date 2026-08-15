// apps/backoffice/src/pages/reports/OffHoursSalesPage.tsx
//
// ADR-006 déc. 9 (business hours) — « Off-Hours Sales » : les paiements
// encaissés HORS du créneau d'ouverture du jour. C'est un signal de fraude,
// pas un rapport de ventes.
//
// Lot G (campagne Reports 2026-08-15) — vague Journaux, page 2/5. Migrée sur le
// socle Report shell v2 (archétype maquette 4c, patron : PurchaseItemsPage).
//
// LA SÉMANTIQUE MÉTIER NE BOUGE PAS D'UN POUCE. La fenêtre horaire est calculée
// SERVEUR (`get_off_hours_sales_v1`) contre `business_hours` ; rien n'est
// recalculé ici, aucun seuil n'est deviné côté page. Un jour dont la config dit
// « fermé » (open/close à NULL) marque TOUT, et la colonne le dit par « Closed » ;
// un jour absent de la config ne marque JAMAIS rien. Ces deux règles sont celles
// de la RPC — les afficher autrement mentirait sur ce qui a été mesuré.
//
// L'ÉTAT VIDE EST UNE BONNE NOUVELLE, ET IL LE DIT. Zéro ligne ici signifie
// qu'aucun encaissement n'est tombé hors des horaires : c'est le résultat qu'on
// espère, pas une absence de données. Il reste UNE réserve à énoncer dans le
// même souffle — si les horaires d'ouverture ne sont pas configurés, la RPC ne
// peut RIEN marquer, et le vide ne prouve alors rien du tout.
//
// PAS DE COMPARAISON : « autant d'encaissements hors horaires que le mois
// dernier » n'est pas une information exploitable. Chaque ligne se traite pour
// elle-même. Les trois tuiles sobres ne sont pas des KPI inventés : ce sont les
// compteurs de synthèse que la RPC sert déjà (`summary`), et que l'écran
// affichait dans un pied de tableau.
//
// Params URL : `start` / `end` — les bornes portaient DÉJÀ les noms du socle
// (`useUrlState('start'/'end')`), aucun repli legacy n'est nécessaire. Seul le
// défaut change : 29 jours maison → 28 jours du socle, et la fenêtre suit
// désormais la navigation inter-rapports de la session.

import { useMemo, type JSX } from 'react';
import type { CsvColumn } from '@breakery/domain';
import { PanelCard } from '@/components/PanelCard.js';
import { KpiTile, KPI_NOTE, KPI_NOTE_HERO } from '@/components/kpi/KpiTile.js';
import { ReportShell } from '@/features/reports/components/ReportShell.js';
import { KpiBand } from '@/features/reports/components/KpiBand.js';
import { PeriodControl } from '@/features/reports/components/PeriodControl.js';
import { ExportMenu } from '@/features/reports/components/ExportMenu.js';
import { SortableTh } from '@/features/reports/components/SortableTh.js';
import { DrilldownLink } from '@/features/reports/components/DrilldownLink.js';
import { useReportPeriod } from '@/features/reports/hooks/useReportPeriod.js';
import { useSortedRows, type SortSpec } from '@/features/reports/hooks/useSortedRows.js';
import { formatIdrCompact, formatIdrFull } from '@/features/reports/utils/chartColors.js';
import { formatCount, periodLabel } from '@/features/reports/utils/reportFigures.js';
import {
  useOffHoursSales,
  type OffHoursSaleRow,
} from '@/features/reports/hooks/useOffHoursSales.js';

const DAY_LABELS: Record<string, string> = {
  mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday',
  fri: 'Friday', sat: 'Saturday', sun: 'Sunday',
};

/** Le créneau d'ouverture du jour, ou « Closed » quand la config n'en pose pas —
 *  un jour fermé marque tout, et c'est bien ce qu'il faut lire. */
function windowLabel(r: OffHoursSaleRow): string {
  return r.window_open !== null && r.window_close !== null
    ? `${r.window_open}–${r.window_close}`
    : 'Closed';
}

const csvColumns: CsvColumn<OffHoursSaleRow>[] = [
  { header: 'Local time',   accessor: (r) => r.local_time,              format: 'text' },
  { header: 'Day',          accessor: (r) => DAY_LABELS[r.day_key] ?? r.day_key, format: 'text' },
  { header: 'Window',       accessor: (r) => windowLabel(r),            format: 'text' },
  { header: 'Order',        accessor: (r) => r.order_number,            format: 'text' },
  { header: 'Method',       accessor: (r) => r.method,                  format: 'text' },
  { header: 'Amount (IDR)', accessor: (r) => r.amount,                  format: 'idr-round100' },
  { header: 'Cashier',      accessor: (r) => r.cashier ?? '',           format: 'text' },
];

type SortKey = 'time' | 'day' | 'order' | 'method' | 'amount' | 'cashier';

const SORT_SPECS: Record<SortKey, SortSpec<OffHoursSaleRow>> = {
  // `paid_at` est l'instant réel ; `local_time` est sa mise en forme. Trier sur
  // la seconde rangerait « 09:00 » avant « 9:00 » selon le jour.
  time:    { kind: 'date',   value: (r) => r.paid_at },
  day:     { kind: 'string', value: (r) => DAY_LABELS[r.day_key] ?? r.day_key },
  order:   { kind: 'string', value: (r) => r.order_number },
  method:  { kind: 'string', value: (r) => r.method },
  amount:  { kind: 'number', value: (r) => r.amount },
  cashier: { kind: 'string', value: (r) => r.cashier },
};

const NUM_CELL = 'py-2 text-right font-data tabular-nums';

interface KpiDescriptor { key: string; label: string; value: string; title?: string; note?: string }

export default function OffHoursSalesPage(): JSX.Element {
  const period = useReportPeriod();
  const { start, end } = period;

  const { data, isLoading, error } = useOffHoursSales({ start, end });

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const sorted = useSortedRows(rows, SORT_SPECS);

  const tiles: KpiDescriptor[] = [
    {
      key: 'payments', label: 'Flagged payments',
      value: formatCount(data?.paymentCount ?? 0),
      note:  'outside the opening window',
    },
    {
      key: 'orders', label: 'Orders concerned',
      value: formatCount(data?.orderCount ?? 0),
      note:  'one order can carry several payments',
    },
    {
      key: 'amount', label: 'Flagged amount',
      value: formatIdrCompact(data?.totalAmount ?? 0),
      title: formatIdrFull(data?.totalAmount ?? 0),
      note:  'total taken off-hours',
    },
  ];

  const toolbar = (
    <>
      <PeriodControl period={period} />
      <ExportMenu
        csv={{ rows, columns: csvColumns, filename: `off-hours-sales-${start}_${end}` }}
        disabled={rows.length === 0}
      />
    </>
  );

  return (
    <ReportShell
      title="Off-Hours Sales"
      subtitle={`${periodLabel(start, end)} · payments taken outside the configured business hours`}
      breadcrumb={[{ label: 'Reports', to: '/backoffice/reports' }, { label: 'Audit' }]}
      toolbar={toolbar}
      error={error}
      isEmpty={!isLoading && error === null && data !== undefined && rows.length === 0}
      emptyState={{
        title: 'Nothing was taken off-hours',
        description:
          'No payment fell outside the opening window over this period — that is the expected result. '
          + 'One reservation: if business hours are not configured yet (Settings → Business Hours), '
          + 'nothing can ever be flagged, and this emptiness proves nothing.',
      }}
      kpis={
        <KpiBand
          isLoading={isLoading}
          tiles={tiles.length}
          labels={tiles.map((t) => t.label)}
          className="xl:grid-cols-3"
        >
          {tiles.map((t, i) => (
            <KpiTile
              key={t.key}
              label={t.label}
              value={t.value}
              {...(t.title !== undefined ? { valueTitle: t.title } : {})}
              hero={i === 0}
              testId={`kpi-${t.key}`}
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
        title="Flagged payments"
        subtitle="One line per payment, with the opening window it fell outside of."
        isLoading={isLoading}
        testId="off-hours-table"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">
              Local time, day, opening window, order, method, amount and cashier per flagged payment
            </caption>
            <thead>
              <tr className="border-b border-border-subtle text-text-secondary">
                <SortableTh label="Local time" sortKey="time"    sorted={sorted} />
                <SortableTh label="Day"        sortKey="day"     sorted={sorted} />
                {/* Le créneau n'est pas un ordre : deux jours peuvent porter la
                    même fenêtre, et « Closed » n'a pas de rang parmi des heures. */}
                <SortableTh label="Window"                       sorted={sorted} />
                <SortableTh label="Order"      sortKey="order"   sorted={sorted} />
                <SortableTh label="Method"     sortKey="method"  sorted={sorted} />
                <SortableTh label="Amount"     sortKey="amount"  sorted={sorted} align="right" />
                <SortableTh label="Cashier"    sortKey="cashier" sorted={sorted} />
              </tr>
            </thead>
            <tbody>
              {sorted.rows.map((r, i) => (
                <tr key={`${r.order_id}-${r.paid_at}-${i}`} className="border-b border-border-subtle">
                  <td className="py-2 font-data tabular-nums">{r.local_time}</td>
                  <td className="py-2">{DAY_LABELS[r.day_key] ?? r.day_key}</td>
                  <td className="py-2 font-data tabular-nums text-text-secondary">{windowLabel(r)}</td>
                  <td className="py-2">
                    <DrilldownLink entity="order" id={r.order_id} label={r.order_number} icon={false} />
                  </td>
                  <td className="py-2 capitalize">{r.method}</td>
                  <td className={NUM_CELL}>{formatIdrFull(r.amount)}</td>
                  <td className="py-2">{r.cashier ?? '—'}</td>
                </tr>
              ))}
            </tbody>
            {rows.length > 0 && data !== undefined && (
              <tfoot>
                <tr className="border-t border-border-subtle font-semibold">
                  <td className="py-2" colSpan={5}>
                    Total — {formatCount(data.paymentCount)} payment{data.paymentCount === 1 ? '' : 's'} on{' '}
                    {formatCount(data.orderCount)} order{data.orderCount === 1 ? '' : 's'}
                  </td>
                  <td className={NUM_CELL}>{formatIdrFull(data.totalAmount)}</td>
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
