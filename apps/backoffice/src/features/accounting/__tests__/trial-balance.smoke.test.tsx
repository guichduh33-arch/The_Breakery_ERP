// apps/backoffice/src/features/accounting/__tests__/trial-balance.smoke.test.tsx
//
// Session 26b / Wave 4 — smoke for TrialBalancePage + CSV builder.
//   T1 — Renders balanced badge + lines from get_trial_balance_v1.
//   T2 — buildTrialBalanceCsv emits BOM + header + locale-formatted numbers.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TrialBalancePage from '@/features/accounting/pages/TrialBalancePage.js';
import { buildTrialBalanceCsv } from '@/features/accounting/components/exportTrialBalanceCsv.js';

const mockRpc = vi.fn();

const TB_PAYLOAD = {
  period: { start: '2026-05-01', end: '2026-05-31' },
  lines: [
    {
      account_id: 'a1', code: '1110', name: 'Cash', account_class: 1,
      balance_type: 'debit', total_debit: 1500000, total_credit: 0, balance: 1500000,
    },
    {
      account_id: 'a2', code: '4100', name: 'Sales Revenue', account_class: 4,
      balance_type: 'credit', total_debit: 0, total_credit: 1500000, balance: 1500000,
    },
  ],
  total_debit: 1500000,
  total_credit: 1500000,
  balanced: true,
  delta: 0,
};

interface RpcResult { data: unknown; error: { message: string } | null }

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    from: () => ({
      select: () => ({ is: () => ({ order: () => ({ then: (r: (v: RpcResult) => unknown) => r({ data: [], error: null }) }) }) }),
    }),
    rpc: (fn: string, args: unknown) => {
      const out = mockRpc(fn, args) as RpcResult | undefined;
      return Promise.resolve(out ?? { data: TB_PAYLOAD, error: null });
    },
  },
}));

vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (sel: (s: { hasPermission: (p: string) => boolean }) => unknown) =>
    sel({ hasPermission: () => true }),
}));

function newClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

describe('TrialBalancePage (S26b Wave 4)', () => {
  beforeEach(() => mockRpc.mockReset());

  it('T1 — renders balanced badge + 2 rows', async () => {
    mockRpc.mockReturnValueOnce({ data: TB_PAYLOAD, error: null });
    render(
      <QueryClientProvider client={newClient()}>
        <MemoryRouter>
          <TrialBalancePage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => {
      expect(screen.queryByTestId('tb-row-1110')).not.toBeNull();
      expect(screen.queryByTestId('tb-row-4100')).not.toBeNull();
    });
    const badge = screen.getByTestId('tb-balanced-badge');
    expect(badge.textContent).toMatch(/Balanced/i);
  });

  it('T2 — buildTrialBalanceCsv emits BOM + header + locale numbers', () => {
    const csv = buildTrialBalanceCsv(TB_PAYLOAD);
    // BOM
    expect(csv.charCodeAt(0)).toBe(0xFEFF);
    // header
    const lines = csv.replace(/^﻿/, '').split('\n');
    expect(lines[0]).toBe('code,name,class,debit,credit,balance');
    // First row code 1110, class Asset, debit 1.500.000 (id-ID locale)
    expect(lines[1]).toMatch(/^1110,Cash,Asset,/);
    // 1500000 formatted in id-ID uses thousand-dot separator -> "1.500.000"
    expect(lines[1]).toContain('1.500.000');
    // Total footer
    expect(lines[lines.length - 1]).toMatch(/^,TOTAL,,1\.500\.000,1\.500\.000,$/);
  });
});
