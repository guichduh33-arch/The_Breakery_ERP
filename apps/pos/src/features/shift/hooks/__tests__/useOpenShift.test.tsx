// S3-01 — l'ouverture passe par open_shift_v1, terminal obligatoire.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
const { rpc, from } = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc, from } }));
vi.mock('@/stores/authStore', () => ({
  useAuthStore: (sel: (s: { user: { id: string } }) => unknown) => sel({ user: { id: 'profile-1' } }),
}));
vi.mock('@/features/audit/emitPosEvent', () => ({ emitPosEvent: vi.fn() }));
import { useOpenShift, OpenShiftError } from '../useShift';

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

describe('useOpenShift (S3-01)', () => {
  beforeEach(() => { rpc.mockReset(); from.mockReset(); });

  it('opens through open_shift_v1 with the terminal, never by a direct insert', async () => {
    rpc.mockResolvedValue({ data: { id: 's1', opened_at: '2026-11-19T01:00:00Z', opening_cash: 500000, terminal_id: 't1' }, error: null });
    const { result } = renderHook(() => useOpenShift(), { wrapper });
    let shift: unknown;
    await act(async () => { shift = await result.current.mutateAsync({ opening_cash: 500000, terminal_id: 't1' }); });
    expect(rpc).toHaveBeenCalledWith('open_shift_v1', { p_terminal_id: 't1', p_opening_cash: 500000 });
    expect(from).not.toHaveBeenCalled();
    expect(shift).toEqual({ id: 's1', opened_at: '2026-11-19T01:00:00Z', opening_cash: 500000 });
  });

  it.each(['terminal_required', 'terminal_invalid', 'terminal_session_open', 'user_session_open'] as const)(
    'keeps the server refusal code %s', async (code) => {
      rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: code } });
      const { result } = renderHook(() => useOpenShift(), { wrapper });
      await act(async () => {
        await expect(result.current.mutateAsync({ opening_cash: 0, terminal_id: 't1' }))
          .rejects.toMatchObject({ code });
      });
    });

  it('does not confirm an invalid response', async () => {
    rpc.mockResolvedValue({ data: { id: 's1' }, error: null });
    const { result } = renderHook(() => useOpenShift(), { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync({ opening_cash: 0, terminal_id: 't1' }))
        .rejects.toBeInstanceOf(OpenShiftError);
    });
  });
});
