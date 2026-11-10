// apps/backoffice/src/features/reports/hooks/__tests__/useProductionVsSales.test.tsx
//
// S3-19 — le contrat du hook : la RPC appelée et ses arguments (les filtres
// optionnels sont OMIS, pas `undefined`), le mapping validé de la réponse, une
// réponse malformée qui devient une ERREUR lisible (jamais une page blanche) et
// la normalisation des refus P0003 / 42501 pour la bannière du socle.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const mockRpc = vi.fn();

vi.mock('@/lib/supabase.js', () => ({
  supabase: { rpc: (fn: string, args: Record<string, unknown>) => mockRpc(fn, args) as unknown },
}));

import {
  parseProductionVsSales, toReportError, useProductionVsSales,
} from '../useProductionVsSales.js';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const FIG = { produced: 10, sold_counter: 6, sold_b2b: 2, sold_total: 8, wasted: 1, gap: 1 };

const ENVELOPE = {
  period: { start: '2026-11-01', end: '2026-11-07' },
  timezone: 'Asia/Makassar',
  generated_at: '2026-11-10T08:00:00+08:00',
  categories: [{ id: 'c1', name: 'Classic breads', slug: 'classic-breads' }],
  summary: { ...FIG, sell_through_pct: 80 },
  by_day: [{ date: '2026-11-01', ...FIG }],
  by_category: [{ category_id: 'c1', category_name: 'Classic breads', ...FIG, sell_through_pct: 80 }],
  by_product: [{
    product_id: 'p1', product_name: 'Baguette', category_id: 'c1', category_name: 'Classic breads',
    ...FIG, sell_through_pct: null,
  }],
  by_day_product: [{ date: '2026-11-01', product_id: 'p1', ...FIG, gap: -3 }],
};

beforeEach(() => {
  mockRpc.mockReset();
});

describe('useProductionVsSales', () => {
  it('calls get_production_vs_sales_v1 and omits the unset filters', async () => {
    mockRpc.mockResolvedValue({ data: ENVELOPE, error: null });
    const { result } = renderHook(
      () => useProductionVsSales({ start: '2026-11-01', end: '2026-11-07' }), { wrapper },
    );
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });
    expect(mockRpc).toHaveBeenCalledWith('get_production_vs_sales_v1', {
      p_start_date: '2026-11-01', p_end_date: '2026-11-07',
    });
  });

  it('sends the category and item filters when set', async () => {
    mockRpc.mockResolvedValue({ data: ENVELOPE, error: null });
    const { result } = renderHook(
      () => useProductionVsSales({ start: '2026-11-01', end: '2026-11-07', categoryId: 'c1', productId: 'p1' }),
      { wrapper },
    );
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });
    expect(mockRpc).toHaveBeenCalledWith('get_production_vs_sales_v1', {
      p_start_date: '2026-11-01', p_end_date: '2026-11-07', p_category_id: 'c1', p_product_id: 'p1',
    });
  });

  it('maps every section, keeping a null sell-through and a negative gap', async () => {
    mockRpc.mockResolvedValue({ data: ENVELOPE, error: null });
    const { result } = renderHook(
      () => useProductionVsSales({ start: '2026-11-01', end: '2026-11-07' }), { wrapper },
    );
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });
    const d = result.current.data;
    expect(d?.period).toEqual({ start: '2026-11-01', end: '2026-11-07' });
    expect(d?.categories[0]?.slug).toBe('classic-breads');
    expect(d?.summary.sell_through_pct).toBe(80);
    expect(d?.by_product[0]?.sell_through_pct).toBeNull();
    expect(d?.by_product[0]?.category_name).toBe('Classic breads');
    expect(d?.by_day_product[0]?.gap).toBe(-3);
    expect(d?.by_category[0]?.sold_b2b).toBe(2);
  });

  it('turns a malformed response into a readable error, not a crash', async () => {
    mockRpc.mockResolvedValue({ data: { ...ENVELOPE, by_product: null }, error: null });
    const { result } = renderHook(
      () => useProductionVsSales({ start: '2026-11-01', end: '2026-11-07' }), { wrapper },
    );
    await waitFor(() => { expect(result.current.isError).toBe(true); });
    expect(result.current.error?.message).toMatch(/Unexpected report data.*by_product/);
  });

  it('maps the owner-only refusal (P0003) for the shell banner', async () => {
    mockRpc.mockResolvedValue({
      data: null, error: { code: 'P0003', message: 'stock_visibility_owner_required' },
    });
    const { result } = renderHook(
      () => useProductionVsSales({ start: '2026-11-01', end: '2026-11-07' }), { wrapper },
    );
    await waitFor(() => { expect(result.current.isError).toBe(true); });
    expect(result.current.error?.message).toBe('stock_visibility_owner_required');
  });
});

describe('parseProductionVsSales', () => {
  it.each([
    ['a non-object', null, /response/],
    ['a string number', { ...ENVELOPE, summary: { ...ENVELOPE.summary, produced: '10' } }, /summary\.produced/],
    ['a missing period', { ...ENVELOPE, period: undefined }, /period/],
    ['a non-finite number', { ...ENVELOPE, by_day: [{ date: '2026-11-01', ...FIG, gap: Number.NaN }] }, /by_day\[0\]\.gap/],
  ])('rejects %s', (_label, raw, pattern) => {
    expect(() => parseProductionVsSales(raw)).toThrow(pattern);
  });
});

describe('toReportError', () => {
  it('maps 42501 to permission_denied and keeps other messages', () => {
    expect(toReportError({ code: '42501', message: 'permission denied' }).message).toBe('permission_denied');
    expect(toReportError({ code: '22023', message: 'invalid_date_range' }).message).toBe('invalid_date_range');
  });
});
