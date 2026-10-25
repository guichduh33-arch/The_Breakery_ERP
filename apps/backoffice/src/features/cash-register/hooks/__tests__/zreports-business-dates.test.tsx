import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useZReports } from '../useZReports.js';

const query = vi.hoisted(() => ({
  select: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
  gte: vi.fn().mockReturnThis(), lt: vi.fn().mockReturnThis(),
  then: (resolve: (result: { data: never[]; error: null }) => unknown) =>
    Promise.resolve({ data: [], error: null }).then(resolve),
}));
vi.mock('@/lib/supabase.js', () => ({ supabase: { from: () => query } }));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('Z-report business-day filters', () => {
  beforeEach(() => vi.clearAllMocks());
  it('sends a half-open local-day interval, retaining all PostgreSQL microseconds', async () => {
    const { result, unmount } = renderHook(() => useZReports({
      startDate: '2026-07-01', endDate: '2026-07-01',
    }), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(query.gte).toHaveBeenCalledWith('generated_at', '2026-06-30T16:00:00.000Z');
    expect(query.lt).toHaveBeenCalledWith('generated_at', '2026-07-01T16:00:00.000Z');
    unmount();
  });

  it('leaves the dates unrestricted when no filter is supplied', async () => {
    const { result, unmount } = renderHook(() => useZReports(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(query.gte).not.toHaveBeenCalled();
    expect(query.lt).not.toHaveBeenCalled();
    unmount();
  });
});
