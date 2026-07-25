// apps/pos/src/features/settings/hooks/__tests__/usePOSPresets.test.tsx
//
// Fix 403 cashier — the presets READ must go through business_config directly
// (RLS auth_read), never through get_settings_by_category_v7 whose
// settings.read gate rejects CASHIER/waiter (42501 → 403) and silently forced
// the hardcoded fallbacks for the exact audience the presets are made for.
// Mirrors the useEnabledPaymentMethods.test.tsx harness.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: { from: mocks.from, rpc: mocks.rpc },
}));

import { usePOSPresets, FALLBACK_PRESETS } from '../usePOSPresets';

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

describe('usePOSPresets — read path via business_config (403-cashier fix)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps the three business_config columns to presets', async () => {
    mockBusinessConfig({
      data: {
        pos_quick_payment_amounts: [20_000, 75_000],
        pos_opening_cash_presets: [150_000],
        pos_discount_presets: [{ value: 30, name: 'VIP' }],
      },
      error: null,
    });

    const { result } = renderHook(() => usePOSPresets(), { wrapper });
    await waitFor(() => expect(result.current.presets.quickPayments).toEqual([20_000, 75_000]));

    expect(result.current.presets.openingCashPresets).toEqual([150_000]);
    expect(result.current.presets.discountPresets).toEqual([{ value: 30, name: 'VIP' }]);
  });

  it('never reads through the settings.read-gated RPC', async () => {
    mockBusinessConfig({ data: { pos_quick_payment_amounts: [10_000] }, error: null });

    const { result } = renderHook(() => usePOSPresets(), { wrapper });
    await waitFor(() => expect(result.current.presets.quickPayments).toEqual([10_000]));

    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('falls back to FALLBACK_PRESETS on read error (fail-open contract)', async () => {
    mockBusinessConfig({ data: null, error: { message: 'permission denied' } });

    const { result } = renderHook(() => usePOSPresets(), { wrapper });
    await waitFor(() => expect(result.current.presets).toEqual(FALLBACK_PRESETS));
  });

  it('falls back per-key when a column is malformed', async () => {
    mockBusinessConfig({
      data: {
        pos_quick_payment_amounts: 'not-an-array',
        pos_opening_cash_presets: [250_000],
        pos_discount_presets: null,
      },
      error: null,
    });

    const { result } = renderHook(() => usePOSPresets(), { wrapper });
    await waitFor(() => expect(result.current.presets.openingCashPresets).toEqual([250_000]));

    expect(result.current.presets.quickPayments).toEqual(FALLBACK_PRESETS.quickPayments);
    expect(result.current.presets.discountPresets).toEqual(FALLBACK_PRESETS.discountPresets);
  });
});
