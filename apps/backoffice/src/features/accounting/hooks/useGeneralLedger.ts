// apps/backoffice/src/features/accounting/hooks/useGeneralLedger.ts
// Session 26b / Wave 3 — Wraps get_general_ledger_v2 RPC (cursor-paginate).
// S50 W1.2 — bumped v1 → v2 (permission gate: accounting.gl.read).
// Returns { account, period, opening_balance, lines, total_debit, total_credit,
//           next_cursor }.
//
// Pagination : `useInfiniteQuery`, comme le journal et l'audit. Le curseur
// `{last_date, last_id}` EST le `pageParam` et la RPC rend déjà `next_cursor` —
// l'accumulateur maison que la page portait (deux `useEffect` en cascade, un
// `setState` posé dans l'updater d'un autre, une déduplication heuristique)
// réimplémentait, moins bien, ce que la bibliothèque fait.
//
// `opening_balance`, `total_debit` et `total_credit` sont calculés sur la
// PÉRIODE, pas sur la page (cf. `20260603000023_create_get_general_ledger_v1_rpc`)
// : ils sont donc identiques sur toutes les pages, et se lisent sur la première.

import { useInfiniteQuery } from '@tanstack/react-query';
import type { Json } from '@breakery/supabase';
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

/** Position keyset de la dernière ligne rendue. */
export interface GeneralLedgerCursor {
  last_date: string;
  last_id:   string;
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
  next_cursor:     GeneralLedgerCursor | null;
}

export interface UseGeneralLedgerArgs {
  accountId: string | null;
  startDate: string;
  endDate:   string;
  limit?:    number;
}

export const GENERAL_LEDGER_KEY = ['accounting', 'general-ledger'] as const;

export function useGeneralLedger({
  accountId, startDate, endDate, limit = 50,
}: UseGeneralLedgerArgs) {
  return useInfiniteQuery<GeneralLedgerPayload, Error>({
    queryKey: [...GENERAL_LEDGER_KEY, accountId, startDate, endDate, limit],
    enabled: accountId !== null && accountId !== '',
    staleTime: 60_000,
    initialPageParam: null as GeneralLedgerCursor | null,
    queryFn: async ({ pageParam }) => {
      const cursor = pageParam as GeneralLedgerCursor | null;
      const { data, error } = await supabase.rpc('get_general_ledger_v2', {
        // `enabled` garantit le compte non nul avant que `queryFn` ne parte.
        p_account_id: accountId!,
        p_date_start: startDate,
        p_date_end:   endDate,
        p_limit:      limit,
        // La RPC déclare `p_cursor?: Json` ; une `interface` n'a pas l'index
        // signature implicite qu'exige ce type, d'où le passage par `unknown`
        // — il remplace le `as any` que cet argument portait.
        ...(cursor !== null ? { p_cursor: cursor as unknown as Json } : {}),
      });
      if (error !== null) throw new Error(error.message);
      return data as unknown as GeneralLedgerPayload;
    },
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
}
