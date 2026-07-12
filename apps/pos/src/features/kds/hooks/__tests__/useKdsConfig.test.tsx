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

  it('falls back to KDS_CONFIG_DEFAULTS when the row has NULL columns (legacy row)', async () => {
    mockBusinessConfig({
      data: {
        kds_warning_threshold_minutes: null,
        kds_urgent_threshold_minutes: null,
        kds_auto_archive_minutes: null,
      },
      error: null,
    });

    const { result } = renderHook(() => useKdsConfig(), { wrapper });
    await waitFor(() => expect(result.current).toEqual(KDS_CONFIG_DEFAULTS));
  });

  it('falls back to KDS_CONFIG_DEFAULTS when there is no row at all', async () => {
    mockBusinessConfig({ data: null, error: null });

    const { result } = renderHook(() => useKdsConfig(), { wrapper });
    await waitFor(() => expect(result.current).toEqual(KDS_CONFIG_DEFAULTS));
  });
});
