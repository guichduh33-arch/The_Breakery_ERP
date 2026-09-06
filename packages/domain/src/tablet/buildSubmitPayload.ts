import type { SelectedModifiers } from '../modifiers/types.js';
import type { ComboComponent } from '../types/index.js';
import type { TabletCart } from './types.js';

export interface TabletSubmitPayload {
  p_waiter_id: string;
  p_table_number: string | null;
  p_order_type: 'dine_in' | 'take_out';
  p_items: {
    product_id: string;
    quantity: number;
    unit_price: number;
    modifiers: SelectedModifiers;
    /**
     * Lot D (2026-09-05) — composition choisie d'une ligne combo. Sans cette
     * clé, un combo tapé sur la tablette arrivait au serveur comme un produit
     * nu : `create_tablet_order` ne pouvait ni résoudre le prix serveur
     * (`_resolve_combo_price_v1` : base + surcharges + ajustements des
     * modificateurs de composants) ni déduire le stock des composants. Même
     * forme de wire que le comptoir (`useFireToStations`), et absente des
     * lignes hors combo.
     */
    combo_components?: ComboComponent[];
  }[];
  /** Session 59 (17 D1.1) — order-level free-text note, forwarded as p_notes. */
  p_notes: string | null;
}

export function buildSubmitPayload(
  cart: TabletCart,
  waiterId: string,
): TabletSubmitPayload {
  return {
    p_waiter_id: waiterId,
    p_table_number: cart.tableNumber,
    p_order_type: cart.orderType,
    p_items: cart.items.map((i) => ({
      product_id: i.product_id,
      quantity: i.quantity,
      unit_price: i.unit_price,
      modifiers: i.modifiers,
      ...(i.combo_components ? { combo_components: i.combo_components } : {}),
    })),
    p_notes: cart.notes ?? null,
  };
}
