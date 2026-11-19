// S3-03 — le propriétaire annule la dernière clôture d'un terminal
// (undo_shift_close_v1). Le PIN est un argument de la fonction : c'est elle
// qui le vérifie, avec verrouillage. Le serveur décide de tout le reste.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export type UndoShiftCloseErrorCode =
  | 'invalid_pin'
  | 'pin_required'
  | 'account_locked'
  | 'forbidden'
  | 'session_not_found'
  | 'session_not_closed'
  | 'terminal_unknown'
  | 'session_not_last'
  | 'user_session_open'
  | 'zreport_not_draft'
  | 'unknown';

const KNOWN: readonly UndoShiftCloseErrorCode[] = [
  'pin_required', 'account_locked', 'forbidden', 'session_not_found', 'session_not_closed',
  'terminal_unknown', 'session_not_last', 'user_session_open', 'zreport_not_draft',
];

export class UndoShiftCloseError extends Error {
  constructor(public readonly code: UndoShiftCloseErrorCode, message: string) {
    super(message);
    this.name = 'UndoShiftCloseError';
  }
}

export interface UndoShiftCloseInput {
  sessionId: string;
  managerPin: string;
  reason?: string;
}

export function useUndoShiftClose() {
  const qc = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: async ({ sessionId, managerPin, reason }: UndoShiftCloseInput) => {
      const { data, error } = await supabase.rpc('undo_shift_close_v1', {
        p_session_id: sessionId,
        p_manager_pin: managerPin,
        ...(reason?.trim() ? { p_reason: reason.trim() } : {}),
      });
      if (error) {
        const code = KNOWN.find((c) => error.message === c) ?? 'unknown';
        throw new UndoShiftCloseError(code, error.message);
      }
      const body = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>;
      if (body.ok === false) {
        throw new UndoShiftCloseError(body.error === 'invalid_pin' ? 'invalid_pin' : 'unknown', String(body.error));
      }
      if (body.ok !== true || body.session_id !== sessionId || body.status !== 'open') {
        throw new UndoShiftCloseError('unknown', 'undo_not_confirmed');
      }
      return { sessionId };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['pos-reports-sessions'] });
      void qc.invalidateQueries({ queryKey: ['pos_sessions'] });
    },
  });
}

/** Message lisible pour chaque refus de undo_shift_close_v1. */
export function undoShiftCloseMessage(err: unknown): string {
  const code = err instanceof UndoShiftCloseError ? err.code : 'unknown';
  switch (code) {
    case 'invalid_pin':
    case 'pin_required':
      return 'Wrong PIN. Try again.';
    case 'account_locked':
      return 'Account locked. Try again later.';
    case 'forbidden':
      return 'Only the owner can undo a shift close.';
    case 'session_not_found':
      return 'This session no longer exists.';
    case 'session_not_closed':
      return 'This session is already open.';
    case 'terminal_unknown':
      return 'This session has no terminal. Its close cannot be undone.';
    case 'session_not_last':
      return 'Only the last close of this terminal can be undone.';
    case 'user_session_open':
      return 'The cashier already has another open shift. Close it first.';
    case 'zreport_not_draft':
      return 'The Z-report is signed. This close can no longer be undone.';
    default:
      return 'The undo is not confirmed. Check the connection and try again.';
  }
}
