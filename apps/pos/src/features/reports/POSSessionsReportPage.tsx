// apps/pos/src/features/reports/POSSessionsReportPage.tsx
//
// Reports POS refonte — Lot D — POS Reports / Sessions (Z-report) tab.
//
// One row per drawer lifecycle (pos_session), REPLACING the Activity tab's
// confusing "Session Open N ≠ Session Close M" counters with a single lifecycle
// count. Source serveur unique : get_pos_sessions_report_v1 — même plage WITA.
// Chaque ligne : statut (open/closed), caissier, ouverture→clôture, fond de
// caisse, ventes live du tiroir, et l'écart figé des 3 volets (cash/QRIS/carte).
// Export CSV.

import { type JSX } from 'react';
import { Layers, Coins, Scale } from 'lucide-react';
import { Currency, KpiTile, EmptyState, Button, cn } from '@breakery/ui';
import { formatIdr } from '@breakery/utils';
import { useAuthStore } from '@/stores/authStore';
import { POSReportsLayout } from './components/POSReportsLayout';
import {
  usePOSReportsSessions,
  type POSReportsSessions,
  type POSReportsSession,
  type POSReportsReconVolet,
} from './hooks/usePOSReports';
import type { ReportsPeriod } from './hooks/useReportsPeriod';
import { ReportsForbidden } from './components/ReportsForbidden';

export default function POSSessionsReportPage(): JSX.Element {
  const canRead = useAuthStore((s) => s.hasPermission('reports.sales.read'));
  if (!canRead) return <ReportsForbidden />;

  return (
    <POSReportsLayout activeTab="sessions">
      {(period) => <SessionsReport period={period} />}
    </POSReportsLayout>
  );
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  const dt = new Date(iso);
  const date = dt.toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
  const time = dt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `${date} ${time}`;
}

/** Signed IDR for a variance cell: "—" when not counted, sign + colour otherwise. */
function varianceText(v: number | null): { text: string; tone: string } {
  if (v === null) return { text: '—', tone: 'text-text-muted' };
  if (v === 0) return { text: formatIdr(0), tone: 'text-text-muted' };
  const sign = v > 0 ? '+' : '';
  return {
    text: `${sign}${formatIdr(v)}`,
    // short (manque) = red, over (excédent) = gold — mirrors the close screen.
    tone: v < 0 ? 'text-red' : 'text-gold',
  };
}

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function voletCsv(v: POSReportsReconVolet): string {
  const cell = (n: number | null) => (n === null ? '' : String(n));
  return `${cell(v.expected)},${cell(v.counted)},${cell(v.variance)}`;
}

function downloadCsv(period: ReportsPeriod, data: POSReportsSessions): void {
  const header =
    'status,cashier,closed_by,opened_at,closed_at,opening_cash,sales,order_count,' +
    'refunds,voids,cash_expected,cash_counted,cash_variance,' +
    'qris_expected,qris_counted,qris_variance,card_expected,card_counted,card_variance,' +
    'variance_approved';
  const lines: string[] = [header];
  for (const s of data.sessions) {
    lines.push(
      [
        s.status,
        csvEscape(s.cashierName),
        csvEscape(s.closedByName ?? ''),
        s.openedAt,
        s.closedAt ?? '',
        String(s.openingCash),
        String(s.salesTotal),
        String(s.orderCount),
        String(s.refundsTotal),
        String(s.voidsTotal),
        voletCsv(s.cash),
        voletCsv(s.qris),
        voletCsv(s.card),
        s.varianceApproved ? 'yes' : 'no',
      ].join(','),
    );
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `pos-sessions_${period.startDate}_${period.endDate}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function SessionsReport({ period }: { period: ReportsPeriod }): JSX.Element {
  const { data, isLoading, isError } = usePOSReportsSessions(period);

  if (isLoading) return <p className="text-text-secondary text-sm">Loading sessions…</p>;
  if (isError || !data) return <p className="text-red text-sm">Failed to load sessions.</p>;

  const { summary: sm, sessions } = data;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KpiTile
          label="Sessions"
          value={sm.totalSessions}
          valueFormat="number"
          icon={Layers}
          footer={
            <>
              {sm.openCount} open · {sm.closedCount} closed
            </>
          }
        />
        <KpiTile
          label="Sales (drawers)"
          value={sm.salesTotal}
          valueFormat="currency"
          icon={Coins}
        />
        <KpiTile
          label="Cash variance"
          value={sm.cashVarianceTotal}
          valueFormat="currency"
          icon={Scale}
          footer={
            <>
              {sm.cashShortCount} short · {sm.cashOverCount} over
            </>
          }
        />
      </div>

      <div className="flex items-center justify-between">
        <span className="text-[10px] text-text-muted">{data.timezone}</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => downloadCsv(period, data)}
          data-testid="pos-sessions-export-csv"
        >
          Export CSV
        </Button>
      </div>

      {sessions.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="No sessions"
          description="No cash drawers were opened during this period."
        />
      ) : (
        <div
          className="overflow-x-auto rounded-lg border border-border-subtle"
          data-testid="pos-sessions-table"
        >
          <table className="w-full text-sm min-w-[820px]">
            <thead>
              <tr className="border-b border-border-subtle text-left text-xs text-text-secondary">
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 font-semibold">Cashier</th>
                <th className="px-3 py-2 font-semibold">Opened → Closed</th>
                <th className="px-3 py-2 font-semibold text-right">Opening</th>
                <th className="px-3 py-2 font-semibold text-right">Sales</th>
                <th className="px-3 py-2 font-semibold text-right">Cash Δ</th>
                <th className="px-3 py-2 font-semibold text-right">QRIS Δ</th>
                <th className="px-3 py-2 font-semibold text-right">Card Δ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {sessions.map((s) => (
                <SessionRow key={s.sessionId} session={s} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function VarianceCell({ value }: { value: number | null }): JSX.Element {
  const { text, tone } = varianceText(value);
  return <span className={cn('font-mono tabular-nums', tone)}>{text}</span>;
}

function SessionRow({ session: s }: { session: POSReportsSession }): JSX.Element {
  const isOpen = s.status === 'open';
  return (
    <tr data-testid={`session-${s.sessionId}`} className="hover:bg-bg-overlay/40">
      <td className="px-3 py-2">
        <span
          data-testid="session-status-badge"
          className={cn(
            'inline-flex items-center px-2 h-6 rounded-full text-[10px] font-bold uppercase tracking-wider',
            isOpen ? 'bg-blue-info/15 text-blue-info' : 'bg-text-muted/15 text-text-muted',
          )}
        >
          {s.status}
        </span>
        {s.varianceApproved ? (
          <span className="ml-1 inline-flex items-center px-1.5 h-6 rounded-full text-[10px] font-bold uppercase bg-gold-soft text-gold">
            PIN
          </span>
        ) : null}
      </td>
      <td className="px-3 py-2">
        <div className="text-text-primary">{s.cashierName}</div>
        {s.closedByName && s.closedByName !== s.cashierName ? (
          <div className="text-[10px] text-text-muted">closed by {s.closedByName}</div>
        ) : null}
      </td>
      <td className="px-3 py-2 text-text-secondary whitespace-nowrap">
        {fmtDateTime(s.openedAt)}
        <span className="text-text-muted"> → </span>
        {isOpen ? <span className="text-blue-info">open</span> : fmtDateTime(s.closedAt)}
      </td>
      <td className="px-3 py-2 text-right">
        <Currency amount={s.openingCash} className="text-text-secondary" />
      </td>
      <td className="px-3 py-2 text-right">
        <Currency amount={s.salesTotal} emphasis="gold" />
      </td>
      <td className="px-3 py-2 text-right">
        <VarianceCell value={s.cash.variance} />
      </td>
      <td className="px-3 py-2 text-right">
        <VarianceCell value={s.qris.variance} />
      </td>
      <td className="px-3 py-2 text-right">
        <VarianceCell value={s.card.variance} />
      </td>
    </tr>
  );
}
