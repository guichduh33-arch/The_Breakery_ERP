// apps/backoffice/src/features/expenses/hooks/useExpensesList.ts
//
// BO expenses list. Filterable by status, category, payment_method, date range,
// free-text search on description / vendor_name / expense_number.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import type { Database } from '@breakery/supabase';

export type ExpenseRow = Database['public']['Tables']['expenses']['Row'];
export type ExpenseCategoryRow = Database['public']['Tables']['expense_categories']['Row'];

export type ExpenseStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'paid';

export interface ExpensesListFilters {
  status?: ExpenseStatus | 'all';
  categoryId?: string | 'all';
  paymentMethod?: 'cash' | 'transfer' | 'card' | 'credit' | 'all';
  dateFrom?: string;
  dateTo?: string;
  search?: string;
}

export const EXPENSES_QUERY_KEY = ['expenses-bo'] as const;

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
      if (filters.search !== undefined && filters.search.trim() !== '') {
        const term = filters.search.trim().replace(/[%_]/g, '\\$&');
        q = q.or(`description.ilike.%${term}%,vendor_name.ilike.%${term}%,expense_number.ilike.%${term}%`);
      }

      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useExpenseCategories() {
  return useQuery<ExpenseCategoryRow[]>({
    queryKey: ['expense-categories'] as const,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('expense_categories')
        .select('*')
        .eq('is_active', true)
        .order('name', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 5 * 60 * 1000, // 5 min — categories rarely change.
  });
}
