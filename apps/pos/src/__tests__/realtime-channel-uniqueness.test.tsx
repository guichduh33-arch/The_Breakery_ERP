// apps/pos/src/__tests__/realtime-channel-uniqueness.test.tsx
//
// Session 13 (Phase 1.D / ui-steward batch 1) — C2 verification.
//
// Asserts that each realtime-listening hook produces a UNIQUE Supabase channel
// name across two consecutive mounts (the StrictMode double-mount scenario).
// A static channel name would collide because removeChannel() is async, so
// the second mount would attach `.on()` to the still-subscribed channel from
// the first mount and silently drop later events.
//
// Pattern of truth: apps/pos/src/features/kds/hooks/useKdsRealtime.ts:20-23.

/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// ---------------------------------------------------------------------------
// Supabase mock — captures every channel name passed to .channel().
// ---------------------------------------------------------------------------
const channelNames: string[] = [];

const channelMock = {
  on: vi.fn().mockReturnThis(),
  subscribe: vi.fn().mockReturnThis(),
};

vi.mock('@/lib/supabase', () => ({
  supabase: {
    channel: vi.fn((name: string) => {
      channelNames.push(name);
      return channelMock;
    }),
    removeChannel: vi.fn().mockResolvedValue(undefined),
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        not: vi.fn(() => ({
          not: vi.fn().mockResolvedValue({ data: [], error: null }),
        })),
      })),
    })),
  },
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: <T,>(selector: (s: { user: { id: string } | null }) => T): T =>
    selector({ user: { id: 'user-1' } }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// Import AFTER mocks register.
const { useTabletOrderStatusListener } = await import(
  '@/features/tablet/hooks/useTabletOrderStatusListener'
);
const { useTableOccupancy } = await import(
  '@/features/tables/hooks/useTableOccupancy'
);
const { usePromotionsRealtime } = await import(
  '@/features/promotions/hooks/usePromotionsRealtime'
);

// Mock the PROMOTIONS_QUERY_KEY import used by usePromotionsRealtime — it is
// re-exported from usePromotions; resolved transitively by Vitest.

function wrap({ children }: { children: ReactNode }): JSX.Element {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('realtime channel uniqueness (C2)', () => {
  beforeEach(() => {
    channelNames.length = 0;
  });

  it('useTabletOrderStatusListener produces a fresh channel name on each mount', () => {
    const { unmount: u1 } = renderHook(() => useTabletOrderStatusListener(), { wrapper: wrap });
    u1();
    renderHook(() => useTabletOrderStatusListener(), { wrapper: wrap });

    const taps = channelNames.filter((n) => n.startsWith('tablet-order-status-'));
    expect(taps).toHaveLength(2);
    expect(taps[0]).not.toBe(taps[1]);
  });

  it('useTableOccupancy produces a fresh channel name on each mount', () => {
    const { unmount: u1 } = renderHook(() => useTableOccupancy(), { wrapper: wrap });
    u1();
    renderHook(() => useTableOccupancy(), { wrapper: wrap });

    const taps = channelNames.filter((n) => n.startsWith('table_occupancy_realtime-'));
    expect(taps).toHaveLength(2);
    expect(taps[0]).not.toBe(taps[1]);
  });

  it('usePromotionsRealtime produces a fresh channel name on each mount', () => {
    const { unmount: u1 } = renderHook(() => usePromotionsRealtime(), { wrapper: wrap });
    u1();
    renderHook(() => usePromotionsRealtime(), { wrapper: wrap });

    const taps = channelNames.filter((n) => n.startsWith('promotions-changes-'));
    expect(taps).toHaveLength(2);
    expect(taps[0]).not.toBe(taps[1]);
  });
});
