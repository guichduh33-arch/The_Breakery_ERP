import type { PropsWithChildren } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuditLogs } from '../hooks/useAuditLogs.js';
import { useSettingsHistory } from '@/features/settings/hooks/useSettingsHistory.js';
import { useProductAuditLog } from '@/features/products/hooks/useProductAuditLog.js';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase.js', () => ({ supabase: { rpc } }));

function wrapper({ children }: PropsWithChildren) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
let client: QueryClient;
const date = '2026-09-13T08:00:00+00:00';
function row(id: number) {
  return {
    id, created_at: date, actor_id: null, action: 'setting.update',
    entity_type: 'setting', entity_id: null,
    metadata: { key: 'name', category: 'general', old: 'A', new: 'B' },
  };
}

describe('audit RPC callers', () => {
  beforeEach(() => {
    rpc.mockReset();
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  });

  it('paginates reports across rows sharing a timestamp using the last id', async () => {
    rpc.mockResolvedValueOnce({ data: [row(3), row(2)], error: null })
      .mockResolvedValueOnce({ data: [row(1)], error: null });
    const { result } = renderHook(() => useAuditLogs({ pageSize: 2 }), { wrapper });
    await waitFor(() => expect(result.current.data?.pages[0]).toHaveLength(2));
    await act(async () => { await result.current.fetchNextPage(); });
    expect(rpc).toHaveBeenNthCalledWith(2, 'get_audit_logs_v4', {
      p_limit: 2, p_cursor: date + '|2',
    });
    await waitFor(() => expect(result.current.data?.pages.flat().map(r => r.id)).toEqual([3, 2, 1]));
    expect(result.current.hasNextPage).toBe(false);
  });

  it('paginates each settings feed with its own composite cursor', async () => {
    rpc.mockImplementation((_name: string, args: { p_action: string; p_cursor?: string }) => Promise.resolve({
      data: args.p_cursor ? [] : Array.from({ length: 50 }, (_, i) =>
        row((args.p_action === 'setting.update' ? 100 : 200) - i)),
      error: null,
    }));
    const { result } = renderHook(() => useSettingsHistory(), { wrapper });
    await waitFor(() => expect(result.current.entries).toHaveLength(100));
    act(() => { result.current.fetchNextPage(); });
    await waitFor(() => expect(result.current.hasNextPage).toBe(false));
    expect(rpc).toHaveBeenCalledWith('get_audit_logs_v4', {
      p_action: 'setting.update', p_limit: 50, p_cursor: date + '|51',
    });
    expect(rpc).toHaveBeenCalledWith('get_audit_logs_v4', {
      p_action: 'b2b_settings.updated', p_limit: 50, p_cursor: date + '|151',
    });
  });

  it('keeps the product entity filter on the current RPC', async () => {
    rpc.mockResolvedValue({ data: [row(1)], error: null });
    const { result } = renderHook(() => useProductAuditLog('product-1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(rpc).toHaveBeenCalledWith('get_audit_logs_v4', {
      p_limit: 200, p_entity_type: 'product', p_entity_id: 'product-1',
    });
  });
});
