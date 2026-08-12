// apps/backoffice/src/features/orders/statusMeta.ts
//
// Libellés, tons et sémantique de règlement des commandes — source unique
// pour la liste, le détail et le tiroir (ADR-025 D3 : les statuts réels,
// nommés par leurs noms ; les libellés de fantaisie « New / Preparing /
// Ready » sont morts avec la refonte, le suivi de préparation appartient au
// KDS).
//
// TOUTES les maps sont des `Record<Enum, …>` typés sur les enums Postgres via
// la régénération de types : une valeur ajoutée en base CASSE LE BUILD dans
// chacune d'elles tant que l'interface ne la traite pas (review PR #367 —
// la promesse ne vaut que si aucune map ne s'en exempte).

import type { Database } from '@breakery/supabase';

export type OrderStatus   = Database['public']['Enums']['order_status'];
export type OrderType     = Database['public']['Enums']['order_type'];
export type PaymentMethod = Database['public']['Enums']['payment_method'];

export interface OrderStatusSpec {
  label: string;
  /** Gravité pour la bande de compteurs — jamais une catégorie. */
  tone?: 'warning' | 'danger';
}

/** L'ordre de déclaration EST l'ordre d'affichage de la bande. */
export const ORDER_STATUS: Record<OrderStatus, OrderStatusSpec> = {
  pending_payment: { label: 'Pending payment', tone: 'warning' },
  draft:           { label: 'Draft' },
  paid:            { label: 'Paid' },
  completed:       { label: 'Completed' },
  b2b_pending:     { label: 'B2B pending', tone: 'warning' },
  voided:          { label: 'Voided', tone: 'danger' },
};

/** Dérivé de la déclaration — jamais recopié (exhaustivité garantie). */
export const ORDER_STATUS_ORDER = Object.keys(ORDER_STATUS) as readonly OrderStatus[];

/** Classes du badge de statut en cellule — coins 3 px, label mono capitales. */
export const ORDER_STATUS_BADGE =
  'inline-flex rounded-sm px-1.5 py-0.5 font-data text-[10px] font-semibold uppercase tracking-widest';

export const ORDER_STATUS_BADGE_TONE: Record<OrderStatus, string> = {
  pending_payment: 'bg-warning-soft text-warning',
  b2b_pending:     'bg-warning-soft text-warning',
  paid:            'bg-success-soft text-success',
  completed:       'bg-success-soft text-success',
  voided:          'bg-danger-soft text-danger',
  draft:           'bg-surface-4 text-text-secondary',
};

const NEUTRAL_BADGE_TONE = 'bg-surface-4 text-text-secondary';

export function orderStatusLabel(status: string): string {
  return (ORDER_STATUS as Record<string, OrderStatusSpec>)[status]?.label ?? status;
}

export function orderStatusBadgeTone(status: string): string {
  return (ORDER_STATUS_BADGE_TONE as Record<string, string>)[status] ?? NEUTRAL_BADGE_TONE;
}

/**
 * RÉGLÉ au sens de l'ADR-025 D5 (amendée après review PR #367) : un statut qui
 * porte l'argent. Les règlements B2B n'écrivent jamais dans `order_payments`
 * (record_b2b_payment pose `status='paid'` seul), donc « il existe une ligne
 * de paiement » ne suffit JAMAIS seul — tout appelant compose :
 * `payments.length > 0 || isSettledStatus(status)`.
 */
export function isSettledStatus(status: string): boolean {
  return status === 'paid' || status === 'completed';
}

export const ORDER_TYPE_LABEL: Record<OrderType, string> = {
  dine_in:  'Dine in',
  take_out: 'Takeaway',
  delivery: 'Delivery',
  b2b:      'B2B',
};

export function orderTypeLabel(type: string): string {
  return (ORDER_TYPE_LABEL as Record<string, string>)[type] ?? type;
}

/** Libellés des moyens de paiement — l'enum entier, filtre compris. */
export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  cash:         'Cash',
  card:         'Card',
  qris:         'QRIS',
  edc:          'EDC',
  transfer:     'Transfer',
  store_credit: 'Store credit',
  gopay:        'GoPay',
  ovo:          'OVO',
  dana:         'DANA',
};

export const PAYMENT_METHODS = Object.keys(PAYMENT_METHOD_LABEL) as readonly PaymentMethod[];
export const ORDER_TYPES = Object.keys(ORDER_TYPE_LABEL) as readonly OrderType[];
