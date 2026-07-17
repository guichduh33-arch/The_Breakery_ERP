// apps/pos/src/features/shift/hooks/__tests__/useShiftCloseSummary.test.tsx
//
// POS audit 2026-06-12 lot 3 — locks the expected-cash preview formula to the
// close_shift server formula (v7 depuis ADR-009 déc. 4) :
//   expected = opening_cash + cash_sales(paid|completed, method=cash) + cash_in - cash_out
// and the threshold fallback when business_config is unreadable.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: { from: mocks.from },
}));

import {
  useShiftCloseSummary,
  DEFAULT_VARIANCE_THRESHOLD_ABS,
  DEFAULT_VARIANCE_THRESHOLD_PCT,
  DEFAULT_VARIANCE_PIN_THRESHOLD_ABS,
  DEFAULT_VARIANCE_PIN_THRESHOLD_PCT,
} from '../useShiftCloseSummary';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function mockTables(opts: {
  session: { opening_cash: number; cash_in_total: number; cash_out_total: number };
  cashPayments: { amount: number }[];
  config: {
    shift_variance_threshold_abs: number;
    shift_variance_threshold_pct: number;
    shift_variance_pin_threshold_abs?: number;
    shift_variance_pin_threshold_pct?: number;
  } | null;
}) {
  mocks.from.mockImplementation((table: string) => {
    if (table === 'pos_sessions') {
      return {
        select: () => ({
          eq: () => ({
            single: () => Promise.resolve({ data: opts.session, error: null }),
          }),
        }),
      };
    }
    if (table === 'order_payments') {
      // Chaîne réelle du hook : .eq(session_id).in(status paid|completed).eq(method).
      return {
        select: () => ({
          eq: () => ({
            in: () => ({
              eq: () => Promise.resolve({ data: opts.cashPayments, error: null }),
            }),
          }),
        }),
      };
    }
    if (table === 'business_config') {
      return {
        select: () => ({
          limit: () => ({
            maybeSingle: () => Promise.resolve({ data: opts.config, error: null }),
          }),
        }),
      };
    }
    throw new Error(`unexpected table ${table}`);
  });
}

describe('useShiftCloseSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('computes expected cash with the close_shift_v2 formula', async () => {
    mockTables({
      session: { opening_cash: 200_000, cash_in_total: 50_000, cash_out_total: 30_000 },
      cashPayments: [{ amount: 95_000 }, { amount: 25_000 }],
      config: {
        shift_variance_threshold_abs: 100_000,
        shift_variance_threshold_pct: 0.01,
        shift_variance_pin_threshold_abs: 500_000,
        shift_variance_pin_threshold_pct: 0.05,
      },
    });

    const { result } = renderHook(() => useShiftCloseSummary('session-1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // 200k + (95k + 25k) + 50k - 30k = 340k
    expect(result.current.data).toEqual({
      expectedCash: 340_000,
      thresholdAbs: 100_000,
      thresholdPct: 0.01,
      pinThresholdAbs: 500_000,
      pinThresholdPct: 0.05,
    });
  });

  it('falls back to default thresholds when business_config is unreadable', async () => {
    mockTables({
      session: { opening_cash: 100_000, cash_in_total: 0, cash_out_total: 0 },
      cashPayments: [],
      config: null,
    });

    const { result } = renderHook(() => useShiftCloseSummary('session-1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual({
      expectedCash: 100_000,
      thresholdAbs: DEFAULT_VARIANCE_THRESHOLD_ABS,
      thresholdPct: DEFAULT_VARIANCE_THRESHOLD_PCT,
      pinThresholdAbs: DEFAULT_VARIANCE_PIN_THRESHOLD_ABS,
      pinThresholdPct: DEFAULT_VARIANCE_PIN_THRESHOLD_PCT,
    });
  });

  it('does not fetch when sessionId is null (modal closed)', () => {
    mockTables({
      session: { opening_cash: 0, cash_in_total: 0, cash_out_total: 0 },
      cashPayments: [],
      config: null,
    });

    const { result } = renderHook(() => useShiftCloseSummary(null), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
