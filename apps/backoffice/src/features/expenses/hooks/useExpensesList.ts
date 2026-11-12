// apps/backoffice/src/features/expenses/hooks/useExpensesList.ts
//
// BO expenses list. Filterable by status, category, payment_method, date range,
// free-text search on description / vendor_name / expense_number.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { ilikeAnyFilter } from '@/lib/postgrestSearch.js';
import type { Database } from '@breakery/supabase';

export type ExpenseRow = Database['public']['Tables']['expenses']['Row'];
export type ExpenseCategoryRow = Database['public']['Tables']['expense_categories']['Row'];

export type ExpenseStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'paid';

export interface ExpensesListFilters {
  status?: ExpenseStatus | 'all';
  categoryId?: string;
  paymentMethod?: 'cash' | 'transfer' | 'card' | 'credit' | 'all';
  dateFrom?: string;
  dateTo?: string;
  search?: string;
}

export const EXPENSES_QUERY_KEY = ['expenses-bo'] as const;

/** Filtre `.or()` de la recherche dépenses (S1-13), `null` si rien à chercher. */
export function expenseSearchFilter(raw: string): string | null {
  return ilikeAnyFilter(['description', 'vendor_name', 'remarks', 'expense_number'], raw);
}

export function useExpensesList(filters: ExpensesListFilters = {}) {
  return useQuery<ExpenseRow[]>({
    queryKey: [...EXPENSES_QUERY_KEY, filters] as const,
    queryFn: async () => {
      let q = supabase
        .from('expenses')
        .select('*')
        .is('deleted_at', null)
        .order('expense_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(200);

      if (filters.status !== undefined && filters.status !== 'all') {
        q = q.eq('status', filters.status);
      }
      if (filters.categoryId !== undefined && filters.categoryId !== 'all') {
        q = q.eq('category_id', filters.categoryId);
      }
      if (filters.paymentMethod !== undefined && filters.paymentMethod !== 'all') {
        q = q.eq('payment_method', filters.paymentMethod);
      }
      if (filters.dateFrom !== undefined && filters.dateFrom !== '') {
        q = q.gte('expense_date', filters.dateFrom);
      }
      if (filters.dateTo !== undefined && filters.dateTo !== '') {
        q = q.lte('expense_date', filters.dateTo);
      }
      const search = expenseSearchFilter(filters.search ?? '');
      if (search !== null) q = q.or(search);

      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useExpenseCategories(includeInactive = false) {
  return useQuery<ExpenseCategoryRow[]>({
    queryKey: ['expense-categories', { includeInactive }] as const,
    queryFn: async () => {
      let query = supabase
        .from('expense_categories')
        .select('*');
      if (!includeInactive) query = query.eq('is_active', true);
      const { data, error } = await query.order('name', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 5 * 60 * 1000, // 5 min — categories rarely change.
  });
}
