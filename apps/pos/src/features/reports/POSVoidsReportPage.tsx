// apps/pos/src/features/reports/POSVoidsReportPage.tsx
//
// Reports POS refonte — Lot C — POS Reports / Voids tab.
//
// Annulations & remises. Source serveur unique : get_pos_voids_refunds_v1 —
// même périmètre que l'Overview. Deux blocs :
//   * Voids & refunds — voids pleins + refunds partiels + annulations de ligne,
//     par motif / opérateur / autorisant + distinction avant/après cuisine.
//   * Discounts — remises par type & opérateur autorisant (comp = remise 100%).
// Export CSV des ventilations.

import { type JSX, type ReactNode } from 'react';
import { Ban, Undo2, Percent } from 'lucide-react';
import { Currency, KpiTile, SectionLabel, EmptyState, Button } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore';
import { POSReportsLayout } from './components/POSReportsLayout';
import {
  usePOSReportsVoidsRefunds,
  type POSReportsVoidsRefunds,
  type POSReportsBreakdownRow,
  type POSReportsReasonRow,
} from './hooks/usePOSReports';
import type { ReportsPeriod } from './hooks/useReportsPeriod';
import { ReportsForbidden } from './components/ReportsForbidden';

const DISCOUNT_TYPE_LABELS: Record<string, string> = {
  percentage: 'Percentage',
  fixed_amount: 'Fixed amount',
};

function discountTypeLabel(code: string): string {
  return DISCOUNT_TYPE_LABELS[code] ?? code;
}

function operatorLabel(row: POSReportsBreakdownRow): string {
  return row.operator_name ?? (row.operator_id ? row.operator_id.slice(0, 8) : '(unassigned)');
}

export default function POSVoidsReportPage(): JSX.Element {
  const canRead = useAuthStore((s) => s.hasPermission('reports.sales.read'));
  if (!canRead) return <ReportsForbidden />;

  return (
    <POSReportsLayout activeTab="voids">
      {(period) => <VoidsBreakdown period={period} />}
    </POSReportsLayout>
  );
}

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function downloadCsv(period: ReportsPeriod, data: POSReportsVoidsRefunds): void {
  const lines: string[] = ['section,label,count,amount'];
  const { reversals: rv, discounts: ds } = data;
  lines.push(`voids,Full voids,${rv.voids.count},${rv.voids.amount}`);
  lines.push(`refunds,Partial refunds,${rv.refunds.count},${rv.refunds.amount}`);
  lines.push(`item_cancellations,Item cancellations,${rv.itemCancellations.count},`);
  for (const r of rv.byReason) lines.push(`reversal_reason,${csvEscape(r.reason)},${r.count},${r.amount}`);
  for (const o of rv.byOperator) lines.push(`reversal_operator,${csvEscape(operatorLabel(o))},${o.count},${o.amount}`);
  for (const a of rv.byAuthorizer) lines.push(`reversal_authorizer,${csvEscape(operatorLabel(a))},${a.count},${a.amount}`);
  for (const t of ds.byType) lines.push(`discount_type,${csvEscape(discountTypeLabel(t.type))},${t.count},${t.amount}`);
  for (const o of ds.byOperator) lines.push(`discount_operator,${csvEscape(operatorLabel(o))},${o.count},${o.amount}`);

  const csv = lines.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `pos-voids-discounts_${period.startDate}_${period.endDate}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function VoidsBreakdown({ period }: { period: ReportsPeriod }): JSX.Element {
  const { data, isLoading, isError } = usePOSReportsVoidsRefunds(period);

  if (isLoading) return <p className="text-text-secondary text-sm">Loading voids &amp; discounts…</p>;
  if (isError || !data) return <p className="text-red text-sm">Failed to load voids &amp; discounts.</p>;

  const { reversals: rv, discounts: ds } = data;
  const hasReversals =
    rv.voids.count > 0 || rv.refunds.count > 0 || rv.itemCancellations.count > 0;
  const hasDiscounts = ds.orderCount > 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <KpiTile
          label="Full voids"
          value={rv.voids.amount}
          valueFormat="currency"
          icon={Ban}
          footer={<>{rv.voids.count} order(s)</>}
        />
        <KpiTile
          label="Partial refunds"
          value={rv.refunds.amount}
          valueFormat="currency"
          icon={Undo2}
          footer={<>{rv.refunds.count} refund(s)</>}
        />
        <KpiTile
          label="Item cancellations"
          value={rv.itemCancellations.count}
          valueFormat="number"
          footer={
            <>
              {rv.itemCancellations.afterKitchenCount} after · {rv.itemCancellations.beforeKitchenCount} before kitchen
            </>
          }
        />
        <KpiTile
          label="Discounts"
          value={ds.totalAmount}
          valueFormat="currency"
          icon={Percent}
          footer={
            <>
              {ds.orderCount} order(s){ds.compCount > 0 ? ` · ${ds.compCount} comp(s)` : ''}
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
          data-testid="pos-voids-export-csv"
        >
          Export CSV
        </Button>
      </div>

      {/* ── Voids & refunds ──────────────────────────────────────────────── */}
      <section className="space-y-3" data-testid="pos-voids-reversals">
        <SectionLabel size="xs" as="h2">Voids &amp; refunds</SectionLabel>
        {!hasReversals ? (
          <EmptyState
            icon={Ban}
            title="No voids or refunds"
            description="No orders were voided, refunded, or cancelled during this period."
          />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <BreakdownCard title="By reason">
              {rv.byReason.map((r) => (
                <ReasonRow key={r.reason} row={r} />
              ))}
            </BreakdownCard>
            <BreakdownCard title="By operator">
              {rv.byOperator.map((o) => (
                <OperatorRow key={o.operator_id ?? 'none'} row={o} />
              ))}
            </BreakdownCard>
            <BreakdownCard title="By authorizing manager">
              {rv.byAuthorizer.map((a) => (
                <OperatorRow key={a.operator_id ?? 'none'} row={a} />
              ))}
            </BreakdownCard>
          </div>
        )}
      </section>

      {/* ── Discounts ────────────────────────────────────────────────────── */}
      <section className="space-y-3" data-testid="pos-voids-discounts">
        <SectionLabel size="xs" as="h2">Discounts &amp; comps</SectionLabel>
        {!hasDiscounts ? (
          <EmptyState
            icon={Percent}
            title="No discounts"
            description="No discounts were applied during this period."
          />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <BreakdownCard title="By type">
              {ds.byType.map((t) => (
                <li
                  key={t.type}
                  className="flex items-center justify-between px-3 py-2 text-sm"
                  data-testid={`discount-type-${t.type}`}
                >
                  <span className="text-text-primary">
                    {discountTypeLabel(t.type)} <span className="text-text-muted">· {t.count}</span>
                  </span>
                  <Currency amount={t.amount} className="font-mono text-sm font-semibold" />
                </li>
              ))}
            </BreakdownCard>
            <BreakdownCard title="By operator">
              {ds.byOperator.map((o) => (
                <OperatorRow key={o.operator_id ?? 'none'} row={o} />
              ))}
            </BreakdownCard>
          </div>
        )}
      </section>
    </div>
  );
}

function BreakdownCard({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <div className="rounded-md border border-border-subtle bg-bg-elevated">
      <div className="px-3 py-2 border-b border-border-subtle text-xs font-semibold text-text-secondary">
        {title}
      </div>
      <ul className="divide-y divide-border-subtle">{children}</ul>
    </div>
  );
}

function ReasonRow({ row }: { row: POSReportsReasonRow }): JSX.Element {
  return (
    <li className="flex items-center justify-between px-3 py-2 text-sm">
      <span className="text-text-primary truncate">
        {row.reason} <span className="text-text-muted">· {row.count}</span>
      </span>
      <Currency amount={row.amount} className="font-mono text-sm font-semibold" />
    </li>
  );
}

function OperatorRow({ row }: { row: POSReportsBreakdownRow }): JSX.Element {
  return (
    <li className="flex items-center justify-between px-3 py-2 text-sm">
      <span className="text-text-primary truncate">
        {operatorLabel(row)} <span className="text-text-muted">· {row.count}</span>
      </span>
      <Currency amount={row.amount} className="font-mono text-sm font-semibold" />
    </li>
  );
}
