// apps/backoffice/src/features/accounting/hooks/useGeneralLedger.ts
// Session 26b / Wave 3 — Wraps get_general_ledger_v1 RPC (cursor-paginate).
// Returns { account, period, opening_balance, lines, total_debit, total_credit,
//           next_cursor }.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface GLLineRaw {
  je_id:            string;
  entry_number:     string;
  entry_date:       string;
  description:      string | null;
  reference_type:   string | null;
  reference_id:     string | null;
  debit:            number;
  credit:           number;
  line_description: string | null;
}

export interface GeneralLedgerPayload {
  account: {
    id:            string;
    code:          string;
    name:          string;
    account_class: number;
    balance_type:  string;
    is_active:     boolean;
  };
  period:          { start: string; end: string };
  opening_balance: number;
  total_debit:     number;
  total_credit:    number;
  lines:           GLLineRaw[];
  next_cursor:     { last_date: string; last_id: string } | null;
}

export interface UseGeneralLedgerArgs {
  accountId: string | null;
  startDate: string;
  endDate:   string;
  cursor?:   { last_date: string; last_id: string } | null;
  limit?:    number;
}

export const GENERAL_LEDGER_KEY = ['accounting', 'general-ledger'] as const;

export function useGeneralLedger({
  accountId, startDate, endDate, cursor, limit = 50,
}: UseGeneralLedgerArgs) {
  return useQuery<GeneralLedgerPayload>({
    queryKey: [
      ...GENERAL_LEDGER_KEY, accountId, startDate, endDate, cursor ?? null, limit,
    ],
    enabled: accountId !== null && accountId !== '',
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_general_ledger_v1', {
        p_account_id: accountId as string,
        p_date_start: startDate,
        p_date_end:   endDate,
        p_limit:      limit,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...(cursor ? { p_cursor: cursor as any } : {}),
      });
      if (error !== null) throw new Error(error.message);
      return data as unknown as GeneralLedgerPayload;
    },
  });
}
