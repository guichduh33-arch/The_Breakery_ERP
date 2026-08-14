// apps/backoffice/src/features/reports/hooks/__tests__/useDailySales.test.tsx
//
// Lot A1 (campagne Reports 2026-08-15) — 2 hooks testés sur 26 avant ce lot :
// aucun test n'assertait les noms d'arguments RPC, précisément ce qui laisse
// passer un WRONG_ARG lors d'un futur bump. DailySales est le flagship de la
// campagne : son contrat { period, summary, by_day } est verrouillé ici.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const mockRpc = vi.fn();

vi.mock('@/lib/supabase.js', () => ({
  supabase: { rpc: (fn: string, args: Record<string, unknown>) => mockRpc(fn, args) as unknown },
}));

import { useDailySales } from '../useDailySales.js';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const ENVELOPE = {
  period:  { start: '2026-07-01', end: '2026-07-02' },
  summary: { total: 8_610_000, order_count: 247, aov: 34_100, refund_total: 186_000, net: 8_424_000 },
  by_day: [
    { date: '2026-07-01', order_count: 120, gross: 4_200_000, refunds: 86_000, net: 4_114_000, aov: 34_283 },
    { date: '2026-07-02', order_count: 127, gross: 4_410_000, refunds: 100_000, net: 4_310_000, aov: 33_937 },
  ],
};

beforeEach(() => {
  mockRpc.mockReset();
  mockRpc.mockResolvedValue({ data: ENVELOPE, error: null });
});

describe('useDailySales', () => {
  it('appelle get_daily_sales_v1 avec p_date_start / p_date_end', async () => {
    const { result } = renderHook(
      () => useDailySales({ start: '2026-07-01', end: '2026-07-02' }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockRpc).toHaveBeenCalledWith('get_daily_sales_v1', {
      p_date_start: '2026-07-01',
      p_date_end:   '2026-07-02',
    });
  });

  it('mappe le sommaire et les lignes journalières en nombres', async () => {
    const { result } = renderHook(
      () => useDailySales({ start: '2026-07-01', end: '2026-07-02' }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.summary.net).toBe(8_424_000);
    expect(result.current.data?.by_day).toHaveLength(2);
    expect(result.current.data?.by_day[0]?.gross).toBe(4_200_000);
  });

  it('ne casse pas sur une enveloppe vide (période sans vente)', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    const { result } = renderHook(
      () => useDailySales({ start: '2026-07-01', end: '2026-07-02' }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.by_day).toEqual([]);
    expect(result.current.data?.summary.total).toBe(0);
    expect(result.current.data?.period).toEqual({ start: '2026-07-01', end: '2026-07-02' });
  });

  it('normalise des lignes partielles en zéros', async () => {
    mockRpc.mockResolvedValue({
      data: { ...ENVELOPE, by_day: [{ date: '2026-07-01' }] },
      error: null,
    });
    const { result } = renderHook(
      () => useDailySales({ start: '2026-07-01', end: '2026-07-02' }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const row = result.current.data?.by_day[0];
    expect(row?.gross).toBe(0);
    expect(row?.net).toBe(0);
    expect(row?.order_count).toBe(0);
  });
});
