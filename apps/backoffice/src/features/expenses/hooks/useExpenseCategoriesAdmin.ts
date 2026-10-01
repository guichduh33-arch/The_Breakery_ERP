import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

// Contrat local temporaire : types.generated reste intact jusqu'à application
// des migrations 20260930000004/5 et régénération depuis la base.
export interface ExpenseCategoryAdmin {
  id: string;
  code: string;
  name: string;
  description: string | null;
  account_id: string;
  account_code: string;
  account_name: string;
  is_active: boolean;
  is_used: boolean;
}
export interface ExpenseAccount { id: string; code: string; name: string }
export interface ExpenseCategoriesAdminData {
  categories: ExpenseCategoryAdmin[];
  accounts: ExpenseAccount[];
}
export interface ExpenseCategoryFields {
  name: string;
  account_id: string;
  description: string | null;
  is_active: boolean;
}
type CategoryRpc = 'get_expense_categories_admin_v1' | 'create_expense_category_v1' | 'update_expense_category_v1';
const rpc = supabase.rpc.bind(supabase) as unknown as (
  name: CategoryRpc, args?: Record<string, string | boolean | null>,
) => Promise<{ data: unknown; error: { message: string } | null }>;
export const EXPENSE_CATEGORIES_ADMIN_KEY = ['expense-categories-admin'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function parseExpenseCategories(value: unknown): ExpenseCategoriesAdminData {
  if (!isRecord(value) || !Array.isArray(value.categories) || !Array.isArray(value.accounts)) {
    throw new Error('Invalid expense categories response.');
  }
  const accountFields = ['id', 'code', 'name'];
  const categoryFields = [...accountFields, 'account_id', 'account_code', 'account_name'];
  if (!value.accounts.every((a: unknown) => isRecord(a) && accountFields.every((k) => typeof a[k] === 'string')) ||
      !value.categories.every((c: unknown) => isRecord(c) && categoryFields.every((k) => typeof c[k] === 'string') &&
        (c.description === null || typeof c.description === 'string') &&
        typeof c.is_active === 'boolean' && typeof c.is_used === 'boolean')) {
    throw new Error('Invalid expense categories response.');
  }
  return value as unknown as ExpenseCategoriesAdminData;
}
export function useExpenseCategoriesAdmin() {
  return useQuery({
    queryKey: EXPENSE_CATEGORIES_ADMIN_KEY,
    queryFn: async () => {
      const { data, error } = await rpc('get_expense_categories_admin_v1');
      if (error) throw new Error(error.message);
      return parseExpenseCategories(data);
    },
  });
}
export function useSaveExpenseCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ExpenseCategoryFields & ({ id: string } | { code: string })) => {
      const args = {
        p_name: input.name, p_description: input.description,
        p_account_id: input.account_id, p_is_active: input.is_active,
      };
      const { error } = 'id' in input
        ? await rpc('update_expense_category_v1', { ...args, p_category_id: input.id })
        : await rpc('create_expense_category_v1', { ...args, p_code: input.code });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: EXPENSE_CATEGORIES_ADMIN_KEY }),
        qc.invalidateQueries({ queryKey: ['expense-categories'] }),
      ]);
    },
  });
}
