// apps/pos/src/features/settings/hooks/useEnabledPaymentMethods.ts
//
// S64 (fiche 19 D2.1) — méthodes de paiement activées par le BO.
// Miroir du pattern useTaxConfig : SELECT direct business_config sous le JWT PIN,
// FAIL-OPEN (les 6 méthodes) pendant le chargement ou sur erreur/valeur invalide —
// une panne de config ne bloque JAMAIS un encaissement.
// « Effet immédiat » v1 : staleTime 30 s + refetchInterval 60 s + refetch on focus.
//
// ADR-006 déc. 9 (lot A) — l'ORDRE de l'array configuré est contractuel : c'est
// l'ordre d'affichage des grilles POS. Le Set retourné préserve l'ordre
// d'insertion (garantie JS) ; ne pas re-trier ici.

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { PaymentMethod } from '@breakery/domain';
import { supabase } from '@/lib/supabase';

// Lot B (ADR-006 déc. 9) : les e-wallets sont des valeurs VALIDES mais restent
// HORS du fail-open — en panne de config on ne propose jamais un tender que la
// boutique n'a peut-être pas (encaisser un GoPay sans compte GoPay = perte
// sèche) ; les 6 méthodes historiques suffisent à ne jamais bloquer la caisse.
export const ALL_PAYMENT_METHODS: readonly PaymentMethod[] = [
  'cash', 'card', 'qris', 'edc', 'transfer', 'store_credit', 'gopay', 'ovo', 'dana',
];
const VALID_SET: ReadonlySet<PaymentMethod> = new Set(ALL_PAYMENT_METHODS);
export const FAIL_OPEN_PAYMENT_METHODS: readonly PaymentMethod[] = [
  'cash', 'card', 'qris', 'edc', 'transfer', 'store_credit',
];
const FAIL_OPEN_SET: ReadonlySet<PaymentMethod> = new Set(FAIL_OPEN_PAYMENT_METHODS);
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
      if (!Array.isArray(raw)) return [...FAIL_OPEN_PAYMENT_METHODS];
      const valid = raw.filter(
        (m): m is PaymentMethod => typeof m === 'string' && (VALID_SET as Set<string>).has(m),
      );
      return valid.length > 0 ? valid : [...FAIL_OPEN_PAYMENT_METHODS];
    },
  });
  return useMemo(() => (data ? new Set<PaymentMethod>(data) : FAIL_OPEN_SET), [data]);
}
