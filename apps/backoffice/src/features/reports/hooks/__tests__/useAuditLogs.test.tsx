import type { PropsWithChildren } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { useAuditLogs } from '../useAuditLogs.js';
import { useSettingsHistory } from '@/features/settings/hooks/useSettingsHistory.js';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase.js', () => ({ supabase: { rpc } }));

describe('curseur audit composite', () => {
  it.each(['reports', 'settings'] as const)('transmet date et identifiant pour %s', async (surface) => {
    const timestamp = '2026-09-12T08:00:00.123456+00:00';
    const rows = Array.from({ length: 50 }, (_, i) => ({
      id: 100 - i, created_at: timestamp, actor_id: null,
      action: 'setting.update', entity_type: 'setting', entity_id: null, metadata: {},
    }));
    rpc.mockReset();
    rpc.mockImplementation((_name: string, args: { p_action?: string; p_cursor?: string }) => Promise.resolve({
      data: args.p_action === 'b2b_settings.updated' || args.p_cursor ? [] : rows, error: null,
    }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function Wrapper({ children }: PropsWithChildren) {
      return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    }
    const useFeed = surface === 'reports' ? useAuditLogs : useSettingsHistory;
    const { result, unmount } = renderHook(() => useFeed(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.hasNextPage).toBe(true));
    await act(async () => { await result.current.fetchNextPage(); });
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('get_audit_logs_v4',
      expect.objectContaining({ p_cursor: timestamp + '|51' })));
    unmount();
    client.clear();
  });
});
