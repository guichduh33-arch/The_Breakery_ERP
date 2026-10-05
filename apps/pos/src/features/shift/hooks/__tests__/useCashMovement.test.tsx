import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useCashMovement, type CashMovementInput } from '../useCashMovement';
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc } }));
const input: CashMovementInput = { session_id: 'shift', direction: 'in', amount: 100000, reason: 'Float top-up', reason_code: 'misc', idempotency_key: 'uuid' };
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}
describe('confirmation du mouvement cash', () => {
  it('conserve le code serveur pour distinguer refus et résultat inconnu', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'P0003', message: 'forbidden' } });
    const { result } = renderHook(() => useCashMovement(), { wrapper });
    await act(async () => { await expect(result.current.mutateAsync(input)).rejects.toMatchObject({ details: { code: 'P0003' } }); });
  });
  it.each([
    { data: null },
    { data: { movement_id: 'm', session_id: 'other', cash_in_total: 1, cash_out_total: 0 } },
    { data: { movement_id: 'm', session_id: 'shift', cash_in_total: null, cash_out_total: 0 } },
    { data: { session_id: 'shift', cash_in_total: 1, cash_out_total: 0 } },
  ])('ne confirme pas une enveloppe invalide %j', async ({ data }) => {
    rpc.mockResolvedValue({ data, error: null });
    const { result } = renderHook(() => useCashMovement(), { wrapper });
    await act(async () => { await expect(result.current.mutateAsync(input)).rejects.toThrow('confirmation unavailable'); });
  });
});
