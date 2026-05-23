// apps/backoffice/src/features/accounting/hooks/useCreateManualJournalEntry.ts
// Session 26b / Wave 2.A — Wraps create_manual_je_v1 RPC.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
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
      const { data, error } = await supabase.rpc('create_manual_je_v1', {
        p_description: description,
        p_entry_date:  entry_date,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        p_lines:       lines as any,
        p_manager_pin: manager_pin,
      });
      if (error !== null) throw new Error(error.message);
      return data;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: JOURNAL_ENTRIES_KEY });
    },
  });
}
