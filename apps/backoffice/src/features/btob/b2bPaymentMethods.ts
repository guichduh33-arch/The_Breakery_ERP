// apps/backoffice/src/features/btob/b2bPaymentMethods.ts
//
// Moyens de règlement B2B — sous-ensemble MÉTIER de l'enum Postgres
// `payment_method` (`record_b2b_payment` prend `p_method payment_method`).
// Source unique de la modale d'enregistrement ET du filtre de la page
// Payments : le filtre oubliait `edc` et `store_credit`, que la modale
// enregistre (audit Sales 2026-11-21). `satisfies` casse le build si Postgres
// renomme ou retire une valeur.

import type { Database } from '@breakery/supabase';

type PaymentMethod = Database['public']['Enums']['payment_method'];

/** L'ordre de déclaration EST l'ordre d'affichage. */
export const B2B_PAYMENT_METHOD_LABEL = {
  cash:         'Cash',
  transfer:     'Bank transfer',
  qris:         'QRIS',
  card:         'Card',
  edc:          'EDC',
  store_credit: 'Store credit',
} as const satisfies Partial<Record<PaymentMethod, string>>;

export type B2bPaymentMethod = keyof typeof B2B_PAYMENT_METHOD_LABEL;

export const B2B_PAYMENT_METHODS = Object.keys(B2B_PAYMENT_METHOD_LABEL) as readonly B2bPaymentMethod[];

/** Libellé d'une méthode lue en base (un import historique peut porter une
 *  valeur d'enum hors du sous-ensemble B2B : elle reste nommée, jamais brute). */
export function b2bPaymentMethodLabel(method: string): string {
  return (B2B_PAYMENT_METHOD_LABEL as Record<string, string>)[method] ?? method.replace(/_/g, ' ');
}
