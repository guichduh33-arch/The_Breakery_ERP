// apps/backoffice/src/features/loyalty/hooks/useCreateCustomer.ts
// ADR-020 déc. 2 (2026-08-03) — l'INSERT direct est mort : le GRANT colonne de
// `authenticated` est retiré et la policy permissive `auth_insert_retail`
// supprimée. La création passe par `create_customer_v3`, gatée sur
// `customers.create` et auditée. La catégorie par défaut est affectée serveur.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { CustomerFormValues } from '@breakery/ui';
import { supabase } from '@/lib/supabase.js';
import { LOYALTY_CUSTOMERS_QUERY_KEY } from './useLoyaltyCustomersList.js';

export function useCreateCustomer() {
  const qc = useQueryClient();
  return useMutation<void, Error, CustomerFormValues>({
    mutationFn: async (values) => {
      const { error } = await supabase.rpc('create_customer_v3', {
        p_name:          values.name,
        // Le formulaire rend `null` pour un champ vide et la RPC déclare ses
        // arguments optionnels ; sous `exactOptionalPropertyTypes`, passer
        // `undefined` est refusé — il faut OMETTRE la clé. Même patron que
        // useUpdateOrderItemQty. Côté serveur, absent et vide sont équivalents.
        ...(values.phone ? { p_phone: values.phone } : {}),
        ...(values.email ? { p_email: values.email } : {}),
        p_customer_type: 'retail',
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: LOYALTY_CUSTOMERS_QUERY_KEY });
    },
  });
}
