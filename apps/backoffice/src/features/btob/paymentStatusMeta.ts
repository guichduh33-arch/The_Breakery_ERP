// apps/backoffice/src/features/btob/paymentStatusMeta.ts
//
// Lot 3 B2B (feat/b2b-dashboard-orders-archetype) — l'état de règlement d'une
// facture B2B avait QUATRE recettes de badge (chip artisanal de la liste,
// statusBadge() de l'onglet Invoices, pastille du modal de règlement, Badge
// générique). Une seule source désormais, sur le moule de
// `features/orders/statusMeta.ts` (classes constantes + Record de tons).
//
// Contrairement aux statuts de commande, l'état de règlement N'EST PAS un enum
// Postgres : il se dérive de l'argent (`outstanding` / `amount_paid`). La
// dérivation vit ici pour ne pas se réécrire différemment à chaque surface.

export type B2bSettlement = 'paid' | 'partial' | 'unpaid';

/** Classes du badge de règlement — mêmes coins 3 px et label mono que le badge de statut. */
export const B2B_SETTLEMENT_BADGE =
  'inline-flex rounded-sm px-1.5 py-0.5 font-data text-[10px] font-semibold uppercase tracking-widest';

export const B2B_SETTLEMENT_TONE: Record<B2bSettlement, string> = {
  paid:    'bg-success-soft text-success',
  partial: 'bg-warning-soft text-warning',
  unpaid:  'bg-danger-soft text-danger',
};

export const B2B_SETTLEMENT_LABEL: Record<B2bSettlement, string> = {
  paid:    'paid',
  partial: 'partial',
  unpaid:  'unpaid',
};

/** L'état de règlement dérivé de l'argent — la seule définition. */
export function settlementOf(outstanding: number, amountPaid: number): B2bSettlement {
  if (outstanding === 0) return 'paid';
  if (amountPaid > 0) return 'partial';
  return 'unpaid';
}
