// apps/pos/src/features/reports/POSReportsOverviewPage.tsx
//
// Session 14 — Phase 2.D — POS Reports / Overview tab.
//
// Visual ref: 82-pos-reports-overview-today.jpg.
//
// KPI strip (3 tiles): REVENUE / ORDERS / AVG BASKET.
// Below: SALES BY HOUR bar chart (CSS-only — no charting lib).

import { type JSX } from 'react';
import { ShoppingCart, Receipt, Coins } from 'lucide-react';
import { Currency, KpiTile, SectionLabel, cn } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore';
import { POSReportsLayout } from './components/POSReportsLayout';
import { usePOSReportsOverview } from './hooks/usePOSReports';
import type { ReportsPeriod } from './hooks/useReportsPeriod';
import { ReportsForbidden } from './components/ReportsForbidden';

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

  const maxHour = Math.max(...data.salesByHour.map((s) => s.revenue), 1);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KpiTile
          label="Revenue (incl. tax)"
          value={data.revenue}
          valueFormat="currency"
          icon={Receipt}
          footer={<>of which tax: <Currency amount={data.tax} className="font-mono" /></>}
        />
        <KpiTile
          label="Orders"
          value={data.orders}
          valueFormat="number"
          icon={ShoppingCart}
        />
        <KpiTile
          label="Avg Basket"
          value={data.avgBasket}
          valueFormat="currency"
          icon={Coins}
        />
      </div>

      <section className="rounded-lg border border-border-subtle bg-bg-elevated p-5">
        <div className="flex items-baseline justify-between">
          <SectionLabel size="xs" as="h2">Sales by hour</SectionLabel>
          <span className="text-[10px] text-text-muted">{data.timezone}</span>
        </div>
        <div className="mt-4 h-48 flex items-end gap-1 border-b border-border-subtle pb-1">
          {data.salesByHour.map((s) => {
            const heightPct = (s.revenue / maxHour) * 100;
            return (
              <div
                key={s.hour}
                className="flex-1 flex flex-col items-center justify-end gap-1 min-w-0"
                aria-label={`${s.hour}h: ${s.revenue} across ${s.tickets} ticket(s)`}
                title={`${s.hour}:00 — ${s.tickets} ticket(s)`}
              >
                <div
                  className={cn(
                    'w-full rounded-t-md transition-all',
                    s.revenue > 0 ? 'bg-gold' : 'bg-bg-overlay/60',
                  )}
                  style={{ height: `${Math.max(heightPct, s.revenue > 0 ? 4 : 0)}%` }}
                  data-testid={`sales-by-hour-bar-${s.hour}`}
                />
              </div>
            );
          })}
        </div>
        <div className="mt-2 flex items-end gap-1 text-[10px] text-text-muted">
          {data.salesByHour.map((s) => (
            <div key={s.hour} className="flex-1 text-center">
              {s.hour}h
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
