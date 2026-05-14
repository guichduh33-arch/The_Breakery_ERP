// apps/backoffice/src/pages/Dashboard.tsx
//
// Session 14 / Phase 4.A — Backoffice Dashboard.
//
// Layout (matches docs/Design/backoffice/Dashboard.jpg):
//   - Header: "Dashboard" serif title + greeting line
//   - 5 KPI tiles: TODAY'S REVENUE, ORDERS, ITEMS SOLD, AVG BASKET, CUSTOMERS
//   - 30-DAY REVENUE TREND (chart placeholder w/ empty state)
//   - REVENUE BY ORDER TYPE (placeholder w/ empty state)
//   - TOP PRODUCTS TODAY + HOURLY SALES + PAYMENT METHODS row
//
// Data wiring is deferred to Session 15 — this page reads optional
// `useDashboardOverview` hook output if present, otherwise falls back to
// safe zero/empty defaults. Tests mock the hook directly.
//
// TODO(session-15): wire dashboard RPC (e.g. get_dashboard_overview_v1)
// returning { revenue_today, orders_today, items_sold, avg_basket,
// customers_today, last_updated, revenue_30d, revenue_by_type, top_products,
// hourly_sales, payment_methods }.

import { useMemo, useState } from 'react';
import {
  DollarSign, ShoppingBag, Box, TrendingUp, Users as UsersIcon,
  RefreshCw,
} from 'lucide-react';
import {
  Card, KpiTile, SectionLabel, EmptyState, cn,
} from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore.js';

interface DashboardOverview {
  revenue_today: number;
  orders_today: number;
  items_sold: number;
  avg_basket: number;
  customers_today: number;
  last_updated: string;
}

interface DashboardData {
  data: DashboardOverview | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Default zero-state overview shown until the dashboard RPC is wired
 * (Session 15). Keeps the page renderable in production without
 * throwing when no data hook exists yet.
 */
function emptyOverview(): DashboardOverview {
  return {
    revenue_today: 0,
    orders_today: 0,
    items_sold: 0,
    avg_basket: 0,
    customers_today: 0,
    last_updated: new Date().toISOString(),
  };
}

export interface DashboardPageProps {
  /**
   * Test-only override — production callers pass nothing and the page
   * renders the safe empty state. When wired in Session 15, the page
   * will read directly from a co-located hook.
   */
  data?: DashboardData;
}

function formatGreeting(name: string | undefined): string {
  const hour = new Date().getHours();
  const part = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  const who = name ?? 'there';
  const date = new Date().toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
  return `Good ${part}, ${who}. ${date}.`;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '--:--';
  }
}

export default function DashboardPage({ data }: DashboardPageProps) {
  const user = useAuthStore((s) => s.user);
  const [internalRefresh, setInternalRefresh] = useState(0);

  const overview = data?.data ?? emptyOverview();
  const isLoading = data?.isLoading ?? false;
  const error = data?.error ?? null;
  const refetch = data?.refetch ?? (() => setInternalRefresh((n) => n + 1));

  const greeting = useMemo(
    () => formatGreeting(user?.full_name),
    // refresh greeting every render in case time of day changed
    [user?.full_name, internalRefresh],
  );

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
          <span>Last updated {formatTime(overview.last_updated)}</span>
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
              value={overview.revenue_today}
              valueFormat="currency"
            />
            <KpiTile
              icon={ShoppingBag}
              label="Orders"
              value={overview.orders_today}
              valueFormat="number"
            />
            <KpiTile
              icon={Box}
              label="Items sold"
              value={overview.items_sold}
              valueFormat="number"
            />
            <KpiTile
              icon={TrendingUp}
              label="Avg basket"
              value={overview.avg_basket}
              valueFormat="currency"
            />
            <KpiTile
              icon={UsersIcon}
              label="Customers"
              value={overview.customers_today}
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
          <div className="h-48 flex items-center justify-center">
            <EmptyState
              size="sm"
              title="No revenue data"
              description="Trend chart appears once orders are recorded."
            />
          </div>
        </Card>
        <Card variant="default" padding="md" className="min-h-[280px]">
          <SectionLabel as="h2" size="xs" className="mb-2">
            Revenue by order type
          </SectionLabel>
          <div className="h-56 flex items-center justify-center">
            <EmptyState
              size="sm"
              title="No data available"
            />
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card variant="default" padding="md" className="min-h-[220px]">
          <SectionLabel as="h2" size="xs" className="mb-3">
            Top products today
          </SectionLabel>
          <div className="h-40 flex items-center justify-center">
            <EmptyState
              size="sm"
              title="No sales today yet"
            />
          </div>
        </Card>
        <Card variant="default" padding="md" className="min-h-[220px]">
          <SectionLabel as="h2" size="xs" className="mb-3">
            Hourly sales
          </SectionLabel>
          <div className="h-40 flex items-center justify-center">
            <EmptyState
              size="sm"
              title="No sales data yet"
            />
          </div>
        </Card>
        <Card variant="default" padding="md" className="min-h-[220px]">
          <SectionLabel as="h2" size="xs" className="mb-3">
            Payment methods
          </SectionLabel>
          <div className="h-40 flex items-center justify-center">
            <EmptyState
              size="sm"
              title="No payments yet"
            />
          </div>
        </Card>
      </div>
    </div>
  );
}
