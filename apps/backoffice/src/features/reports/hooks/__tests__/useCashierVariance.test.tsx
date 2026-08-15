// apps/backoffice/src/features/reports/hooks/__tests__/useCashierVariance.test.tsx
//
// Lot A1 (campagne Reports 2026-08-15) — le hook castait l'enveloppe à
// l'aveugle alors que le serveur avoue lui-même sa forme dégradée : sur une
// période sans shift fermé, `totals` vaut `{ sessions_count: 0 }` SANS les
// sous-objets cash/qris/card que l'interface déclare non-optionnels. Le parse
// défensif ajouté au lot A1 est verrouillé ici, fallback compris.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const mockRpc = vi.fn();

vi.mock('@/lib/supabase.js', () => ({
  supabase: { rpc: (fn: string, args: Record<string, unknown>) => mockRpc(fn, args) as unknown },
}));

import { useCashierVariance } from '../useCashierVariance.js';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const ENVELOPE = {
  generated_at: '2026-08-15T10:00:00+08:00',
  start_date:   '2026-07-01',
  end_date:     '2026-07-31',
  timezone:     'Asia/Makassar',
  cashiers: [
    {
      cashier_id:     'c-1',
      cashier_name:   'Dewi',
      sessions_count: 22,
      cash: {
        total_variance: -45_000, avg_variance: -2_045, total_short: -60_000,
        short_count: 4, over_count: 2, worst_variance: -25_000,
      },
      qris: { counted_sessions: 22, total_variance: 0 },
      card: { counted_sessions: 20, total_variance: -5_000 },
      dow_cash: [{ dow: 1, sessions: 4, total_variance: -10_000 }],
    },
  ],
  totals: {
    sessions_count: 22,
    cash: { total_variance: -45_000, total_short: -60_000, short_count: 4, over_count: 2 },
    qris: { counted_sessions: 22, total_variance: 0 },
    card: { counted_sessions: 20, total_variance: -5_000 },
  },
};

beforeEach(() => {
  mockRpc.mockReset();
  mockRpc.mockResolvedValue({ data: ENVELOPE, error: null });
});

describe('useCashierVariance', () => {
  it('appelle get_cashier_variance_v2 avec p_start_date / p_end_date', async () => {
    const { result } = renderHook(
      () => useCashierVariance('2026-07-01', '2026-07-31'),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockRpc).toHaveBeenCalledWith('get_cashier_variance_v2', {
      p_start_date: '2026-07-01',
      p_end_date:   '2026-07-31',
    });
  });

  it('mappe caissiers, matrice jour-de-semaine et totaux', async () => {
    const { result } = renderHook(
      () => useCashierVariance('2026-07-01', '2026-07-31'),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const row = result.current.data?.cashiers[0];
    expect(row?.cashier_name).toBe('Dewi');
    expect(row?.cash.total_short).toBe(-60_000);
    expect(row?.dow_cash[0]?.dow).toBe(1);
    expect(result.current.data?.totals.cash.short_count).toBe(4);
  });

  it('normalise le fallback serveur de période vide (totals sans cash/qris/card)', async () => {
    // COALESCE(v_totals, jsonb_build_object('sessions_count', 0)) — la forme
    // exacte rendue par la RPC quand aucun shift n'est fermé sur la période.
    mockRpc.mockResolvedValue({
      data: {
        generated_at: '2026-08-15T10:00:00+08:00',
        start_date: '2026-07-01', end_date: '2026-07-31',
        timezone: 'Asia/Makassar',
        cashiers: [],
        totals: { sessions_count: 0 },
      },
      error: null,
    });
    const { result } = renderHook(
      () => useCashierVariance('2026-07-01', '2026-07-31'),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.cashiers).toEqual([]);
    expect(result.current.data?.totals.sessions_count).toBe(0);
    // Le TypeError latent d'avant A1 : ces accès plantaient sur undefined.
    expect(result.current.data?.totals.cash.total_variance).toBe(0);
    expect(result.current.data?.totals.qris.counted_sessions).toBe(0);
    expect(result.current.data?.totals.card.total_variance).toBe(0);
  });

  it('traduit 42501 en permission_denied', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'denied' } });
    const { result } = renderHook(
      () => useCashierVariance('2026-07-01', '2026-07-31'),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error!.message).toBe('permission_denied');
  });
});
