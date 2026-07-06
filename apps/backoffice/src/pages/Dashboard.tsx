// apps/backoffice/src/pages/Dashboard.tsx
//
// S63 — Backoffice Dashboard, câblé sur get_dashboard_overview_v1.
//
// Layout (matches docs/Design/backoffice/Dashboard.jpg):
//   - Header: "Dashboard" serif title + greeting line
//   - 5 KPI tiles: TODAY'S REVENUE (net of refunds), ORDERS, ITEMS SOLD,
//     AVG BASKET, CUSTOMERS
//   - 30-DAY REVENUE TREND + REVENUE BY ORDER TYPE
//   - TOP PRODUCTS TODAY + HOURLY SALES + PAYMENT METHODS
//
// Data: useDashboardOverview (React Query, 60 s polling). The optional
// `data` prop overrides the hook for tests (hook disabled, no network).
// A 42501 from the RPC renders the restricted state instead of an error.

import { useMemo } from 'react';
import {
  DollarSign, ShoppingBag, Box, TrendingUp, Users as UsersIcon,
  RefreshCw, Lock,
} from 'lucide-react';
import {
  Card, KpiTile, SectionLabel, cn,
} from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore.js';
import {
  useDashboardOverview,
  classifyDashboardError,
  type DashboardOverview,
} from '@/features/dashboard/hooks/useDashboardOverview.js';
import { RevenueTrendChart } from '@/features/dashboard/components/RevenueTrendChart.js';
import { RevenueByTypeDonut } from '@/features/dashboard/components/RevenueByTypeDonut.js';
import { HourlySalesChart } from '@/features/dashboard/components/HourlySalesChart.js';
import { TopProductsList } from '@/features/dashboard/components/TopProductsList.js';
import { PaymentMethodsList } from '@/features/dashboard/components/PaymentMethodsList.js';

export interface DashboardData {
  data: DashboardOverview | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

export interface DashboardPageProps {
  /** Test-only override — when provided, the live hook is disabled. */
  data?: DashboardData;
}

const ZERO_KPIS = {
  revenue_today: 0,
  orders_today: 0,
  items_sold: 0,
  avg_basket: 0,
  customers_today: 0,
} as const;

function formatGreeting(name: string | undefined): string {
  const hour = new Date().getHours();
  const part = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  const who = name ?? 'there';
  const date = new Date().toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
  return `Good ${part}, ${who}. ${date}.`;
}

function formatTime(iso: string | undefined): string {
  if (!iso) return '--:--';
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '--:--';
  }
}

export default function DashboardPage({ data }: DashboardPageProps) {
  const user = useAuthStore((s) => s.user);
  const live = useDashboardOverview(data === undefined);

  const overview  = data !== undefined ? data.data : live.data ?? null;
  const isLoading = data !== undefined ? data.isLoading : live.isLoading;
  const error     = data !== undefined ? data.error : live.error ?? null;
  const refetch   = data !== undefined ? data.refetch : () => { void live.refetch(); };

  const restricted =
    error !== null && classifyDashboardError(error) === 'permission_denied';
  const kpis = overview?.kpis ?? ZERO_KPIS;

  const greeting = useMemo(() => formatGreeting(user?.full_name), [user?.full_name]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-serif text-3xl text-text-primary">Dashboard</h1>
          <p className="text-text-secondary text-sm mt-1">{greeting}</p>
        </div>
        <div
          className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-bg-overlay text-xs text-text-secondary"
          aria-live="polite"
        >
          <span className="h-2 w-2 rounded-full bg-success" aria-hidden />
          <span>Last updated {formatTime(overview?.generated_at)}</span>
          <button
            type="button"
            onClick={refetch}
            className="ml-1 text-text-secondary hover:text-text-primary"
            aria-label="Refresh dashboard"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')} aria-hidden />
          </button>
        </div>
      </div>

      {restricted ? (
        <Card variant="default" padding="md" data-testid="dashboard-restricted">
          <div className="flex items-center gap-3">
            <Lock className="h-5 w-5 text-text-muted" aria-hidden />
            <div>
              <p className="text-sm text-text-primary">Dashboard metrics are restricted.</p>
              <p className="text-xs text-text-muted mt-0.5">
                Viewing business metrics requires the reports permission. Contact an administrator.
              </p>
            </div>
          </div>
        </Card>
      ) : (
        <>
          {error !== null && (
            <Card variant="default" padding="md" role="alert">
              <p className="text-sm text-danger">
                Failed to load dashboard: {error.message}
              </p>
            </Card>
          )}

          <div
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4"
            data-testid="dashboard-kpi-row"
          >
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <Card
                  key={i}
                  variant="default"
                  padding="md"
                  data-testid="kpi-skeleton"
                  className="h-32 animate-pulse"
                >
                  <div className="h-9 w-9 rounded-md bg-bg-overlay mb-3" />
                  <div className="h-3 w-20 bg-bg-overlay rounded mb-2" />
                  <div className="h-7 w-24 bg-bg-overlay rounded" />
                </Card>
              ))
            ) : (
              <>
                <KpiTile
                  icon={DollarSign}
                  label="Today's revenue"
                  value={kpis.revenue_today}
                  valueFormat="currency"
                />
                <KpiTile
                  icon={ShoppingBag}
                  label="Orders"
                  value={kpis.orders_today}
                  valueFormat="number"
                />
                <KpiTile
                  icon={Box}
                  label="Items sold"
                  value={kpis.items_sold}
                  valueFormat="number"
                />
                <KpiTile
                  icon={TrendingUp}
                  label="Avg basket"
                  value={kpis.avg_basket}
                  valueFormat="currency"
                />
                <KpiTile
                  icon={UsersIcon}
                  label="Customers"
                  value={kpis.customers_today}
                  valueFormat="number"
                />
              </>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card variant="default" padding="md" className="min-h-[280px]">
              <SectionLabel as="h2" size="xs" className="mb-2">
                30-day revenue trend
              </SectionLabel>
              <p className="text-xs text-text-muted mb-4">Daily revenue over the last 30 days</p>
              <RevenueTrendChart data={overview?.revenue_30d ?? []} />
            </Card>
            <Card variant="default" padding="md" className="min-h-[280px]">
              <SectionLabel as="h2" size="xs" className="mb-2">
                Revenue by order type
              </SectionLabel>
              <RevenueByTypeDonut data={overview?.revenue_by_type ?? []} />
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card variant="default" padding="md" className="min-h-[220px]">
              <SectionLabel as="h2" size="xs" className="mb-3">
                Top products today
              </SectionLabel>
              <TopProductsList data={overview?.top_products ?? []} />
            </Card>
            <Card variant="default" padding="md" className="min-h-[220px]">
              <SectionLabel as="h2" size="xs" className="mb-3">
                Hourly sales
              </SectionLabel>
              <HourlySalesChart data={overview?.hourly_sales ?? []} />
            </Card>
            <Card variant="default" padding="md" className="min-h-[220px]">
              <SectionLabel as="h2" size="xs" className="mb-3">
                Payment methods
              </SectionLabel>
              <PaymentMethodsList data={overview?.payment_methods ?? []} />
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
