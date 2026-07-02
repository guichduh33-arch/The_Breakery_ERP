// Session 56 — DEV-S54-01 : wraps close_fiscal_year_v1 (S54 migration _080).
// Zeroes classes 4/5/6 into 3200 Retained Earnings and seeds the 12 periods
// of year N+1. line_count=0 (no activity) is a SUCCESS with je_id=null.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { FISCAL_PERIODS_KEY } from './useFiscalPeriods.js';

export type CloseFiscalYearErrorCode =
  | 'fiscal_year_invalid'
  | 'pin_required'
  | 'forbidden'
  | 'invalid_pin'
  | 'periods_missing'
  | 'periods_open'
  | 'year_already_closed'
  | 'retained_earnings_missing'
  | 'unknown';

export class CloseFiscalYearError extends Error {
  constructor(public code: CloseFiscalYearErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'CloseFiscalYearError';
  }
}

export function classifyCloseFiscalYearError(message: string): CloseFiscalYearErrorCode {
  if (message.includes('fiscal_year_invalid'))                  return 'fiscal_year_invalid';
  if (message.includes('pin_required'))                         return 'pin_required';
  if (message.includes('invalid_pin'))                          return 'invalid_pin';
  if (message.includes('forbidden'))                            return 'forbidden';
  if (message.includes('fiscal_year_periods_missing'))          return 'periods_missing';
  if (message.includes('fiscal_year_periods_open'))             return 'periods_open';
  if (message.includes('year_already_closed'))                  return 'year_already_closed';
  if (message.includes('retained_earnings_account_missing'))    return 'retained_earnings_missing';
  return 'unknown';
}

export interface CloseFiscalYearArgs {
  fiscalYear: number;
  managerPin: string;
}

export interface CloseFiscalYearResult {
  fiscal_year:               number;
  je_id:                     string | null;
  entry_number:              string | null;
  net_result:                number;
  line_count:                number;
  retained_earnings_account: string;
  periods_seeded_next_year:  number;
}

export function useCloseFiscalYear() {
  const qc = useQueryClient();
  return useMutation<CloseFiscalYearResult, CloseFiscalYearError, CloseFiscalYearArgs>({
    mutationFn: async ({ fiscalYear, managerPin }) => {
      const { data, error } = await supabase.rpc('close_fiscal_year_v1', {
        p_fiscal_year: fiscalYear,
        p_manager_pin: managerPin,
      });
      if (error !== null) {
        throw new CloseFiscalYearError(classifyCloseFiscalYearError(error.message), error.message);
      }
      return data as unknown as CloseFiscalYearResult;
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: FISCAL_PERIODS_KEY }),
        qc.invalidateQueries({ queryKey: ['accounting'] }),
      ]);
    },
  });
}
