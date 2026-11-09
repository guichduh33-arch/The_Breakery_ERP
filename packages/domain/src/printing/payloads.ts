// packages/domain/src/printing/payloads.ts
// 2026-07-06 — print-bridge spec §4.1 : les shapes des payloads d'impression
// deviennent des types domain partagés POS ↔ bridge. Source historique :
// apps/pos/src/services/print/printService.ts (S34/S60), déplacée telle quelle.

import type { PaymentMethod, Tender } from '../types/payment.js';
import type { PrintKind, PrinterRole } from './types.js';

export interface PrinterTarget {
  ip_address: string;
  port: number;
}

export interface StationTicketItem {
  name: string;
  quantity: number;
  modifiers?: string[];
  note?: string;
  /**
   * S1-21 — montant de la ligne sur l'addition (`kind: 'bill'`), après sa
   * remise de ligne. Optionnel et additif : un pont plus ancien l'ignore et
   * imprime la ligne sans prix ; les tickets de préparation ne le portent pas.
   */
  line_total?: number;
}

/**
 * Totaux imprimés sous les lignes. `discount` et `tax_inclusive` sont des
 * ajouts S1-21, optionnels : un pont plus ancien ne lit que les trois premiers.
 * Lecture : Σ lignes − discount (+ tax si exclusive) = total.
 */
export interface StationTicketTotals {
  subtotal: number;
  tax: number;
  total: number;
  /** Promotions + points fidélité + remise panier ; absent ou 0 → non imprimé. */
  discount?: number;
  /** true : la taxe est incluse dans les prix (libellé « incl. »). */
  tax_inclusive?: boolean;
}

export interface StationTicketPayload {
  report_lines?: { label: string; amount: number }[];
  duplicate?: boolean;
  kind: PrintKind;
  role: PrinterRole;
  order_number: string;
  table_number?: string;
  created_at: string; // ISO
  server_name: string;
  items: StationTicketItem[];
  /** Spec A Bloc 4 — 2nd-phase append : le template rend un header "ADDITIONAL ORDER". */
  additional?: boolean;
  totals?: StationTicketTotals;
  payment?: { method: string; amount: number; change_given: number };
}

export interface ReceiptPayload {
  outstanding_due?: number;
  business: { name: string; address: string; phone?: string; tax_id?: string };
  order: {
    id?: string;
    order_number: string;
    created_at: string;
    cashier_name: string;
    order_type: 'dine_in' | 'take_out';
  };
  customer?: { name: string; loyalty_tier?: string };
  items: {
    name: string;
    quantity: number;
    unit_price: number;
    modifiers?: { label: string; price_adjustment: number }[];
    line_total: number;
  }[];
  totals: {
    items_total: number;
    redemption_amount: number;
    total: number;
    tax_amount: number;
    /** S60 — somme de promotions[].amount. Absent si aucune promo. */
    promotion_total?: number;
  };
  payments?: Tender[];
  payment: { method: PaymentMethod; amount: number; cash_received?: number; change_given?: number };
  loyalty?: { points_earned: number; balance_after?: number };
  /** S60 — lignes promo nommées, snapshot cartStore au succès checkout. */
  promotions?: { name: string; amount: number }[];
  footer?: string;
  /**
   * Settings §6.A — receipt template (receipt_templates.is_default) applied by
   * the POS. `header` = extra centered lines printed under the identity block
   * (multi-line via '\n'); `show_qr` prints a QR of the order number before the
   * cut. The effective footer travels in the existing `footer` field. Absent →
   * the bridge renders exactly as before (older POS builds stay compatible).
   */
  template?: { header?: string; show_qr?: boolean };
}
