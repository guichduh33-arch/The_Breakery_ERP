// apps/backoffice/src/features/accounting/hooks/useJournalEntryLines.ts
// Session 26b / Wave 2.A — Drilldown : SELECT journal_entry_lines + JOIN accounts.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface JournalEntryLineRow {
  id:           string;
  account_id:   string;
  account_code: string;
  account_name: string;
  debit:        number;
  credit:       number;
  description:  string | null;
}

export const JE_LINES_KEY = ['accounting', 'journal-entry-lines'] as const;

export function useJournalEntryLines(journalEntryId: string | null) {
  return useQuery<JournalEntryLineRow[]>({
    queryKey: [...JE_LINES_KEY, journalEntryId],
    enabled: journalEntryId !== null,
    staleTime: 60_000,
    queryFn: async () => {
      if (journalEntryId === null) return [];
      const { data, error } = await supabase
        .from('journal_entry_lines')
        .select('id, account_id, debit, credit, description, accounts:account_id (code, name)')
        .eq('journal_entry_id', journalEntryId)
        .order('id', { ascending: true });
      if (error) throw error;
      interface RawLine {
        id: string;
        account_id: string;
        debit: number;
        credit: number;
        description: string | null;
        accounts: { code: string; name: string } | null;
      }
      return ((data ?? []) as unknown as RawLine[]).map((r) => ({
        id:           r.id,
        account_id:   r.account_id,
        account_code: r.accounts?.code ?? '',
        account_name: r.accounts?.name ?? '',
        debit:        Number(r.debit),
        credit:       Number(r.credit),
        description:  r.description,
      }));
    },
  });
}
