// S1-21 — addition chiffrée depuis la tablette serveur, avant paiement.
// Les montants viennent de la commande PERSISTÉE (prix serveur), relus au
// moment de l'impression, puis passés au builder pur `orderToBillPayload`.
// Hors ligne : rien n'est mis en file (l'addition doit refléter la base).
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { orderToBillPayload, type BillOrderInput, type BillPrinterRole } from '@breakery/domain';
import type { Database } from '@breakery/supabase';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { runPrintJob } from '@/services/print/printJobs';
import { getStationPrinters } from '@/features/cart/hooks/useStationPrinters';

type OrderStatus = Database['public']['Enums']['order_status'];

/** Statuts d'une commande encore ouverte (ni payée, ni annulée, ni clôturée),
 *  typés contre l'enum Postgres. */
const OPEN_BILL_STATUSES: readonly OrderStatus[] = ['draft', 'pending_payment'];

export function isOpenForBill(status: string): boolean {
  return (OPEN_BILL_STATUSES as readonly string[]).includes(status);
}

const BILL_ORDER_SELECT =
  'order_number, table_number, status, subtotal, discount_amount, promotion_total, loyalty_redemption_amount, tax_amount, total, '
  + 'order_items(name_snapshot, quantity, line_total, modifiers, combo_components, is_cancelled)';

/** Lit les montants serveur d'une commande ouverte. */
export async function fetchTabletBillOrder(orderId: string): Promise<BillOrderInput> {
  const { data, error } = await supabase.from('orders').select(BILL_ORDER_SELECT).eq('id', orderId).single();
  if (error) throw new Error(error.message);
  const row = data as unknown as Omit<BillOrderInput, 'items'> & {
    status: string;
    order_items: { name_snapshot: string; quantity: number; line_total: number; modifiers: unknown;
      combo_components: unknown; is_cancelled: boolean }[] | null;
  };
  if (!isOpenForBill(row.status)) throw new Error('order_not_open');
  return {
    order_number: row.order_number,
    table_number: row.table_number,
    subtotal: row.subtotal,
    discount_amount: row.discount_amount,
    promotion_total: row.promotion_total,
    loyalty_redemption_amount: row.loyalty_redemption_amount,
    tax_amount: row.tax_amount,
    total: row.total,
    items: (row.order_items ?? []).map((item) => ({
      name: item.name_snapshot,
      quantity: item.quantity,
      line_total: item.line_total,
      modifiers: item.modifiers,
      combo_components: item.combo_components,
      is_cancelled: item.is_cancelled,
    })),
  };
}

export interface PrintTabletBillInput {
  orderId: string;
  role: BillPrinterRole;
}

export function usePrintTabletBill() {
  const qc = useQueryClient();
  const serverName = useAuthStore((s) => s.user?.full_name ?? 'Staff');

  return useMutation<void, Error, PrintTabletBillInput>({
    mutationFn: async ({ orderId, role }) => {
      const printers = await getStationPrinters(qc);
      const printer = printers.get(role);
      if (!printer) throw new Error(`no_${role}_printer`);
      const order = await fetchTabletBillOrder(orderId);
      const payload = orderToBillPayload(order, { role, created_at: new Date().toISOString(), server_name: serverName });
      // Un id neuf par geste : une addition se réimprime à volonté.
      const result = await runPrintJob(payload, printer);
      if (!result.success) throw new Error(result.error ?? 'print_failed');
    },
  });
}
