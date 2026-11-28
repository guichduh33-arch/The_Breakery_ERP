// apps/backoffice/src/features/pos-terminals/hooks/useRenamePosTerminal.ts
// Nomme un terminal POS via `register_pos_device_v1` (SECURITY DEFINER, gardée
// `reports.audit.read`, idempotente sur le jeton). Aucune écriture directe :
// `pos_devices` n'accorde ni INSERT ni UPDATE au rôle authenticated.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { POS_TERMINALS_KEY, type PosTerminalKind } from './usePosTerminals.js';

export const POS_TERMINAL_LABEL_MAX = 40;

export interface RenamePosTerminalInput {
  deviceToken: string;
  label: string;
  kind: PosTerminalKind;
}

/** Message d'erreur affichable, ou null si la saisie est valide. */
export function validateTerminalLabel(label: string): string | null {
  const trimmed = label.trim();
  if (trimmed === '') return 'Name is required.';
  if (trimmed.length > POS_TERMINAL_LABEL_MAX) {
    return `Name must be ${POS_TERMINAL_LABEL_MAX} characters or fewer.`;
  }
  return null;
}

export function useRenamePosTerminal() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, RenamePosTerminalInput>({
    mutationFn: async ({ deviceToken, label, kind }) => {
      const invalid = validateTerminalLabel(label);
      if (invalid !== null) throw new Error(invalid);
      const { error } = await supabase.rpc('register_pos_device_v1', {
        p_device_token: deviceToken,
        p_label: label.trim(),
        p_kind: kind,
      });
      if (error !== null) {
        throw new Error(error.code === '42501' ? 'You are not allowed to rename terminals.' : error.message);
      }
    },
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: POS_TERMINALS_KEY }); },
  });
}
