import type { DashboardOverview } from '../hooks/useDashboardOverview.js';

export function financialFixture(): DashboardOverview {
  const delta = (value: number) => ({ value, vs_yesterday: 5, vs_d7: 10 });
  return {
    kpis: {
      net_revenue: delta(10000), orders: delta(10), customers: delta(8),
      items_sold: delta(12), avg_basket: delta(1000),
      gross_margin: {
        value: 61.8, vs_yesterday_pt: 1.4, vs_d7_pt: 2.7,
        basis: 'current_cost_price', cost_coverage_pct: 87.5,
      },
      cash_on_hand: { value: null, restricted: true, wallets: [] },
    },
    cost_mtd: {
      total: 8000, cogs_total: 5000, opex_total: 3000, sales_mtd: 10000,
      cogs_pct_of_sales: 50, opex_pct_of_sales: 30, cost_per_basket: 800,
      lines: [{ account_code: '5100', account_name: 'Private flour account', family: 'cogs', amount: 5000, mom_delta_pct: 23 }],
    },
    revenue_30d: [], revenue_30d_summary: { total: 0, prev_total: 0, delta_pct: null },
    hourly_sales: [], hourly_peak: null, revenue_share: [],
    payments: { lines: [], total: 10000, cash_expected_drawer: 10000 },
    generated_at: '2026-06-30T16:05:06Z',
  };
}
