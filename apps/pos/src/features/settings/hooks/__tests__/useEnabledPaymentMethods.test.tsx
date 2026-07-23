// apps/pos/src/features/settings/hooks/__tests__/useEnabledPaymentMethods.test.tsx
//
// S64 (fiche 19 D2.1) — locks the fail-open contract: a config read must never
// block an encaissement. Mirrors the useShiftCloseSummary.test.tsx harness
// (vi.mock('@/lib/supabase') + QueryClientProvider wrapper).
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

import { useEnabledPaymentMethods, FAIL_OPEN_PAYMENT_METHODS } from '../useEnabledPaymentMethods';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function mockBusinessConfig(result: { data: unknown; error: { message: string } | null }) {
  mocks.from.mockImplementation((table: string) => {
    if (table === 'business_config') {
      return {
        select: () => ({
          limit: () => ({
            maybeSingle: () => Promise.resolve(result),
          }),
        }),
      };
    }
    throw new Error(`unexpected table ${table}`);
  });
}

describe('useEnabledPaymentMethods', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the DB-configured subset as a Set', async () => {
    mockBusinessConfig({ data: { enabled_payment_methods: ['cash', 'qris'] }, error: null });

    const { result } = renderHook(() => useEnabledPaymentMethods(), { wrapper });
    await waitFor(() => expect(result.current.size).toBe(2));

    expect(result.current.has('cash')).toBe(true);
    expect(result.current.has('qris')).toBe(true);
    expect(result.current.has('card')).toBe(false);
  });

  // Lot B — e-wallets are VALID configured values (they must survive the
  // validity filter) even though they are excluded from the fail-open default.
  it('accepts configured e-wallets (gopay/ovo/dana)', async () => {
    mockBusinessConfig({ data: { enabled_payment_methods: ['cash', 'gopay', 'ovo', 'dana'] }, error: null });

    const { result } = renderHook(() => useEnabledPaymentMethods(), { wrapper });
    await waitFor(() => expect(result.current.size).toBe(4));

    expect(result.current.has('gopay')).toBe(true);
    expect(result.current.has('ovo')).toBe(true);
    expect(result.current.has('dana')).toBe(true);
  });

  // ADR-006 déc. 9 lot A — the config array order is contractual (POS display
  // order) and must survive as the Set's insertion order.
  it('preserves the configured order in the returned Set', async () => {
    mockBusinessConfig({ data: { enabled_payment_methods: ['qris', 'store_credit', 'cash'] }, error: null });

    const { result } = renderHook(() => useEnabledPaymentMethods(), { wrapper });
    await waitFor(() => expect(result.current.size).toBe(3));

    expect([...result.current]).toEqual(['qris', 'store_credit', 'cash']);
  });

  it('fails open to the 6 methods on a supabase error', async () => {
    mockBusinessConfig({ data: null, error: { message: 'permission denied' } });

    const { result } = renderHook(() => useEnabledPaymentMethods(), { wrapper });
    // Immediately (before the query settles) it's already the fail-open default.
    expect(result.current.size).toBe(FAIL_OPEN_PAYMENT_METHODS.length);
    await waitFor(() => expect(result.current.size).toBe(FAIL_OPEN_PAYMENT_METHODS.length));
    for (const m of FAIL_OPEN_PAYMENT_METHODS) expect(result.current.has(m)).toBe(true);
  });

  it('fails open to the 6 methods when the column is not an array', async () => {
    mockBusinessConfig({ data: { enabled_payment_methods: 'not-an-array' }, error: null });

    const { result } = renderHook(() => useEnabledPaymentMethods(), { wrapper });
    await waitFor(() => expect(result.current.size).toBe(FAIL_OPEN_PAYMENT_METHODS.length));
  });

  it('fails open to the 6 methods when the array is empty', async () => {
    mockBusinessConfig({ data: { enabled_payment_methods: [] }, error: null });

    const { result } = renderHook(() => useEnabledPaymentMethods(), { wrapper });
    await waitFor(() => expect(result.current.size).toBe(FAIL_OPEN_PAYMENT_METHODS.length));
  });
});
