// apps/pos/src/features/reports/POSPaymentsReportPage.tsx
//
// Reports POS refonte — Lot B — POS Reports / Payments tab.
//
// Répartition de l'encaissé par mode de paiement (Cash / Card / QRIS / EDC /
// Transfer / Store credit + « other »). Source serveur unique :
// get_pos_payment_breakdown_v1 — même périmètre que l'Overview (l'encaissé
// réconcilie avec le revenue, hors commandes outstanding). Barre de part par
// méthode + tuile total encaissé + export CSV.

import { type JSX } from 'react';
import { Wallet } from 'lucide-react';
import { Currency, KpiTile, SectionLabel, EmptyState, Button, cn } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore';
import { POSReportsLayout } from './components/POSReportsLayout';
import { usePOSReportsPayments, type POSReportsPaymentMethod } from './hooks/usePOSReports';
import type { ReportsPeriod } from './hooks/useReportsPeriod';
import { ReportsForbidden } from './components/ReportsForbidden';

/** Human-readable label for the known tender codes; unknown codes render as-is. */
const METHOD_LABELS: Record<string, string> = {
  cash: 'Cash',
  card: 'Card',
  qris: 'QRIS',
  edc: 'EDC',
  transfer: 'Bank transfer',
  store_credit: 'Store credit',
  other: 'Other',
};

function methodLabel(code: string): string {
  return METHOD_LABELS[code] ?? code;
}

export default function POSPaymentsReportPage(): JSX.Element {
  const canRead = useAuthStore((s) => s.hasPermission('reports.sales.read'));
  if (!canRead) return <ReportsForbidden />;

  return (
    <POSReportsLayout activeTab="payments">
      {(period) => <PaymentsBreakdown period={period} />}
    </POSReportsLayout>
  );
}

function downloadCsv(period: ReportsPeriod, rows: POSReportsPaymentMethod[]): void {
  const header = ['method', 'amount', 'tenders', 'share_pct'];
  const body = rows.map((r) => [methodLabel(r.method), r.amount, r.tenders, r.share_pct].join(','));
  const csv = [header.join(','), ...body].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `pos-payments_${period.startDate}_${period.endDate}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function PaymentsBreakdown({ period }: { period: ReportsPeriod }): JSX.Element {
  const { data, isLoading, isError } = usePOSReportsPayments(period);

  if (isLoading) return <p className="text-text-secondary text-sm">Loading payments…</p>;
  if (isError || !data) return <p className="text-red text-sm">Failed to load payments.</p>;
  if (data.byMethod.length === 0) {
    return (
      <EmptyState
        icon={Wallet}
        title="No payments recorded"
        description="No tenders cashed in during this period."
      />
    );
  }

  const maxAmount = Math.max(...data.byMethod.map((m) => m.amount), 1);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KpiTile
          label="Tendered"
          value={data.totalAmount}
          valueFormat="currency"
          icon={Wallet}
          footer={<>{data.totalOrders} order(s)</>}
        />
        <KpiTile
          label="Tenders"
          value={data.totalTenders}
          valueFormat="number"
        />
        <KpiTile
          label="Methods"
          value={data.byMethod.length}
          valueFormat="number"
        />
      </div>

      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <SectionLabel size="xs" as="h2">By payment method</SectionLabel>
          <div className="flex items-center gap-3">
            <span className="text-[10px] text-text-muted">{data.timezone}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => downloadCsv(period, data.byMethod)}
              data-testid="pos-payments-export-csv"
            >
              Export CSV
            </Button>
          </div>
        </div>
        <ul className="space-y-1.5">
          {data.byMethod.map((m) => (
            <PaymentMethodRow key={m.method} method={m} maxAmount={maxAmount} />
          ))}
        </ul>
      </section>
    </div>
  );
}

function PaymentMethodRow({
  method,
  maxAmount,
}: {
  method: POSReportsPaymentMethod;
  maxAmount: number;
}): JSX.Element {
  const widthPct = (method.amount / maxAmount) * 100;
  return (
    <li
      className="relative overflow-hidden rounded-md border border-border-subtle bg-bg-elevated"
      data-testid={`payment-method-${method.method}`}
    >
      <div
        aria-hidden
        className="absolute inset-y-0 left-0 bg-gold-soft"
        style={{ width: `${Math.max(widthPct, 4)}%` }}
      />
      <div className="relative flex items-center gap-3 px-3 py-2.5">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-text-primary truncate">
            {methodLabel(method.method)}
          </div>
          <div className="text-xs text-text-muted">
            {method.tenders} tender(s) · {method.share_pct}%
          </div>
        </div>
        <Currency
          amount={method.amount}
          className={cn('font-mono text-sm font-semibold')}
        />
      </div>
    </li>
  );
}
