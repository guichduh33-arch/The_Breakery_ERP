// apps/pos/src/features/products/__tests__/ServiceSpeedIndicator.test.tsx
//
// Session 13 / Phase 4.A — verify:
//  - badge is hidden for cashiers (no `reports.read`)
//  - badge renders 'idle' tone when orderCount=0
//  - badge renders 'good' tone for fast avg
//  - badge renders 'slow' tone for very slow avg
//  - hook hits get_sales_by_hour_v1 RPC and the orders table

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ServiceSpeedIndicator, __test__ } from '../components/ServiceSpeedIndicator';

const { rpcMock, fromMock, authState } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  fromMock: vi.fn(),
  authState: {
    current: { permissions: ['reports.read'] as string[] },
  },
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: (table: string) => fromMock(table),
  },
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: <T,>(selector: (s: {
    hasPermission: (code: string) => boolean;
    permissions: string[];
  }) => T) => selector({
    permissions: authState.current.permissions,
    hasPermission: (code: string) => authState.current.permissions.includes(code),
  }),
}));

function withQuery(node: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{node}</QueryClientProvider>;
}

// Helper : build the chainable PostgREST mock for the second query.
function buildOrdersBuilder(rows: { created_at: string; paid_at: string | null }[]) {
  const builder: {
    eq: (col: string, val: unknown) => typeof builder;
    gte: (col: string, val: unknown) => typeof builder;
    not: (col: string, op: string, val: unknown) => typeof builder;
    then: <R>(fn: (qr: { data: typeof rows; error: null }) => R) => Promise<R>;
  } = {
    eq: () => builder,
    gte: () => builder,
    not: () => builder,
    then: (fn) => Promise.resolve(fn({ data: rows, error: null })),
  };
  return { select: () => builder };
}

describe('ServiceSpeedIndicator', () => {
  beforeEach(() => {
    rpcMock.mockReset();
    fromMock.mockReset();
    authState.current = { permissions: ['reports.read'] };
  });

  it('renders nothing when the user lacks reports.read', () => {
    authState.current = { permissions: [] };
    const { container } = render(withQuery(<ServiceSpeedIndicator />));
    expect(container.firstChild).toBeNull();
  });

  it('renders idle tone when no orders this hour', async () => {
    const hour = new Date().getHours();
    rpcMock.mockResolvedValue({
      data: Array.from({ length: 24 }, (_, h) => ({ hour: h, total: 0, order_count: 0 })),
      error: null,
    });
    // orders query won't run because orderCount===0 short-circuits, but mock
    // for safety so any incidental call doesn't blow up.
    fromMock.mockImplementation(() => buildOrdersBuilder([]));

    render(withQuery(<ServiceSpeedIndicator />));
    await waitFor(() => {
      expect(screen.getByTestId('service-speed-indicator').getAttribute('data-tone')).toBe('idle');
    });
    expect(rpcMock).toHaveBeenCalledWith('get_sales_by_hour_v1', expect.objectContaining({
      p_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    }));
    void hour;
  });

  it('renders good tone for fast avg fulfillment (≤4 min)', async () => {
    const hour = new Date().getHours();
    const rows = Array.from({ length: 24 }, (_, h) => ({
      hour: h, total: 0, order_count: h === hour ? 3 : 0,
    }));
    rpcMock.mockResolvedValue({ data: rows, error: null });

    const now = Date.now();
    fromMock.mockImplementation(() => buildOrdersBuilder([
      // 2-min avg fulfillment ; 3 orders.
      { created_at: new Date(now - 120_000).toISOString(), paid_at: new Date(now).toISOString() },
      { created_at: new Date(now - 90_000).toISOString(),  paid_at: new Date(now).toISOString() },
      { created_at: new Date(now - 150_000).toISOString(), paid_at: new Date(now).toISOString() },
    ]));

    render(withQuery(<ServiceSpeedIndicator />));
    await waitFor(() => {
      expect(screen.getByTestId('service-speed-indicator').getAttribute('data-tone')).toBe('good');
    });
  });

  it('renders slow tone for very slow fulfillment (>8 min)', async () => {
    const hour = new Date().getHours();
    rpcMock.mockResolvedValue({
      data: Array.from({ length: 24 }, (_, h) => ({
        hour: h, total: 0, order_count: h === hour ? 2 : 0,
      })),
      error: null,
    });

    const now = Date.now();
    fromMock.mockImplementation(() => buildOrdersBuilder([
      // 12-min avg.
      { created_at: new Date(now - 12 * 60 * 1000).toISOString(), paid_at: new Date(now).toISOString() },
      { created_at: new Date(now - 13 * 60 * 1000).toISOString(), paid_at: new Date(now).toISOString() },
    ]));

    render(withQuery(<ServiceSpeedIndicator />));
    await waitFor(() => {
      expect(screen.getByTestId('service-speed-indicator').getAttribute('data-tone')).toBe('slow');
    });
  });

  describe('pure helpers', () => {
    it('toneFor: 0 orders → idle', () => {
      expect(__test__.toneFor(0, null)).toBe('idle');
    });
    it('toneFor: orders with no avg signal → good', () => {
      expect(__test__.toneFor(5, null)).toBe('good');
    });
    it('toneFor: avg ≤ 240s → good', () => {
      expect(__test__.toneFor(5, 200)).toBe('good');
    });
    it('toneFor: avg in (240,480] → busy', () => {
      expect(__test__.toneFor(5, 300)).toBe('busy');
      expect(__test__.toneFor(5, 480)).toBe('busy');
    });
    it('toneFor: avg > 480s → slow', () => {
      expect(__test__.toneFor(5, 481)).toBe('slow');
      expect(__test__.toneFor(5, 900)).toBe('slow');
    });
    it('formatSeconds: under 60', () => {
      expect(__test__.formatSeconds(45)).toBe('45s');
    });
    it('formatSeconds: even minute', () => {
      expect(__test__.formatSeconds(120)).toBe('2m');
    });
    it('formatSeconds: minute + seconds', () => {
      expect(__test__.formatSeconds(125)).toBe('2m 5s');
    });
  });
});
