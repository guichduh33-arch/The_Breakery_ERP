// apps/pos/src/features/reports/POSReportsOverviewPage.tsx
//
// POS Reports / Overview tab — the at-a-glance dashboard that consolidates the
// period's headline numbers and the charts that matter most:
//   * KPI strip: Revenue (TTC), Orders, Items sold, Avg basket.
//   * Sales trend: by-day bars for multi-day ranges, by-hour for a single day.
//   * Payment mix: share of the tendered total by method (reuses Lot B).
//   * Top products: the 5 best sellers by revenue (reuses Lot F).
// All figures come from server RPCs sharing one canonical order scope, so the
// Overview reconciles with the Payments / Mix / Products tabs.

import { type JSX } from 'react';
import { ShoppingCart, Receipt, Coins, Package, Trophy, Wallet } from 'lucide-react';
import { Currency, KpiTile, SectionLabel, EmptyState, cn } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore';
import { POSReportsLayout } from './components/POSReportsLayout';
import {
  usePOSReportsOverview,
  usePOSReportsPayments,
  usePOSReportsTopProducts,
} from './hooks/usePOSReports';
import type { ReportsPeriod } from './hooks/useReportsPeriod';
import { ReportsForbidden } from './components/ReportsForbidden';

const PAYMENT_LABELS: Record<string, string> = {
  cash: 'Cash',
  card: 'Card',
  qris: 'QRIS',
  edc: 'EDC',
  transfer: 'Transfer',
  store_credit: 'Store credit',
  b2b_credit: 'B2B credit',
};

function paymentLabel(method: string): string {
  return PAYMENT_LABELS[method] ?? method.replace(/_/g, ' ');
}

export default function POSReportsOverviewPage(): JSX.Element {
  const canRead = useAuthStore((s) => s.hasPermission('reports.sales.read'));
  if (!canRead) return <ReportsForbidden />;

  return (
    <POSReportsLayout activeTab="overview">
      {(period) => <Overview period={period} />}
    </POSReportsLayout>
  );
}

function Overview({ period }: { period: ReportsPeriod }): JSX.Element {
  const { data, isLoading, isError } = usePOSReportsOverview(period);

  if (isLoading) {
    return <p className="text-text-secondary text-sm">Loading overview…</p>;
  }
  if (isError || !data) {
    return <p className="text-red text-sm">Failed to load overview.</p>;
  }

  // Multi-day range → daily trend; single day → hourly trend.
  const multiDay = data.byDay.length > 1;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiTile
          label="Revenue (incl. tax)"
          value={data.revenue}
          valueFormat="currency"
          icon={Receipt}
          footer={<>of which tax: <Currency amount={data.tax} className="font-mono" /></>}
        />
        <KpiTile label="Orders" value={data.orders} valueFormat="number" icon={ShoppingCart} />
        <KpiTile label="Items sold" value={data.itemsSold} valueFormat="number" icon={Package} />
        <KpiTile label="Avg Basket" value={data.avgBasket} valueFormat="currency" icon={Coins} />
      </div>

      <section className="rounded-lg border border-border-subtle bg-bg-elevated p-5">
        <div className="flex items-baseline justify-between">
          <SectionLabel size="xs" as="h2">{multiDay ? 'Sales by day' : 'Sales by hour'}</SectionLabel>
          <span className="text-[10px] text-text-muted">{data.timezone}</span>
        </div>
        {multiDay ? (
          <TrendChart
            bars={data.byDay.map((d) => ({
              key: d.date,
              label: dayLabel(d.date),
              value: d.revenue,
              tickets: d.tickets,
            }))}
          />
        ) : (
          <TrendChart
            bars={data.salesByHour.map((h) => ({
              key: String(h.hour),
              label: `${h.hour}h`,
              value: h.revenue,
              tickets: h.tickets,
            }))}
          />
        )}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <PaymentMix period={period} />
        <TopProducts period={period} />
      </div>
    </div>
  );
}

// ─── Sales trend bar chart (CSS-only) ───────────────────────────────────────
//
// Columns stretch to the container's fixed height so the percentage-height bars
// resolve against a definite parent — the classic "empty bars" trap is avoided
// by NOT using items-end (which would collapse each column to content height).

interface TrendBar {
  key: string;
  label: string;
  value: number;
  tickets: number;
}

function TrendChart({ bars }: { bars: TrendBar[] }): JSX.Element {
  const max = Math.max(...bars.map((b) => b.value), 1);
  return (
    <>
      <div className="mt-4 h-56 flex items-stretch gap-1 border-b border-border-subtle pb-1">
        {bars.map((b) => {
          const heightPct = (b.value / max) * 100;
          return (
            <div
              key={b.key}
              className="flex-1 flex flex-col justify-end min-w-0"
              aria-label={`${b.label}: ${b.value} across ${b.tickets} ticket(s)`}
              title={`${b.label} — ${b.tickets} ticket(s)`}
            >
              <div
                className={cn(
                  'w-full rounded-t-md transition-all motion-reduce:transition-none',
                  b.value > 0 ? 'bg-gold' : 'bg-bg-overlay/50',
                )}
                style={{ height: `${b.value > 0 ? Math.max(heightPct, 2) : 0}%` }}
                data-testid={`trend-bar-${b.key}`}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex gap-1 text-[10px] text-text-muted">
        {bars.map((b) => (
          <div key={b.key} className="flex-1 text-center truncate">
            {b.label}
          </div>
        ))}
      </div>
    </>
  );
}

// ─── Payment mix ────────────────────────────────────────────────────────────

function PaymentMix({ period }: { period: ReportsPeriod }): JSX.Element {
  const { data, isLoading, isError } = usePOSReportsPayments(period);

  return (
    <section className="rounded-lg border border-border-subtle bg-bg-elevated p-5">
      <SectionLabel size="xs" as="h2">Payment mix</SectionLabel>
      {isLoading ? (
        <p className="mt-4 text-text-secondary text-sm">Loading…</p>
      ) : isError || !data ? (
        <p className="mt-4 text-red text-sm">Failed to load payments.</p>
      ) : data.byMethod.length === 0 ? (
        <EmptyState icon={Wallet} title="No payments" description="No tenders in this period." />
      ) : (
        <ul className="mt-4 space-y-3">
          {data.byMethod.map((m) => (
            <li key={m.method} data-testid={`pay-mix-${m.method}`}>
              <div className="flex items-center justify-between text-sm">
                <span className="font-semibold text-text-primary">{paymentLabel(m.method)}</span>
                <span className="font-mono text-text-secondary">
                  <Currency amount={m.amount} /> · {m.share_pct.toFixed(1)}%
                </span>
              </div>
              <div className="mt-1 h-2 rounded-full bg-bg-overlay/50 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gold"
                  style={{ width: `${Math.min(Math.max(m.share_pct, 0), 100)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ─── Top products ───────────────────────────────────────────────────────────

const TOP_N = 5;

function TopProducts({ period }: { period: ReportsPeriod }): JSX.Element {
  const { data, isLoading, isError } = usePOSReportsTopProducts(period, TOP_N);

  return (
    <section className="rounded-lg border border-border-subtle bg-bg-elevated p-5">
      <SectionLabel size="xs" as="h2">Top products</SectionLabel>
      {isLoading ? (
        <p className="mt-4 text-text-secondary text-sm">Loading…</p>
      ) : isError ? (
        <p className="mt-4 text-red text-sm">Failed to load products.</p>
      ) : !data || data.length === 0 ? (
        <EmptyState icon={Trophy} title="No products sold" description="No transactions in this period." />
      ) : (
        <ol className="mt-4 space-y-2">
          {data.map((p, i) => (
            <li
              key={p.product_id}
              className="flex items-center gap-3"
              data-testid={`overview-top-product-${p.product_id}`}
            >
              <span
                className={cn(
                  'h-6 w-6 inline-flex items-center justify-center rounded-md text-xs font-bold shrink-0',
                  i === 0
                    ? 'bg-gold text-bg-base'
                    : 'bg-bg-overlay border border-border-subtle text-text-secondary',
                )}
              >
                {i + 1}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-text-primary truncate">{p.product_name}</div>
                <div className="text-xs text-text-muted">{p.qty} sold</div>
              </div>
              <Currency amount={p.revenue} className="font-mono text-sm font-semibold" />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** `YYYY-MM-DD` → short `DD Mon` label for the daily axis. */
function dayLabel(iso: string): string {
  const [, m, d] = iso.split('-');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const mi = Number(m) - 1;
  return `${d} ${months[mi] ?? ''}`.trim();
}
