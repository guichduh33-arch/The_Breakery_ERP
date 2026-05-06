// apps/pos/src/features/customers/hooks/useCreateCustomer.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Customer } from '@breakery/domain';

interface CreateCustomerInput {
  name: string;
  phone: string;
  email?: string;
}

async function resolveDefaultCategoryId(): Promise<string | null> {
  const { data } = await supabase
    .from('customer_categories')
    .select('id')
    .eq('is_default', true)
    .is('deleted_at', null)
    .limit(1)
    .single();
  return data?.id ?? null;
}

export function useCreateCustomer() {
  const queryClient = useQueryClient();

  return useMutation<Customer, Error, CreateCustomerInput>({
    mutationFn: async (input) => {
      const defaultCategoryId = await resolveDefaultCategoryId();
      const { data, error } = await supabase
        .from('customers')
        .insert({
          name: input.name,
          phone: input.phone,
          email: input.email ?? null,
          customer_type: 'retail',
          ...(defaultCategoryId ? { category_id: defaultCategoryId } : {}),
        })
        .select('id, name, phone, email, customer_type, loyalty_points, lifetime_points, total_spent, total_visits, last_visit_at')
        .single();
      if (error) throw error;
      return data as Customer;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['customers'] });
    },
  });
}
