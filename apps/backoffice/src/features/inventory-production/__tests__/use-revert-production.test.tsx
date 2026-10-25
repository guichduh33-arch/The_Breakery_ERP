import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useRevertProduction } from '../hooks/useRevertProduction.js';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase.js', () => ({ supabase: { rpc } }));

function setup() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { ...renderHook(() => useRevertProduction(), { wrapper }), invalidate };
}

const args = { productionId: 'production-id', reason: 'Incorrect batch quantity' };
describe('production reversal server result', () => {
  beforeEach(() => rpc.mockReset());

  it('uses the guarded RPC and refreshes stock and records on confirmed success', async () => {
    rpc.mockResolvedValue({ data: { production_id: args.productionId }, error: null });
    const { result, invalidate } = setup();
    await act(async () => { await result.current.mutateAsync(args); });
    expect(rpc).toHaveBeenCalledWith('revert_production_v3', {
      p_production_id: args.productionId, p_reason: args.reason,
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['inventory-production', 'records'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['stock-levels'] });
  });

  it('keeps concurrent second reversal as an error without reporting success', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'already_reverted' } });
    const { result, invalidate } = setup();
    await act(async () => {
      await expect(result.current.mutateAsync(args)).rejects.toMatchObject({ code: 'already_reverted' });
    });
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('preserves outgoing movement details when a committed consumption blocks reversal', async () => {
    const blockers = [{ movement_id: 'movement-id', movement_type: 'waste', quantity: -1,
      occurred_at: '2026-10-25T08:00:00Z', reason: 'Damaged' }];
    rpc.mockResolvedValue({ data: null, error: { message: 'already_consumed', details: JSON.stringify(blockers) } });
    const { result, invalidate } = setup();
    await act(async () => {
      await expect(result.current.mutateAsync(args)).rejects.toMatchObject({ code: 'already_consumed', blockers });
    });
    expect(invalidate).not.toHaveBeenCalled();
  });
});
