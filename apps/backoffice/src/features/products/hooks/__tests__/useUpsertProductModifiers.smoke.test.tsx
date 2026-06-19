import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const rpc = vi.fn();
vi.mock('@/lib/supabase.js', () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

import { useUpsertProductModifiers } from '../useUpsertProductModifiers.js';
import type { EditableModifierGroup } from '@breakery/domain';

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const GROUPS: EditableModifierGroup[] = [
  {
    group_name: 'Milk',
    group_type: 'single_select',
    group_required: true,
    group_sort_order: 0,
    options: [
      { option_label: 'Fresh', price_adjustment: 0, is_default: true, option_sort_order: 0, ingredients_to_deduct: [] },
      { option_label: 'Oat', price_adjustment: 10000, is_default: false, option_sort_order: 1, ingredients_to_deduct: [{ product_id: 'oat', qty: 30, unit: 'ml' }] },
    ],
  },
];

describe('useUpsertProductModifiers', () => {
  beforeEach(() => {
    rpc.mockReset();
    rpc.mockResolvedValue({ data: { modifiers: [] }, error: null });
  });

  it('calls upsert_product_modifiers_v1 with the serialized payload', async () => {
    const { result } = renderHook(() => useUpsertProductModifiers('prod-1'), { wrapper });
    result.current.mutate(GROUPS);
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    expect(rpc).toHaveBeenCalledWith('upsert_product_modifiers_v1', expect.objectContaining({
      p_product_id: 'prod-1',
    }));
    const arg = rpc.mock.calls[0][1] as { p_groups: Array<Record<string, unknown>> };
    expect(arg.p_groups[0].group_name).toBe('Milk');
    expect(arg.p_groups[0].group_sort_order).toBe(0);
    const opts = arg.p_groups[0].options as Array<Record<string, unknown>>;
    expect(opts[1].ingredients_to_deduct).toEqual([{ product_id: 'oat', qty: 30, unit: 'ml' }]);
  });

  it('throws on RPC error', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'permission_denied' } });
    const { result } = renderHook(() => useUpsertProductModifiers('prod-1'), { wrapper });
    result.current.mutate(GROUPS);
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toMatch(/permission_denied/);
  });
});
