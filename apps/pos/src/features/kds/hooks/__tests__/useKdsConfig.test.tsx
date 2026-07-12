// apps/pos/src/features/kds/hooks/__tests__/useKdsConfig.test.ts
//
// S75 lot 2 (task 6) — `useKdsConfig` reads the KDS ageing/archive thresholds
// from `business_config` (kds_warning_threshold_minutes,
// kds_urgent_threshold_minutes, kds_auto_archive_minutes — task 5) and maps
// minutes → ms. Mirrors the useEnabledPaymentMethods.test.tsx harness
// (vi.mock('@/lib/supabase') + QueryClientProvider). Never returns
// undefined — a config read must never block KDS rendering, so any failure
// (network error, NULL columns from a legacy row) falls back to
// KDS_CONFIG_DEFAULTS synchronously.

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

import { useKdsConfig, KDS_CONFIG_DEFAULTS } from '../useKdsConfig';

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

describe('useKdsConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns KDS_CONFIG_DEFAULTS synchronously before the query settles', () => {
    mockBusinessConfig({
      data: {
        kds_warning_threshold_minutes: 3,
        kds_urgent_threshold_minutes: 8,
        kds_auto_archive_minutes: 2,
      },
      error: null,
    });

    const { result } = renderHook(() => useKdsConfig(), { wrapper });
    expect(result.current).toEqual(KDS_CONFIG_DEFAULTS);
  });

  it('maps DB minutes (3/8/2) to ms once the query resolves', async () => {
    mockBusinessConfig({
      data: {
        kds_warning_threshold_minutes: 3,
        kds_urgent_threshold_minutes: 8,
        kds_auto_archive_minutes: 2,
      },
      error: null,
    });

    const { result } = renderHook(() => useKdsConfig(), { wrapper });
    await waitFor(() =>
      expect(result.current).toEqual({ warningMs: 180_000, urgentMs: 480_000, archiveMs: 120_000 }),
    );
  });

  it('falls back to KDS_CONFIG_DEFAULTS on a network/permission error', async () => {
    mockBusinessConfig({ data: null, error: { message: 'permission denied' } });

    const { result } = renderHook(() => useKdsConfig(), { wrapper });
    // Immediately (before the query settles) it's already the fail-open default.
    expect(result.current).toEqual(KDS_CONFIG_DEFAULTS);
    await waitFor(() => expect(result.current).toEqual(KDS_CONFIG_DEFAULTS));
  });

  it('treats SQL NULL columns as missing and falls back per-field to defaults (legacy row)', async () => {
    // Mixed row: one real value (urgent=8min → 480_000ms, a NON-default sentinel)
    // and two literal SQL NULLs. The sentinel lets us wait for the query to
    // genuinely SETTLE (480_000 ≠ the 600_000 pre-settle default) instead of
    // vacuously matching the default value before the fetch resolves — so this
    // test truly exercises the resolved NULL path and FAILS against a `toMs`
    // that does `Number(null) === 0 >= 0 → 0ms`.
    mockBusinessConfig({
      data: {
        kds_warning_threshold_minutes: null,
        kds_urgent_threshold_minutes: 8,
        kds_auto_archive_minutes: null,
      },
      error: null,
    });

    const { result } = renderHook(() => useKdsConfig(), { wrapper });
    // Only true AFTER the query settles (480_000 is not the pre-settle default).
    await waitFor(() => expect(result.current.urgentMs).toBe(480_000));
    // NULL columns must fall back to defaults, NOT to 0ms.
    expect(result.current.warningMs).toBe(KDS_CONFIG_DEFAULTS.warningMs);
    expect(result.current.archiveMs).toBe(KDS_CONFIG_DEFAULTS.archiveMs);
  });

  it('falls back to KDS_CONFIG_DEFAULTS when there is no row at all', async () => {
    mockBusinessConfig({ data: null, error: null });

    const { result } = renderHook(() => useKdsConfig(), { wrapper });
    await waitFor(() => expect(result.current).toEqual(KDS_CONFIG_DEFAULTS));
  });
});
