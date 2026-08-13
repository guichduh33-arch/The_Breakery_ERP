// packages/domain/src/printing/orderToReceiptPayload.ts
//
// Lot 6c — builder PUR (IO-free) : d'une commande (lignes + paiements + totaux)
// vers la structure attendue par le template PDF `receipt` de generate-pdf.
//
// L'identité boutique (nom, adresse, NPWP) n'est PAS ici : l'EF generate-pdf
// l'injecte depuis business_config dans l'en-tête du PDF. Ce builder ne porte
// que les données propres à la commande.
//
// NON-PKP (ADR-005) : la PB1 est INCLUSE dans le prix. La pile se lit donc
//   Base (hors PB1) = subtotal − tax_amount ; PB1 (incluse) = tax_amount ;
//   Total (TTC) = total. Rien n'est recalculé — c'est un affichage.

export interface ReceiptOrderInput {
  order_number: string;
  /** ISO timestamp (created_at). */
  created_at: string;
  order_type: string;
  cashier_name: string | null;
  customer_name: string | null;
  table_number: string | null;
  subtotal: number;
  discount_amount: number;
  tax_amount: number;
  total: number;
  items: readonly {
    name: string;
    quantity: number;
    unit_price: number;
    line_total: number;
    is_cancelled?: boolean;
  }[];
  payments: readonly {
    method: string;
    amount: number;
    cash_received: number | null;
    change_given: number | null;
  }[];
  promotions?: readonly { description: string; amount: number }[];
}

export interface ReceiptPdfData {
  order: {
    order_number: string;
    date: string;
    order_type: string;
    cashier_name: string | null;
    customer_name: string | null;
    table_number: string | null;
  };
  items: {
    name: string;
    quantity: number;
    unit_price: number;
    line_total: number;
  }[];
  totals: {
    /** Base hors PB1 = subtotal − tax_amount. */
    base: number;
    discount: number;
    /** Somme des promotions ; absent si nulle. */
    promotion_total?: number;
    /** PB1 incluse. */
    tax: number;
    total: number;
  };
  payments: {
    method: string;
    amount: number;
    cash_received: number | null;
    change_given: number | null;
  }[];
}

/**
 * Transforme une commande en données de reçu pour le template PDF `receipt`.
 * Les lignes annulées sont exclues (jamais encaissées) ; les totaux viennent
 * des champs commande (déjà nets serveur), pas d'un recalcul client.
 */
export function orderToReceiptPayload(order: ReceiptOrderInput): ReceiptPdfData {
  const promotionTotal = (order.promotions ?? []).reduce((s, p) => s + Number(p.amount ?? 0), 0);

  return {
    order: {
      order_number: order.order_number,
      date: order.created_at,
      order_type: order.order_type,
      cashier_name: order.cashier_name,
      customer_name: order.customer_name,
      table_number: order.table_number,
    },
    items: order.items
      .filter((it) => it.is_cancelled !== true)
      .map((it) => ({
        name: it.name,
        quantity: Number(it.quantity),
        unit_price: Number(it.unit_price),
        line_total: Number(it.line_total),
      })),
    totals: {
      base: Number(order.subtotal) - Number(order.tax_amount),
      discount: Number(order.discount_amount),
      ...(promotionTotal > 0 ? { promotion_total: promotionTotal } : {}),
      tax: Number(order.tax_amount),
      total: Number(order.total),
    },
    payments: order.payments.map((p) => ({
      method: p.method,
      amount: Number(p.amount),
      cash_received: p.cash_received,
      change_given: p.change_given,
    })),
  };
}
