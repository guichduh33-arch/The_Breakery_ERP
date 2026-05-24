// apps/backoffice/src/features/reports/__tests__/ProfitLossPage.compare.smoke.test.tsx
//
// S29 Wave 5.3 — verifies compare toggle fires 2 RPC calls + renders DeltaPct.

import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock supabase before importing the page.
const rpcSpy = vi.fn();
vi.mock('@/lib/supabase.js', () => ({
  supabase: { rpc: (...args: unknown[]) => rpcSpy(...args), functions: { invoke: vi.fn() } },
}));

import ProfitLossPage from '@/pages/reports/ProfitLossPage.js';

const mockPnlData = {
  revenue: { sales: 100, discounts: 0, adjustments: 0, total: 100 },
  cogs: { production: 0, waste: 0, other: 0, total: 0 },
  gross_profit: 100,
  opex: { salary: 0, rent: 0, utilities: 0, supplies: 0, marketing: 0, maintenance: 0, other: 0, total: 0 },
  operating_profit: 100,
  net_profit: 100,
  lines: [],
  period: { start: '2026-05-01', end: '2026-05-31', section_id: null },
};

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

describe('ProfitLossPage compare', () => {
  it('fires 2 RPC calls when compare toggle is enabled', async () => {
    rpcSpy.mockResolvedValue({ data: mockPnlData, error: null });
    render(wrap(<ProfitLossPage />));
    // Initial render fires 1 call (current period)
    await waitFor(() => expect(rpcSpy).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByTestId('compare-toggle'));
    // After enabling compare, the previous-period query fires a 2nd call
    await waitFor(() => expect(rpcSpy).toHaveBeenCalledTimes(2));
  });

  it('renders DeltaPct testid when compare data ready', async () => {
    rpcSpy.mockResolvedValue({ data: mockPnlData, error: null });
    render(wrap(<ProfitLossPage />));
    fireEvent.click(screen.getByTestId('compare-toggle'));
    await waitFor(() => expect(screen.queryAllByTestId('delta-pct').length).toBeGreaterThan(0));
  });
});
