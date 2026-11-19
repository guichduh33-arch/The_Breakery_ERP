// apps/pos/src/features/shift/hooks/useShift.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { emitPosEvent } from '@/features/audit/emitPosEvent';
import { useShiftStore, type ActiveShift } from '@/stores/shiftStore';
import { useSaleQueryEnabled } from '@/features/lan/hooks/useSaleQueryEnabled';

export function useCurrentShift() {
  const userId = useAuthStore((s) => s.user?.id);
  const setCurrent = useShiftStore((s) => s.setCurrent);
  const enabled = useSaleQueryEnabled(!!userId);

  return useQuery({
    queryKey: ['pos_sessions', 'current', userId],
    enabled,
    queryFn: async (): Promise<ActiveShift | null> => {
      if (!userId) return null;
      const { data, error } = await supabase
        .from('pos_sessions')
        .select('id, opened_at, opening_cash')
        .eq('opened_by', userId)
        .eq('status', 'open')
        .maybeSingle();
      if (error) throw error;
      setCurrent(data);
      return data;
    },
  });
}

/** Codes de refus de open_shift_v1 (S3-01). */
export type OpenShiftErrorCode =
  | 'terminal_required'
  | 'terminal_invalid'
  | 'terminal_session_open'
  | 'user_session_open'
  | 'invalid_opening_cash'
  | 'forbidden';

const OPEN_SHIFT_CODES: readonly OpenShiftErrorCode[] = [
  'terminal_required', 'terminal_invalid', 'terminal_session_open',
  'user_session_open', 'invalid_opening_cash', 'forbidden',
];

export class OpenShiftError extends Error {
  constructor(public readonly code: OpenShiftErrorCode | 'unknown', message: string) {
    super(message);
    this.name = 'OpenShiftError';
  }
}

function isActiveShift(v: unknown): v is ActiveShift {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.id === 'string' && typeof o.opened_at === 'string'
    && typeof o.opening_cash === 'number';
}

export function useOpenShift() {
  const userId = useAuthStore((s) => s.user?.id);
  const queryClient = useQueryClient();
  const setCurrent = useShiftStore((s) => s.setCurrent);

  return useMutation({
    mutationFn: async (input: {
      opening_cash: number;
      opening_notes?: string;
      /** S3-01 — terminal de caisse obligatoire, vérifié par le serveur. */
      terminal_id: string;
      /** S67 (12 D2.3) — grille de coupures d'ouverture (flag config ON). */
      opening_denominations?: Record<string, number> | null;
    }): Promise<ActiveShift> => {
      if (!userId) throw new Error('not_authenticated');
      // S3-01 — l'ouverture passe par open_shift_v1 : le serveur exige un
      // terminal de caisse actif et refuse une 2ᵉ session sur le même poste.
      const { data, error } = await supabase.rpc('open_shift_v1', {
        p_terminal_id:  input.terminal_id,
        p_opening_cash: input.opening_cash,
        ...(input.opening_notes ? { p_opening_notes: input.opening_notes } : {}),
        ...(input.opening_denominations ? { p_opening_denominations: input.opening_denominations } : {}),
      });
      if (error) {
        const code = OPEN_SHIFT_CODES.find((c) => error.message === c);
        throw new OpenShiftError(code ?? 'unknown', error.message);
      }
      if (!isActiveShift(data)) throw new OpenShiftError('unknown', 'invalid_response');
      return { id: data.id, opened_at: data.opened_at, opening_cash: data.opening_cash };
    },
    onSuccess: (shift) => {
      setCurrent(shift);
      // S72 audit — journal the drawer opening (declared opening float is a
      // fraud signal). The pos_sessions row stays authoritative; this is the
      // immutable journal entry mirroring it.
      emitPosEvent('session_opened', {
        session_id: shift.id,
        amount: shift.opening_cash,
      });
      void queryClient.invalidateQueries({ queryKey: ['pos_sessions'] });
    },
  });
}
