// apps/backoffice/src/features/products/__tests__/stock-analytics-panel.smoke.test.tsx
//
// StockAnalyticsPanel smoke tests — the product detail "Stock / Analytics" tab.
//
// Asserts:
//   T1: KPI row renders current stock / stock value / days remaining / status.
//   T2: Recipe Usage table renders rows with % demand.
//   T3: Operational cards with no rows render their empty state.
//
// useProductAnalytics is mocked with a stable hoisted fixture (see CostingPanel
// smoke for the why — unstable refs cause infinite render loops).

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';

// recharts' ResponsiveContainer relies on ResizeObserver, absent in jsdom.
beforeAll(() => {
  class RO { observe() {} unobserve() {} disconnect() {} }
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = RO;
});
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { StockAnalyticsPanel } from '../components/StockAnalyticsPanel.js';
import type { ProductRow } from '../types.js';

const { mockState, ANALYTICS } = vi.hoisted(() => {
  const ANALYTICS = {
    product: {
      id: 'prod-1', sku: 'DRY-005', name: 'Ice Sugar', unit: 'kg',
      product_type: 'finished', is_semi_finished: false,
      cost_price: 21_462, retail_price: 0, current_stock: 1,
      min_stock_threshold: 0, value_at_cost: 21_462,
    },
    window_days: 30,
    kpis: {
      current_stock: 1, unit: 'kg', stock_value: 21_462, unit_cost: 21_462,
      consumption_window: 0, avg_daily_consumption: 0, days_remaining: null,
      min_stock_threshold: 0, stock_status: 'ok' as const,
    },
    stock_timeline: [{ day: '2026-06-01', balance: 1 }, { day: '2026-06-02', balance: 1 }],
    movement_breakdown: [{ movement_type: 'purchase', count: 1, qty_total: 1, value_total: 21_462 }],
    weekly_consumption: [{ week_start: '2026-06-01', units: 0 }],
    consumption_trend: 'stable' as const,
    purchase_price_trend: [],
    purchase_pattern: [{ month: '2026-06-01', qty: 1, order_count: 1 }],
    recipe_usage: [
      {
        product_id: 'cp-1', product_name: 'Meringue', product_type: 'finished',
        is_semi_finished: false, qty_per_batch: 500, unit: 'gr', demand_pct: 16.9, est_used: 0,
      },
    ],
    incoming_pos: [
      {
        po_id: 'po-1', po_number: 'PO-20260617-0117', status: 'received',
        quantity: 1, received_quantity: 1, unit: 'kg', unit_cost: 21_462,
        order_date: '2026-06-17', expected_date: null, received_date: '2026-06-17',
      },
    ],
    production: [],
    transfers: [],
    wastage: [],
    opname: [],
    recent_movements: [],
  };
  const mockState = { data: ANALYTICS as unknown, isLoading: false, error: null as Error | null };
  return { mockState, ANALYTICS };
});

vi.mock('@/features/products/hooks/useProductAnalytics.js', async (orig) => {
  const actual = await orig() as Record<string, unknown>;
  return {
    ...actual,
    useProductAnalytics: () => mockState,
  };
});

const PRODUCT = { id: 'prod-1', name: 'Ice Sugar' } as unknown as ProductRow;

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <StockAnalyticsPanel product={PRODUCT} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('StockAnalyticsPanel', () => {
  beforeEach(() => {
    mockState.data = ANALYTICS as unknown;
    mockState.isLoading = false;
    mockState.error = null;
  });

  it('T1: KPI row renders stock / value / status', () => {
    renderPanel();
    expect(screen.getByTestId('stock-analytics-body')).toBeInTheDocument();
    expect(screen.getByText('Current stock')).toBeInTheDocument();
    expect(screen.getByText('Stock value')).toBeInTheDocument();
    expect(screen.getByText('In Stock')).toBeInTheDocument();
    expect(screen.getByText('Days remaining')).toBeInTheDocument();
  });

  it('T2: Recipe Usage table renders a row with % demand', () => {
    renderPanel();
    expect(screen.getByText('Recipe Usage')).toBeInTheDocument();
    expect(screen.getByText('Meringue')).toBeInTheDocument();
    expect(screen.getByText('16.9%')).toBeInTheDocument();
    // Incoming PO with real number rendered
    expect(screen.getByText('PO-20260617-0117')).toBeInTheDocument();
  });

  it('T3: empty operational sections render their empty state', () => {
    renderPanel();
    expect(screen.getByText('No production records')).toBeInTheDocument();
    expect(screen.getByText('No transfers for this product')).toBeInTheDocument();
    expect(screen.getByText('No waste records')).toBeInTheDocument();
    expect(screen.getByText('No stock counts for this product')).toBeInTheDocument();
  });
});
