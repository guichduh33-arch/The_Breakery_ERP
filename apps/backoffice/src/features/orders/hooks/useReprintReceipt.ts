// apps/backoffice/src/features/orders/hooks/useReprintReceipt.ts
//
// Lot 6c — « Download receipt (PDF) » : un DUPLICATA du reçu de vente. Pas de
// bridge d'impression — on construit la charge via le builder de domaine
// (orderToReceiptPayload, IO-free), on la rend via l'EF generate-pdf (template
// `receipt`, gaté orders.reprint_receipt) et on ouvre le PDF signé.

import { useMutation } from '@tanstack/react-query';
import { orderToReceiptPayload } from '@breakery/domain';
import { useGeneratePdf } from '@/features/reports/hooks/useGeneratePdf.js';
import type { OrderDetail } from '@/features/orders/hooks/useOrderDetail.js';

export function useReprintReceipt() {
  const pdf = useGeneratePdf();
  const mut = useMutation<void, Error, OrderDetail>({
    mutationFn: async (order) => {
      const data = orderToReceiptPayload({
        order_number: order.order_number,
        created_at: order.created_at,
        order_type: order.order_type,
        cashier_name: order.served_by_name,
        customer_name: order.customer_name,
        table_number: order.table_number,
        subtotal: order.subtotal,
        discount_amount: order.discount_amount,
        tax_amount: order.tax_amount,
        total: order.total,
        items: order.items.map((it) => ({
          name: it.name_snapshot,
          quantity: it.quantity,
          unit_price: it.unit_price,
          line_total: it.line_total,
          is_cancelled: it.is_cancelled,
        })),
        payments: order.payments.map((p) => ({
          method: p.method,
          amount: p.amount,
          cash_received: p.cash_received,
          change_given: p.change_given,
        })),
        promotions: order.promotions.map((pr) => ({ description: pr.description, amount: pr.amount })),
      });
      const safe = order.order_number.replace(/[^A-Za-z0-9._-]/g, '-');
      const res = await pdf.mutateAsync({ template: 'receipt', data, filename: `receipt-${safe}` });
      if (typeof window !== 'undefined') window.open(res.signed_url, '_blank', 'noopener');
    },
  });
  return { reprint: mut.mutate, isPending: mut.isPending, error: mut.error };
}
