// apps/backoffice/src/features/reports/hooks/__tests__/usePaymentsByMethod.test.tsx
//
// Audit Reports 2026-08-01, lot E.
//
// Le pivot `by_day` par methode etait calcule serveur et jete par le hook — la
// tuile du hub promettait « + daily trend » et la tendance n'existait nulle part
// (R-09). Le mapping ajoute au lot B est ici sous test : il normalise dix
// colonnes de methodes, dont sept sont a zero dans la vraie vie, et c'est lui
// qui alimente le choix des series tracees.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const mockRpc = vi.fn();

vi.mock('@/lib/supabase.js', () => ({
  supabase: { rpc: (fn: string, args: Record<string, unknown>) => mockRpc(fn, args) as unknown },
}));

import { usePaymentsByMethod, PAYMENT_METHOD_KEYS } from '../usePaymentsByMethod.js';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const ENVELOPE = {
  period:  { start: '2026-07-01', end: '2026-07-02' },
  summary: {
    total_amount:   1_000_000,
    total_fees_est:     3_500,
    total_net_est:  996_500,
  },
  by_method: [
    { method: 'cash', amount: 600_000, count: 6, share_pct: 60, fee_pct: 0,   fee_est: 0,     net_est: 600_000 },
    { method: 'qris', amount: 400_000, count: 4, share_pct: 40, fee_pct: 0.7, fee_est: 2_800, net_est: 397_200 },
  ],
  by_day: [
    // Le serveur renvoie un `day` timestamp et les dix colonnes de methodes.
    { day: '2026-07-01T00:00:00+08:00', cash: 300_000, qris: 200_000, card: 0, edc: 0,
      transfer: 0, gopay: 0, ovo: 0, dana: 0, store_credit: 0, other: 0, total: 500_000 },
    { day: '2026-07-02T00:00:00+08:00', cash: 300_000, qris: 200_000, card: 0, edc: 0,
      transfer: 0, gopay: 0, ovo: 0, dana: 0, store_credit: 0, other: 0, total: 500_000 },
  ],
};

beforeEach(() => {
  mockRpc.mockReset();
  mockRpc.mockResolvedValue({ data: ENVELOPE, error: null });
});

describe('usePaymentsByMethod', () => {
  it('appelle get_payments_by_method_v3', async () => {
    const { result } = renderHook(
      () => usePaymentsByMethod({ start: '2026-07-01', end: '2026-07-02' }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockRpc).toHaveBeenCalledWith('get_payments_by_method_v3', {
      p_date_start: '2026-07-01',
      p_date_end:   '2026-07-02',
    });
  });

  it('expose byDay avec un jour tronque a la date (R-09)', async () => {
    const { result } = renderHook(
      () => usePaymentsByMethod({ start: '2026-07-01', end: '2026-07-02' }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const byDay = result.current.data?.byDay ?? [];
    expect(byDay).toHaveLength(2);
    expect(byDay[0]?.day).toBe('2026-07-01');
    expect(byDay[0]?.cash).toBe(300_000);
    expect(byDay[0]?.total).toBe(500_000);
  });

  it('normalise les dix colonnes de methodes, y compris celles absentes', async () => {
    // Enveloppe volontairement amputee : seules cash et total sont fournies.
    mockRpc.mockResolvedValue({
      data: { ...ENVELOPE, by_day: [{ day: '2026-07-01', cash: 100, total: 100 }] },
      error: null,
    });
    const { result } = renderHook(
      () => usePaymentsByMethod({ start: '2026-07-01', end: '2026-07-02' }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const row = result.current.data?.byDay[0];
    for (const key of PAYMENT_METHOD_KEYS) {
      expect(typeof row?.[key]).toBe('number');
    }
    expect(row?.qris).toBe(0);
    expect(row?.cash).toBe(100);
  });

  it('remonte les totaux de frais du sommaire', async () => {
    const { result } = renderHook(
      () => usePaymentsByMethod({ start: '2026-07-01', end: '2026-07-02' }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.total).toBe(1_000_000);
    expect(result.current.data?.totalFees).toBe(3_500);
    expect(result.current.data?.totalNet).toBe(996_500);
  });

  it('ne casse pas sur une enveloppe sans by_day', async () => {
    mockRpc.mockResolvedValue({ data: { ...ENVELOPE, by_day: undefined }, error: null });
    const { result } = renderHook(
      () => usePaymentsByMethod({ start: '2026-07-01', end: '2026-07-02' }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.byDay).toEqual([]);
  });
});
