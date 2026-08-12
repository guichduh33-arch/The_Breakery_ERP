// apps/backoffice/src/features/orders/statusMeta.ts
//
// Libellés et tons des statuts de commande — source unique pour la liste et
// le détail (ADR-025 D3 : les statuts réels, nommés par leurs noms ; les
// libellés de fantaisie « New / Preparing / Ready » sont morts avec la
// refonte, le suivi de préparation appartient au KDS).
//
// `Record<OrderStatus, …>` et non un tableau : le type vient de l'enum
// Postgres via la régénération de types — un statut ajouté en base CASSE LE
// BUILD ici tant que l'interface ne le traite pas.

import type { Database } from '@breakery/supabase';

export type OrderStatus = Database['public']['Enums']['order_status'];

export interface OrderStatusSpec {
  label: string;
  /** Gravité pour la bande de compteurs — jamais une catégorie. */
  tone?: 'warning' | 'danger' | 'success';
}

export const ORDER_STATUS: Record<OrderStatus, OrderStatusSpec> = {
  pending_payment: { label: 'Pending payment', tone: 'warning' },
  draft:           { label: 'Draft' },
  paid:            { label: 'Paid', tone: 'success' },
  completed:       { label: 'Completed', tone: 'success' },
  b2b_pending:     { label: 'B2B pending', tone: 'warning' },
  voided:          { label: 'Voided', tone: 'danger' },
};

/** Ordre d'affichage de la bande — du plus pressant au clos. */
export const ORDER_STATUS_ORDER: readonly OrderStatus[] = [
  'pending_payment', 'draft', 'paid', 'completed', 'b2b_pending', 'voided',
];

/** Classes du badge de statut en cellule — coins 3 px, label mono capitales. */
export const ORDER_STATUS_BADGE =
  'inline-flex rounded-sm px-1.5 py-0.5 font-data text-[10px] font-semibold uppercase tracking-widest';

export const ORDER_STATUS_BADGE_TONE: Record<string, string> = {
  pending_payment: 'bg-warning-soft text-warning',
  b2b_pending:     'bg-warning-soft text-warning',
  paid:            'bg-success-soft text-success',
  completed:       'bg-success-soft text-success',
  voided:          'bg-danger-soft text-danger',
  draft:           'bg-surface-4 text-text-secondary',
};

export function orderStatusLabel(status: string): string {
  return (ORDER_STATUS as Record<string, OrderStatusSpec>)[status]?.label ?? status;
}

export const ORDER_TYPE_LABEL: Record<string, string> = {
  dine_in:  'Dine in',
  take_out: 'Takeaway',
  delivery: 'Delivery',
  b2b:      'B2B',
};
