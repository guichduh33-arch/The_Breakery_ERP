// packages/domain/src/printing/billPayload.ts
//
// S1-21 (décision propriétaire du 2026-11-09) — l'addition chiffrée imprimée
// AVANT paiement. Deux builders PURS (IO-free) vers le payload `kind: 'bill'` :
//
//   · cartToBillPayload  — panier de caisse, figures de `calculateTotals` à la
//     config taxe serveur. Montant de ligne = `lineTotalOf` − remise de ligne,
//     la formule même que `calculateTotals` facture.
//   · orderToBillPayload — commande persistée (tablette) : UNIQUEMENT les
//     montants stockés par le serveur, aucun recalcul de prix.
//
// Invariant imprimé, dans les deux cas :
//   Σ lignes = subtotal ; subtotal − discount (+ tax si exclusive) = total.

import type { Cart, CartItem, ComboComponent } from '../types/index.js';
import type { ModifierOption } from '../modifiers/types.js';
import { lineTotalOf } from '../cart/lineTotal.js';
import { calculateTotals } from '../cart/calculateTotals.js';
import { calculateDiscountAmount } from '../discounts/calculateDiscountAmount.js';
import type { StationTicketItem, StationTicketPayload } from './payloads.js';
import type { PrinterRole } from './types.js';

/** Les deux imprimantes de documents qui savent sortir une addition. */
export type BillPrinterRole = Extract<PrinterRole, 'cashier' | 'waiter'>;
export const BILL_PRINTER_ROLES: readonly BillPrinterRole[] = ['cashier', 'waiter'];

export interface BillMeta {
  role: BillPrinterRole;
  /** ISO — moment de l'impression. */
  created_at: string;
  server_name: string;
}

/** Les montants imprimés ne se recoupent pas avec le total stocké. */
export class BillReconciliationError extends Error {
  constructor(detail: string) {
    super(`bill_reconciliation_failed: ${detail}`);
    this.name = 'BillReconciliationError';
  }
}

/** Libellé de commande sans « # » trompeur. */
export function billOrderLabel(orderNumber: string | null | undefined, tableNumber: string | null | undefined): string {
  if (orderNumber) return `Order ${orderNumber}`;
  if (tableNumber) return `Table ${tableNumber}`;
  return 'Walk-in';
}

type LabeledOption = Pick<ModifierOption, 'option_label'>;
interface LabeledComponent {
  name?: ComboComponent['name'];
  modifiers?: readonly LabeledOption[];
}

function modifierLines(modifiers: readonly LabeledOption[], components: readonly LabeledComponent[]): string[] {
  return [
    ...modifiers.map((m) => m.option_label),
    ...components.flatMap((c) => {
      const name = c.name ?? 'Component';
      return [name, ...(c.modifiers ?? []).map((m) => `${name}: ${m.option_label}`)];
    }),
  ];
}

function billItem(name: string, quantity: number, lineTotal: number, mods: string[]): StationTicketItem {
  return { name, quantity, line_total: lineTotal, ...(mods.length > 0 ? { modifiers: mods } : {}) };
}

/** Montant imprimé d'une ligne de panier : total de ligne après sa remise de ligne. */
function cartLineAmount(item: CartItem): number {
  const gross = lineTotalOf(item);
  return gross - (item.discount ? calculateDiscountAmount(item.discount, gross) : 0);
}

/**
 * Addition d'un panier de caisse. `discount` = promotions + points fidélité +
 * remise panier, obtenu comme l'écart entre Σ lignes et la base taxable de
 * `calculateTotals` : l'addition ne peut donc pas diverger du montant encaissé.
 * Peut lever les erreurs de `calculateTotals` (remise > total).
 */
export function cartToBillPayload(
  cart: Cart,
  taxRate: number,
  taxInclusive: boolean,
  meta: BillMeta,
): StationTicketPayload {
  const live = cart.items.filter((item) => !item.is_cancelled);
  const items = live.map((item) =>
    billItem(item.name, item.quantity, cartLineAmount(item), modifierLines(item.modifiers, item.combo_components ?? [])),
  );
  const t = calculateTotals(cart, taxRate, taxInclusive);
  const taxable = taxInclusive ? t.total : t.total - t.tax_amount;
  const discount = t.subtotal - taxable;
  const tableNumber = cart.tableNumber ?? null;
  return {
    kind: 'bill',
    role: meta.role,
    order_number: billOrderLabel(null, tableNumber),
    ...(tableNumber ? { table_number: tableNumber } : {}),
    created_at: meta.created_at,
    server_name: meta.server_name,
    items,
    totals: {
      subtotal: t.subtotal,
      ...(discount > 0 ? { discount } : {}),
      tax: t.tax_amount,
      tax_inclusive: taxInclusive,
      total: t.total,
    },
  };
}

/** Ligne persistée (`order_items`), telle que lue par le client. */
export interface BillOrderItemInput {
  name: string;
  quantity: number;
  /** `order_items.line_total` — (unit_price + modificateurs) × qté, arrondi serveur. */
  line_total: number;
  /** `order_items.modifiers` (JSONB) — lu défensivement. */
  modifiers?: unknown;
  /** `order_items.combo_components` (JSONB) — lu défensivement. */
  combo_components?: unknown;
  is_cancelled?: boolean;
}

/** Commande persistée (`orders`), montants serveur. */
export interface BillOrderInput {
  order_number: string;
  table_number: string | null;
  subtotal: number;
  discount_amount: number;
  promotion_total: number;
  loyalty_redemption_amount: number;
  tax_amount: number;
  total: number;
  items: readonly BillOrderItemInput[];
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((v): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v))
    : [];
}

function parseModifiers(value: unknown): LabeledOption[] {
  return asRecordArray(value)
    .map((m) => m.option_label)
    .filter((label): label is string => typeof label === 'string' && label !== '')
    .map((option_label) => ({ option_label }));
}

function parseComponents(value: unknown): LabeledComponent[] {
  return asRecordArray(value).map((c) => ({
    ...(typeof c.name === 'string' && c.name !== '' ? { name: c.name } : {}),
    modifiers: parseModifiers(c.modifiers),
  }));
}

/** Comparaison au centime : les colonnes sont DECIMAL(14,2). */
const cents = (n: number): number => Math.round(Number(n) * 100);

/**
 * Addition d'une commande persistée, depuis les SEULS montants stockés.
 *
 * Sémantique serveur (corps live) : `order_items.line_total` =
 * round_idr((unit_price + modificateurs/unité) × qté) ; `orders.subtotal` =
 * Σ line_total des lignes non annulées (`_recalc_order_totals`,
 * `pay_existing_order`) ; `orders.total` = `_pb1_split_v1(subtotal − promo −
 * fidélité − remise)`. La remise de ligne `order_items.discount_amount` n'entre
 * pas dans `orders.subtotal` : le montant imprimé est donc `line_total`.
 *
 * Le mode taxe se déduit des montants (le seul qui recoupe le total), puis
 * tout écart lève `BillReconciliationError` : on n'imprime jamais une addition
 * dont les lignes ne mènent pas au total que la caisse encaissera.
 */
export function orderToBillPayload(order: BillOrderInput, meta: BillMeta): StationTicketPayload {
  const live = order.items.filter((item) => item.is_cancelled !== true);
  const items = live.map((item) =>
    billItem(item.name, Number(item.quantity), Number(item.line_total),
      modifierLines(parseModifiers(item.modifiers), parseComponents(item.combo_components))),
  );
  const linesSum = items.reduce((sum, item) => sum + cents(item.line_total ?? 0), 0);
  if (linesSum !== cents(order.subtotal)) {
    throw new BillReconciliationError('lines do not add up to the order subtotal');
  }
  const subtotal = Number(order.subtotal);
  const discount = Number(order.promotion_total) + Number(order.loyalty_redemption_amount) + Number(order.discount_amount);
  const tax = Number(order.tax_amount);
  const total = Number(order.total);
  const taxable = cents(subtotal) - cents(discount);
  let taxInclusive: boolean;
  if (taxable === cents(total)) taxInclusive = true;
  else if (taxable + cents(tax) === cents(total)) taxInclusive = false;
  else throw new BillReconciliationError('subtotal, discount and tax do not reach the order total');

  const tableNumber = order.table_number;
  return {
    kind: 'bill',
    role: meta.role,
    order_number: billOrderLabel(order.order_number, tableNumber),
    ...(tableNumber ? { table_number: tableNumber } : {}),
    created_at: meta.created_at,
    server_name: meta.server_name,
    items,
    totals: {
      subtotal,
      ...(discount > 0 ? { discount } : {}),
      tax,
      tax_inclusive: taxInclusive,
      total,
    },
  };
}
