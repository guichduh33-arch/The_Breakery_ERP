// S3-03 — annulation de clôture par le propriétaire (undo_shift_close_v1).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc } }));
import { useUndoShiftClose, undoShiftCloseMessage, UndoShiftCloseError } from '../useUndoShiftClose';

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

describe('useUndoShiftClose (S3-03)', () => {
  beforeEach(() => { rpc.mockReset(); });

  it('sends the PIN as an argument of undo_shift_close_v1, with the trimmed reason', async () => {
    rpc.mockResolvedValue({ data: { ok: true, session_id: 's1', status: 'open' }, error: null });
    const { result } = renderHook(() => useUndoShiftClose(), { wrapper });
    await act(async () => { await result.current.mutateAsync({ sessionId: 's1', managerPin: '246810', reason: '  Recount  ' }); });
    expect(rpc).toHaveBeenCalledWith('undo_shift_close_v1', { p_session_id: 's1', p_manager_pin: '246810', p_reason: 'Recount' });
  });

  it('turns a wrong PIN response into invalid_pin', async () => {
    rpc.mockResolvedValue({ data: { ok: false, error: 'invalid_pin' }, error: null });
    const { result } = renderHook(() => useUndoShiftClose(), { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync({ sessionId: 's1', managerPin: '000000' })).rejects.toMatchObject({ code: 'invalid_pin' });
    });
  });

  it.each(['session_not_last', 'zreport_not_draft', 'terminal_unknown', 'forbidden'] as const)(
    'keeps the server refusal %s', async (code) => {
      rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: code } });
      const { result } = renderHook(() => useUndoShiftClose(), { wrapper });
      await act(async () => {
        await expect(result.current.mutateAsync({ sessionId: 's1', managerPin: '246810' })).rejects.toMatchObject({ code });
      });
    });

  it('does not confirm a response for another session', async () => {
    rpc.mockResolvedValue({ data: { ok: true, session_id: 'other', status: 'open' }, error: null });
    const { result } = renderHook(() => useUndoShiftClose(), { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync({ sessionId: 's1', managerPin: '246810' })).rejects.toMatchObject({ code: 'unknown' });
    });
  });

  it('explains a signed Z-report and a close that is not the last', () => {
    expect(undoShiftCloseMessage(new UndoShiftCloseError('zreport_not_draft', ''))).toMatch(/signed/i);
    expect(undoShiftCloseMessage(new UndoShiftCloseError('session_not_last', ''))).toMatch(/last close of this terminal/i);
  });
});
