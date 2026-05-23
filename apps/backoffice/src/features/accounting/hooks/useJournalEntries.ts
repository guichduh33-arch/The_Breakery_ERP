// apps/backoffice/src/features/accounting/hooks/useJournalEntries.ts
// Session 26b / Wave 2.A — SELECT direct journal_entries via auth_read policy.
// MVP : LIMIT 200 ordered by (entry_date DESC, id DESC) + filter période optionnel.
// Vrai keyset paginate déferré S26c (see DEV-S26b-2.A-01).

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface JournalEntryRow {
  id:             string;
  entry_number:   string;
  entry_date:     string;
  description:    string | null;
  reference_type: string | null;
  reference_id:   string | null;
  status:         string;
  total_debit:    number;
  total_credit:   number;
  created_at:     string;
}

export interface JournalEntriesFilter {
  startDate?: string; // ISO YYYY-MM-DD
  endDate?:   string;
}

export const JOURNAL_ENTRIES_KEY = ['accounting', 'journal-entries'] as const;

export function useJournalEntries(filter: JournalEntriesFilter = {}) {
  return useQuery<JournalEntryRow[]>({
    queryKey: [...JOURNAL_ENTRIES_KEY, filter.startDate ?? null, filter.endDate ?? null],
    staleTime: 30_000,
    queryFn: async () => {
      let q = supabase
        .from('journal_entries')
        .select(
          'id, entry_number, entry_date, description, reference_type, reference_id, status, total_debit, total_credit, created_at'
        );
      if (filter.startDate) q = q.gte('entry_date', filter.startDate);
      if (filter.endDate)   q = q.lte('entry_date', filter.endDate);
      const { data, error } = await q
        .order('entry_date', { ascending: false })
        .order('id', { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as JournalEntryRow[];
    },
  });
}
