import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface ExpenseTerm {
  id: string; code: string; name: string; category_id: string; category_name: string;
  account_code: string; account_name: string; is_active: boolean; is_available: boolean;
  is_used: boolean; aliases: string[];
}
export function parseExpenseTerms(value: unknown): ExpenseTerm[] {
  if (!Array.isArray(value) || !value.every((item: unknown) => {
    if (item === null || typeof item !== 'object') return false;
    const row = item as Record<string, unknown>;
    return ['id','code','name','category_id','category_name','account_code','account_name'].every(k => typeof row[k] === 'string')
      && ['is_active','is_available','is_used'].every(k => typeof row[k] === 'boolean')
      && Array.isArray(row.aliases) && row.aliases.every((alias: unknown) => typeof alias === 'string');
  })) throw new Error('Invalid expense terms response.');
  return value as ExpenseTerm[];
}
export function useExpenseTerms(includeInactive = false) {
  return useQuery({
    queryKey: ['expense-terms', includeInactive],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_expense_terms_v1', { p_include_inactive: includeInactive });
      if (error) throw new Error(error.message);
      return parseExpenseTerms(data);
    },
  });
}
export function useSaveExpenseTerm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id?: string; code: string; name: string; category_id: string; aliases: string[]; is_active: boolean }) => {
      const { error } = await supabase.rpc('save_expense_term_v1', {
        p_code: input.code.trim(), p_name: input.name.trim(), p_category_id: input.category_id,
        p_aliases: input.aliases, p_is_active: input.is_active,
        ...(input.id ? { p_term_id: input.id } : {}),
      });
      if (error) {
        const messages: Record<string, string> = {
          expense_term_in_use: 'This name and category are locked because the term has been used.',
          expense_term_category_unavailable: 'Select an active category with an available expense account.',
          expense_term_invalid_alias: 'Each synonym must contain between 1 and 120 characters.',
          expense_term_invalid_fields: 'Check the code, name and synonyms. A term supports up to 50 synonyms.',
        };
        throw new Error(error.code === '23505'
          ? 'This code, name or synonym already belongs to another expense term.'
          : messages[error.message] ?? error.message);
      }
    },
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['expense-terms'] }); },
  });
}
