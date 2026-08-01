// apps/backoffice/src/features/reports/hooks/__tests__/useWastageReport.test.tsx
//
// Audit Reports 2026-08-01, lot E — PREMIER test de hook du module.
//
// Le module comptait 45 fichiers de tests et zero test de hook : toute la couche
// de mapping enveloppe RPC -> contrat du hook n'avait aucun filet. C'est cette
// couche qui a bouge aux lots A et B (repointage v1 -> v2, `truncated`,
// `by_product`), et c'est elle que les smoke tests de page ne voient qu'a
// travers le DOM.
//
// Couvre : le nom de RPC appele, la remontee de `truncated` (R-08), la
// ventilation `by_product` (R-09), le repli `recorded_by` <- `created_by_name`,
// et la robustesse aux champs absents.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const mockRpc = vi.fn();

vi.mock('@/lib/supabase.js', () => ({
  supabase: { rpc: (fn: string, args: Record<string, unknown>) => mockRpc(fn, args) as unknown },
}));

import { useWastageReport } from '../useWastageReport.js';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const ENVELOPE = {
  period:  { start: '2026-07-01', end: '2026-07-31' },
  summary: {
    total_value:              1_435_079,
    total_manual_waste_value: 1_200_000,
    total_spoilage_value:       235_079,
    line_count:               23,
  },
  by_product: [
    {
      product_id: 'p-1', product_name: 'Croissant',
      manual_waste_qty: 12, manual_waste_value: 900_000,
      spoilage_qty: 3, spoilage_value: 235_079,
      total_qty: 15, total_value: 1_135_079,
    },
  ],
  lines: [
    {
      id: 'w-1', product_id: 'p-1', product_name: 'Croissant',
      type: 'manual_waste', qty: 12, value: 900_000,
      created_at: '2026-07-20T08:00:00Z', created_by_name: 'Ada',
    },
  ],
  truncated: false,
};

beforeEach(() => {
  mockRpc.mockReset();
  mockRpc.mockResolvedValue({ data: ENVELOPE, error: null });
});

describe('useWastageReport', () => {
  it('appelle get_wastage_report_v2 avec les bornes metier', async () => {
    const { result } = renderHook(
      () => useWastageReport({ start: '2026-07-01', end: '2026-07-31' }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockRpc).toHaveBeenCalledWith('get_wastage_report_v2', {
      p_date_start: '2026-07-01',
      p_date_end:   '2026-07-31',
    });
  });

  it('expose la ventilation par produit (R-09), que le hook jetait avant', async () => {
    const { result } = renderHook(
      () => useWastageReport({ start: '2026-07-01', end: '2026-07-31' }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.by_product).toHaveLength(1);
    expect(result.current.data?.by_product[0]).toMatchObject({
      product_name:       'Croissant',
      manual_waste_value: 900_000,
      spoilage_value:     235_079,
      total_value:        1_135_079,
    });
    // Le split manuel / peremption du sommaire, promis par la tuile du hub.
    expect(result.current.data?.manual_value).toBe(1_200_000);
    expect(result.current.data?.spoilage_value).toBe(235_079);
  });

  it('remonte `truncated` (R-08) tel que le serveur le calcule', async () => {
    mockRpc.mockResolvedValue({ data: { ...ENVELOPE, truncated: true }, error: null });
    const { result } = renderHook(
      () => useWastageReport({ start: '2026-07-01', end: '2026-07-31' }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.truncated).toBe(true);
  });

  it('replie recorded_by sur created_by_name', async () => {
    const { result } = renderHook(
      () => useWastageReport({ start: '2026-07-01', end: '2026-07-31' }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.lines[0]?.recorded_by).toBe('Ada');
  });

  it('ne casse pas sur une enveloppe amputee', async () => {
    mockRpc.mockResolvedValue({ data: {}, error: null });
    const { result } = renderHook(
      () => useWastageReport({ start: '2026-07-01', end: '2026-07-31' }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toMatchObject({
      lines: [], by_product: [], total_value: 0, truncated: false,
    });
    // Le periode retombe sur les parametres demandes.
    expect(result.current.data?.period).toEqual({ start: '2026-07-01', end: '2026-07-31' });
  });
});
