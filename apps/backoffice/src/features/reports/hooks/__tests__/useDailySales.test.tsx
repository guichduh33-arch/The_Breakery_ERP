// apps/backoffice/src/features/reports/hooks/__tests__/useDailySales.test.tsx
//
// Lot A1 (campagne Reports 2026-08-15) — 2 hooks testés sur 26 avant ce lot :
// aucun test n'assertait les noms d'arguments RPC, précisément ce qui laisse
// passer un WRONG_ARG lors d'un futur bump. DailySales est le flagship de la
// campagne : son contrat { period, summary, by_day } est verrouillé ici.
//
// Lot I (2026-08-15) — bump v1 → v2 : payload additif (summary +discount_total/
// discount_orders_count/voids_count/voids_value, racine +sessions). Les tests
// v1 restent valables (extension additive) ; on ajoute la couverture des
// champs neufs + leur tolérance à l'absence (parse défensif).
//
// Bump v2 → v3 (2026-08-21) — `summary` gagne la ventilation par canal de
// règlement (tendered_* / on_account_*). Même traitement : le nom de la RPC est
// verrouillé (c'est ce qui attrape un WRONG_ARG au bump suivant), les quatre
// clés neuves sont mappées, et leur absence retombe à 0 sans casser.

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
  summary: {
    total: 8_610_000, order_count: 247, aov: 34_100, refund_total: 186_000, net: 8_424_000,
    discount_total: 320_000, discount_orders_count: 18, voids_count: 2, voids_value: 145_000,
    // Invariant serveur : total = tendered_total + on_account_total,
    // order_count = tendered_order_count + on_account_order_count.
    tendered_total: 7_610_000, tendered_order_count: 233,
    on_account_total: 1_000_000, on_account_order_count: 14,
  },
  by_day: [
    { date: '2026-07-01', order_count: 120, gross: 4_200_000, refunds: 86_000, net: 4_114_000, aov: 34_283 },
    { date: '2026-07-02', order_count: 127, gross: 4_410_000, refunds: 100_000, net: 4_310_000, aov: 33_937 },
  ],
  sessions: [
    {
      id: 'session-1', cashier: 'Budi Santoso', opened_at: '2026-07-01T00:30:00Z',
      opening_cash: 500_000, status: 'closed', closed_at: '2026-07-01T08:00:00Z', variance_total: -5_000,
    },
    {
      id: 'session-2', cashier: null, opened_at: '2026-07-02T00:15:00Z',
      opening_cash: 500_000, status: 'open', closed_at: null, variance_total: null,
    },
  ],
};

beforeEach(() => {
  mockRpc.mockReset();
  mockRpc.mockResolvedValue({ data: ENVELOPE, error: null });
});

describe('useDailySales', () => {
  it('appelle get_daily_sales_v3 avec p_date_start / p_date_end', async () => {
    const { result } = renderHook(
      () => useDailySales({ start: '2026-07-01', end: '2026-07-02' }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockRpc).toHaveBeenCalledWith('get_daily_sales_v3', {
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

  it('mappe les champs neufs discounts/voids et sessions (lot I, v2)', async () => {
    const { result } = renderHook(
      () => useDailySales({ start: '2026-07-01', end: '2026-07-02' }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.summary.discount_total).toBe(320_000);
    expect(result.current.data?.summary.discount_orders_count).toBe(18);
    expect(result.current.data?.summary.voids_count).toBe(2);
    expect(result.current.data?.summary.voids_value).toBe(145_000);
    expect(result.current.data?.sessions).toHaveLength(2);
    expect(result.current.data?.sessions[0]).toEqual({
      id: 'session-1', cashier: 'Budi Santoso', opened_at: '2026-07-01T00:30:00Z',
      opening_cash: 500_000, status: 'closed', closed_at: '2026-07-01T08:00:00Z', variance_total: -5_000,
    });
    // cashier LEFT JOIN peut être NULL côté serveur — reste null, pas ''.
    expect(result.current.data?.sessions[1]?.cashier).toBeNull();
    expect(result.current.data?.sessions[1]?.closed_at).toBeNull();
    // variance_total est NULL tant que la session est ouverte — jamais coercé à 0.
    expect(result.current.data?.sessions[1]?.variance_total).toBeNull();
  });

  it('mappe la ventilation par canal de règlement (v3) et respecte l’invariant', async () => {
    const { result } = renderHook(
      () => useDailySales({ start: '2026-07-01', end: '2026-07-02' }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const s = result.current.data?.summary;
    expect(s?.tendered_total).toBe(7_610_000);
    expect(s?.tendered_order_count).toBe(233);
    expect(s?.on_account_total).toBe(1_000_000);
    expect(s?.on_account_order_count).toBe(14);
    // Le hook ne recalcule rien : il rend ce que le serveur donne, et le
    // serveur garantit le rapprochement. Un mapping croisé (tendered lu dans
    // on_account) passerait les quatre lignes ci-dessus mais pas celle-ci.
    expect((s?.tendered_total ?? 0) + (s?.on_account_total ?? 0)).toBe(s?.total);
    expect((s?.tendered_order_count ?? 0) + (s?.on_account_order_count ?? 0))
      .toBe(s?.order_count);
  });

  it('ne casse pas sur une enveloppe vide (période sans vente)', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    const { result } = renderHook(
      () => useDailySales({ start: '2026-07-01', end: '2026-07-02' }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.by_day).toEqual([]);
    expect(result.current.data?.sessions).toEqual([]);
    expect(result.current.data?.summary.total).toBe(0);
    expect(result.current.data?.summary.discount_total).toBe(0);
    expect(result.current.data?.summary.voids_count).toBe(0);
    // Clés v3 absentes → 0, jamais NaN ni undefined : la page teste
    // `on_account_total > 0` pour décider de rendre sa ligne de rapprochement.
    expect(result.current.data?.summary.tendered_total).toBe(0);
    expect(result.current.data?.summary.on_account_total).toBe(0);
    expect(result.current.data?.summary.on_account_order_count).toBe(0);
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

  it('normalise une session partielle (champs absents) sans casser', async () => {
    mockRpc.mockResolvedValue({
      data: { ...ENVELOPE, sessions: [{ id: 'session-3' }] },
      error: null,
    });
    const { result } = renderHook(
      () => useDailySales({ start: '2026-07-01', end: '2026-07-02' }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const session = result.current.data?.sessions[0];
    expect(session?.id).toBe('session-3');
    expect(session?.cashier).toBeNull();
    expect(session?.opening_cash).toBe(0);
    expect(session?.status).toBe('');
    expect(session?.closed_at).toBeNull();
    expect(session?.variance_total).toBeNull();
  });
});
