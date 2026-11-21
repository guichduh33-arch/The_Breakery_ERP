// apps/backoffice/src/features/promotions/promotionSummary.ts
//
// Lecture d'une promotion pour la liste du BO (audit Sales 2026-11-21) :
// libellés de type dérivés de l'enum Postgres, valeur lisible (« 15% »,
// « Rp 10.000 », « Buy 2 get 1 »), fenêtre de dates et son état, compteurs.
// Fonctions PURES (l'horloge est un argument) : testables, et réutilisables
// quand la bande de tuiles migrera vers ListCounterStrip.

import type { Database } from '@breakery/supabase';
import { formatCurrency, formatDateTimeShortWita } from '@breakery/utils';
import type { PromotionListRow } from './hooks/usePromotionsList.js';

export type PromotionTypeEnum = Database['public']['Enums']['promotion_type'];

/** `Record` exhaustif : une valeur ajoutée à l'enum casse le build ici. */
export const PROMOTION_TYPE_LABEL: Record<PromotionTypeEnum, string> = {
  percentage:   'Percentage',
  fixed_amount: 'Fixed amount',
  bogo:         'BOGO',
  free_product: 'Free product',
  threshold:    'Spend threshold',
  bundle:       'Bundle',
};

export const PROMOTION_TYPES = Object.keys(PROMOTION_TYPE_LABEL) as readonly PromotionTypeEnum[];

export function isPromotionType(v: string): v is PromotionTypeEnum {
  return Object.hasOwn(PROMOTION_TYPE_LABEL, v);
}

type ValueFacts = Pick<PromotionListRow,
  | 'type' | 'discount_value' | 'max_discount_amount'
  | 'bogo_buy_quantity' | 'bogo_get_quantity'
  | 'bogo_trigger_qty' | 'bogo_reward_qty' | 'bogo_reward_discount_pct'
  | 'threshold_amount' | 'threshold_type' | 'bundle_price' | 'gift_qty'>;

const pct = (n: number): string => `${n.toLocaleString('id-ID')}%`;
/** Une ligne partielle (colonne absente) ne doit jamais faire tomber la liste. */
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Ce que la promotion donne, en une expression courte. `—` si incomplète. */
export function promotionValueText(p: ValueFacts): string {
  switch (p.type) {
    case 'percentage':
      if (!num(p.discount_value)) return '—';
      return num(p.max_discount_amount)
        ? `${pct(p.discount_value)} (max ${formatCurrency(p.max_discount_amount)})`
        : pct(p.discount_value);
    case 'fixed_amount':
      return !num(p.discount_value) ? '—' : `${formatCurrency(p.discount_value)} off`;
    case 'bogo':
      // Forme « nouvelle » (S13) prioritaire, sinon forme historique (S9).
      if (num(p.bogo_buy_quantity) && num(p.bogo_get_quantity)) {
        return `Buy ${p.bogo_buy_quantity} get ${p.bogo_get_quantity}`;
      }
      if (num(p.bogo_trigger_qty) && num(p.bogo_reward_qty)) {
        return !num(p.bogo_reward_discount_pct) || p.bogo_reward_discount_pct >= 100
          ? `Buy ${p.bogo_trigger_qty} get ${p.bogo_reward_qty}`
          : `Buy ${p.bogo_trigger_qty}, ${pct(p.bogo_reward_discount_pct)} off ${p.bogo_reward_qty}`;
      }
      return '—';
    case 'free_product':
      return num(p.gift_qty) && p.gift_qty > 1 ? `Free product ×${p.gift_qty}` : 'Free product';
    case 'threshold': {
      if (!num(p.discount_value) || !num(p.threshold_amount)) return '—';
      // Règle du serveur : un plafond renseigné ⇒ remise en pourcentage.
      const off = num(p.max_discount_amount) ? pct(p.discount_value) : formatCurrency(p.discount_value);
      const from = p.threshold_type === 'quantity'
        ? `${p.threshold_amount.toLocaleString('id-ID')} items`
        : formatCurrency(p.threshold_amount);
      return `${off} off from ${from}`;
    }
    case 'bundle':
      return !num(p.bundle_price) ? '—' : `Bundle at ${formatCurrency(p.bundle_price)}`;
    default:
      return '—';
  }
}

export type PromotionWindowState = 'scheduled' | 'live' | 'expired' | 'always';

export const PROMOTION_WINDOW_LABEL: Record<PromotionWindowState, string> = {
  scheduled: 'Scheduled',
  live:      'Live',
  expired:   'Expired',
  always:    'Always',
};

type WindowFacts = Pick<PromotionListRow, 'start_at' | 'end_at'>;

function ts(v: string | null): number | null {
  if (v === null || v === '') return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

/** État de la fenêtre de DATES seule (jours et heures non évalués ici). */
export function promotionWindowState(p: WindowFacts, now: number): PromotionWindowState {
  const start = ts(p.start_at);
  const end = ts(p.end_at);
  if (start === null && end === null) return 'always';
  if (start !== null && start > now) return 'scheduled';
  if (end !== null && end <= now) return 'expired';
  return 'live';
}

/** Plage lisible : « 01 Dec 2026, 08:00 → 31 Dec 2026, 22:00 », bornes ouvertes nommées. */
export function promotionWindowText(p: WindowFacts): string {
  const start = ts(p.start_at);
  const end = ts(p.end_at);
  if (start === null && end === null) return 'No dates';
  const from = start === null ? 'Any time' : formatDateTimeShortWita(new Date(start));
  const to = end === null ? 'no end date' : formatDateTimeShortWita(new Date(end));
  return `${from} → ${to}`;
}

/** Phrase de confirmation d'activation : à partir de quand, jusqu'à quand. */
export function activationSentence(p: WindowFacts, now: number): string {
  const state = promotionWindowState(p, now);
  const end = ts(p.end_at);
  const until = end === null ? 'no end date' : formatDateTimeShortWita(new Date(end));
  if (state === 'expired') {
    return `Its end date (${until}) has passed: it will not apply at the POS until you change its dates.`;
  }
  const start = ts(p.start_at);
  const from = state === 'scheduled' && start !== null ? formatDateTimeShortWita(new Date(start)) : 'now';
  return `Applies at the POS from ${from} until ${until}.`;
}

export interface PromotionCounts {
  total:     number;
  /** Active ET dans sa fenêtre de dates. */
  liveNow:   number;
  scheduled: number;
  bogo:      number;
  discount:  number;
}

/**
 * Compteurs de la bande — calculés sur TOUTES les promotions non supprimées,
 * jamais sur le résultat du filtre de table.
 */
export function summarisePromotions(
  rows: readonly Pick<PromotionListRow, 'type' | 'is_active' | 'start_at' | 'end_at'>[],
  now: number,
): PromotionCounts {
  let liveNow = 0;
  let scheduled = 0;
  let bogo = 0;
  let discount = 0;
  for (const r of rows) {
    const state = promotionWindowState(r, now);
    if (r.is_active && (state === 'live' || state === 'always')) liveNow += 1;
    if (r.is_active && state === 'scheduled') scheduled += 1;
    if (r.type === 'bogo') bogo += 1;
    if (r.type === 'percentage' || r.type === 'fixed_amount') discount += 1;
  }
  return { total: rows.length, liveNow, scheduled, bogo, discount };
}
