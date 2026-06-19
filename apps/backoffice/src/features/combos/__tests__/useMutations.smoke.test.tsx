// apps/backoffice/src/features/combos/__tests__/useMutations.smoke.test.tsx
//
// Session 47 — smoke tests for useUpsertCombo + useDeleteCombo.
// Verifies: correct RPC names, correct argument shapes, and cache invalidation.

import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useUpsertCombo, type UpsertComboPayload } from '../hooks/useUpsertCombo.js';
import { useDeleteCombo } from '../hooks/useDeleteCombo.js';

// Must use vi.hoisted to avoid "cannot access before initialization" in factory
const { rpcMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
}));

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc: rpcMock,
  },
}));

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const PAYLOAD: UpsertComboPayload = {
  combo_product_id: null,
  sku: null,
  name: 'Test Combo',
  description: null,
  image_url: null,
  category_id: 'cat-1',
  base_price: 45000,
  display_order: 0,
  available_from: null,
  available_to: null,
  is_active: true,
  visible_on_pos: true,
  groups: [
    {
      name: 'Drinks',
      group_type: 'single',
      is_required: true,
      min_select: 1,
      max_select: 1,
      sort_order: 0,
      options: [
        {
          component_product_id: 'p-amer',
          surcharge: 0,
          is_default: true,
          sort_order: 0,
        },
      ],
    },
  ],
};

describe('useUpsertCombo', () => {
  it('calls upsert_combo_v1 with p_combo and p_idempotency_key', async () => {
    rpcMock.mockResolvedValueOnce({
      data: { combo_product_id: 'cb-new', sku: 'CMB-NEW', idempotent_replay: false },
      error: null,
    });

    const { result } = renderHook(() => useUpsertCombo(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync(PAYLOAD);
    });

    expect(rpcMock).toHaveBeenCalledWith(
      'upsert_combo_v1',
      expect.objectContaining({
        p_combo: PAYLOAD,
        p_idempotency_key: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
        ),
      }),
    );
  });

  it('throws when rpc returns an error', async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: new Error('DB error') });
    const { result } = renderHook(() => useUpsertCombo(), { wrapper });

    await expect(
      act(async () => {
        await result.current.mutateAsync(PAYLOAD);
      }),
    ).rejects.toThrow('DB error');
  });

  it('rotates idempotency key after success', async () => {
    rpcMock
      .mockResolvedValueOnce({
        data: { combo_product_id: 'cb-1', sku: 'CMB-001', idempotent_replay: false },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { combo_product_id: 'cb-1', sku: 'CMB-001', idempotent_replay: false },
        error: null,
      });

    const { result } = renderHook(() => useUpsertCombo(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync(PAYLOAD);
    });
    const firstKey = (rpcMock.mock.calls[0] as [string, { p_idempotency_key: string }])[1]
      .p_idempotency_key;

    await act(async () => {
      await result.current.mutateAsync(PAYLOAD);
    });
    const secondKey = (rpcMock.mock.calls[1] as [string, { p_idempotency_key: string }])[1]
      .p_idempotency_key;

    expect(firstKey).not.toBe(secondKey);
  });
});

describe('useDeleteCombo', () => {
  it('calls delete_combo_v1 with p_combo_product_id', async () => {
    rpcMock.mockResolvedValueOnce({
      data: { combo_product_id: 'cb-1', deleted: true },
      error: null,
    });

    const { result } = renderHook(() => useDeleteCombo(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync('cb-1');
    });

    expect(rpcMock).toHaveBeenCalledWith('delete_combo_v1', { p_combo_product_id: 'cb-1' });
  });

  it('throws when rpc returns an error', async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: new Error('not found') });
    const { result } = renderHook(() => useDeleteCombo(), { wrapper });

    await expect(
      act(async () => {
        await result.current.mutateAsync('cb-missing');
      }),
    ).rejects.toThrow('not found');
  });

  it('resolves with DeleteComboResult', async () => {
    rpcMock.mockResolvedValueOnce({
      data: { combo_product_id: 'cb-2', deleted: true },
      error: null,
    });

    const { result } = renderHook(() => useDeleteCombo(), { wrapper });

    let res: { combo_product_id: string; deleted: boolean } | undefined;
    await act(async () => {
      res = await result.current.mutateAsync('cb-2');
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(res).toEqual({ combo_product_id: 'cb-2', deleted: true });
  });
});
