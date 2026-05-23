// apps/backoffice/src/features/accounting/__tests__/pb1-management.smoke.test.tsx
//
// Session 26c / Wave 1 — smoke for PB1ManagementPage.
//   T1 — Renders summary card with pb1_output / pb1_payable / regime.
//   T2 — RPC called with p_period_start + p_period_end (current month default).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PB1ManagementPage from '@/features/accounting/pages/PB1ManagementPage.js';

const mockRpc = vi.fn();

const PAYLOAD = {
  period_start: '2026-05-01',
  period_end:   '2026-05-31',
  pb1_output:   325000,
  pb1_payable:  325000,
  tax_rate:     0.10,
  tax_regime:   'NON_PKP_BALI_PB1',
  note:         'NON-PKP — PB1 payable to PEMDA Bali. No VAT input deduction (ADR-003).',
};

interface RpcResult { data: unknown; error: { message: string } | null }

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    from: () => ({}),
    rpc: (fn: string, args: unknown) => {
      const out = mockRpc(fn, args) as RpcResult | undefined;
      return Promise.resolve(out ?? { data: PAYLOAD, error: null });
    },
  },
}));

function newClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

describe('PB1ManagementPage (S26c Wave 1)', () => {
  beforeEach(() => mockRpc.mockReset());

  it('T1 — renders summary card with pb1_output + pb1_payable + regime', async () => {
    mockRpc.mockReturnValueOnce({ data: PAYLOAD, error: null });
    render(
      <QueryClientProvider client={newClient()}>
        <MemoryRouter>
          <PB1ManagementPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => {
      expect(screen.queryByTestId('pb1-summary-card')).not.toBeNull();
    });
    expect(screen.getByTestId('pb1-output').textContent).toContain('325.000');
    expect(screen.getByTestId('pb1-payable').textContent).toContain('325.000');
    expect(screen.getByTestId('pb1-regime').textContent).toMatch(/NON_PKP_BALI_PB1.*10\.0%/);
  });

  it('T2 — calls calculate_pb1_payable_v1 with period args', async () => {
    mockRpc.mockReturnValueOnce({ data: PAYLOAD, error: null });
    render(
      <QueryClientProvider client={newClient()}>
        <MemoryRouter>
          <PB1ManagementPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('calculate_pb1_payable_v1',
        expect.objectContaining({
          p_period_start: expect.any(String),
          p_period_end:   expect.any(String),
        }));
    });
  });
});
