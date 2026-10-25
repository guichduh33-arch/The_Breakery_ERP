// apps/backoffice/src/features/accounting/hooks/useCreateManualJournalEntry.ts
// Session 26b / Wave 2.A — Wraps create_manual_je_v1 RPC.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import type { Json } from '@breakery/supabase';
import { JOURNAL_ENTRIES_KEY } from './useJournalEntries.js';

export interface ManualJELine {
  account_id:  string;
  debit?:      number;
  credit?:     number;
  description?: string;
}

export interface CreateManualJEArgs {
  description: string;
  entry_date:  string; // ISO YYYY-MM-DD
  lines:       ManualJELine[];
  manager_pin: string;
}

export function useCreateManualJournalEntry() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, CreateManualJEArgs>({
    mutationFn: async ({ description, entry_date, lines, manager_pin }) => {
      const { data, error } = await supabase.rpc('create_manual_je_v2', {
        p_description: description,
        p_entry_date:  entry_date,
        p_lines:       lines as unknown as Json,
        p_manager_pin: manager_pin,
      });
      // Un refus retourné permet au serveur de commiter le compteur PIN.
      if (data && typeof data === 'object' && !Array.isArray(data) && data.ok === false) {
        throw new Error(typeof data.error === 'string' ? data.error : 'invalid_pin');
      }
      if (error !== null) throw new Error(error.message);
      return data;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: JOURNAL_ENTRIES_KEY });
    },
  });
}
