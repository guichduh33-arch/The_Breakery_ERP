// apps/backoffice/src/pages/customers/__tests__/customer-analytics-tab.test.tsx
//
// Rendu de l'onglet Analytics : une erreur se dit comme une erreur (avant :
// « Not enough purchase history »), le résumé montre les chiffres calculés,
// les produits sont un vrai tableau.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen, within } from '@testing-library/react';
import { buildCustomerAnalytics, type CustomerAnalytics } from '@/features/customers/customerAnalytics.js';

vi.mock('recharts', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('recharts');
  return { ...actual, ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div> };
});

interface HookResult {
  data: CustomerAnalytics | undefined; isLoading: boolean; error: Error | null; refetch: () => void;
}
const state = vi.hoisted((): { result: HookResult } => ({
  result: { data: undefined, isLoading: false, error: null, refetch: () => undefined },
}));
vi.mock('@/features/customers/hooks/useCustomerAnalytics.js', () => ({
  useCustomerAnalytics: () => state.result,
}));

import { AnalyticsTab } from '../customer-detail/AnalyticsTab.js';

const NOW = new Date('2026-11-21T04:00:00Z');

describe('AnalyticsTab', () => {
  beforeEach(() => {
    state.result = { data: undefined, isLoading: false, error: null, refetch: () => undefined };
  });

  it('says the analytics could not be loaded instead of claiming no history', () => {
    state.result = { ...state.result, error: new Error('permission denied') };
    render(<AnalyticsTab customerId="c1" />);
    expect(screen.getByRole('alert')).toHaveTextContent(/purchase analytics could not be loaded/i);
    expect(screen.queryByText(/no recognised sale/i)).not.toBeInTheDocument();
  });

  it('shows the summary, the trend table and the favourite products', () => {
    state.result = {
      ...state.result,
      data: buildCustomerAnalytics([
        { id: 'a', recognized_at: '2026-11-10T01:00:00Z', total: 60_000, order_type: 'dine_in' },
        { id: 'b', recognized_at: '2026-11-18T01:00:00Z', total: 40_000, order_type: 'take_out' },
      ], [
        { product_id: 'p1', name_snapshot: 'Croissant Nutella', quantity: 3, line_total: 105_000 },
      ], NOW),
    };
    render(<AnalyticsTab customerId="c1" />);
    const summary = screen.getByTestId('customer-analytics-summary');
    expect(within(summary).getByTestId('counter-spend')).toHaveTextContent('Rp 100.000');
    expect(within(summary).getByTestId('counter-basket')).toHaveTextContent('Rp 50.000');
    expect(within(summary).getByTestId('counter-rhythm')).toHaveTextContent('Every 8 days');
    expect(within(summary).getByTestId('counter-last')).toHaveTextContent('3 days ago');
    expect(screen.getByText('Spend and order count per week')).toBeInTheDocument();
    expect(screen.getByText('Weekly since 10 Nov')).toBeInTheDocument();
    expect(within(summary).getByTestId('counter-since')).toHaveTextContent('First sale');
    const products = screen.getByRole('table', { name: /products this customer buys most/i });
    expect(within(products).getByText('Croissant Nutella')).toBeInTheDocument();
    expect(within(products).getByText('100,0%')).toBeInTheDocument();
  });

  it('keeps an honest empty state for a customer without sales', () => {
    state.result = { ...state.result, data: buildCustomerAnalytics([], [], NOW) };
    render(<AnalyticsTab customerId="c1" />);
    expect(screen.getByText(/no recognised sale for this customer yet/i)).toBeInTheDocument();
  });
});
