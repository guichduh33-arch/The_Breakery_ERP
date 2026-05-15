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

function Overview({ period }: { period: { start: string; end: string; label: string } }): JSX.Element {
  const { data, isLoading, isError } = usePOSReportsOverview(period as Parameters<typeof usePOSReportsOverview>[0]);

  if (isLoading) {
    return <p className="text-text-secondary text-sm">Loading overview…</p>;
  }
  if (isError || !data) {
    return <p className="text-red text-sm">Failed to load overview.</p>;
  }

  const maxHour = Math.max(...data.salesByHour.map((s) => s.total), 1);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KpiTile
          label="Revenue"
          value={data.revenue}
          valueFormat="currency"
          icon={Receipt}
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
          footer={<>Tax: <Currency amount={data.tax} className="font-mono" /></>}
        />
      </div>

      <section className="rounded-lg border border-border-subtle bg-bg-elevated p-5">
        <SectionLabel size="xs" as="h2">Sales by hour</SectionLabel>
        <div className="mt-4 h-48 flex items-end gap-1 border-b border-border-subtle pb-1">
          {data.salesByHour.map((s) => {
            const heightPct = (s.total / maxHour) * 100;
            return (
              <div
                key={s.hour}
                className="flex-1 flex flex-col items-center justify-end gap-1 min-w-0"
                aria-label={`${s.hour}h: ${s.total}`}
              >
                <div
                  className={cn(
                    'w-full rounded-t-md transition-all',
                    s.total > 0 ? 'bg-gold' : 'bg-bg-overlay/60',
                  )}
                  style={{ height: `${Math.max(heightPct, s.total > 0 ? 4 : 0)}%` }}
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
