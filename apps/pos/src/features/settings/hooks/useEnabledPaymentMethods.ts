// apps/pos/src/features/settings/hooks/useEnabledPaymentMethods.ts
//
// S64 (fiche 19 D2.1) — méthodes de paiement activées par le BO.
// Miroir du pattern useTaxRate : SELECT direct business_config sous le JWT PIN,
// FAIL-OPEN (les 6 méthodes) pendant le chargement ou sur erreur/valeur invalide —
// une panne de config ne bloque JAMAIS un encaissement.
// « Effet immédiat » v1 : staleTime 30 s + refetchInterval 60 s + refetch on focus.

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { PaymentMethod } from '@breakery/domain';
import { supabase } from '@/lib/supabase';

export const ALL_PAYMENT_METHODS: readonly PaymentMethod[] = [
  'cash', 'card', 'qris', 'edc', 'transfer', 'store_credit',
];
const ALL_SET: ReadonlySet<PaymentMethod> = new Set(ALL_PAYMENT_METHODS);
const QUERY_KEY = ['business-config', 'enabled-payment-methods'] as const;

export function useEnabledPaymentMethods(): ReadonlySet<PaymentMethod> {
  const { data } = useQuery({
    queryKey: QUERY_KEY,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<PaymentMethod[]> => {
      const { data, error } = await supabase
        .from('business_config')
        .select('enabled_payment_methods')
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      const raw = data?.enabled_payment_methods;
      if (!Array.isArray(raw)) return [...ALL_PAYMENT_METHODS];
      const valid = raw.filter(
        (m): m is PaymentMethod => typeof m === 'string' && (ALL_SET as Set<string>).has(m),
      );
      return valid.length > 0 ? valid : [...ALL_PAYMENT_METHODS];
    },
  });
  return useMemo(() => (data ? new Set<PaymentMethod>(data) : ALL_SET), [data]);
}
