// apps/backoffice/src/features/inventory/hooks/useRecordDirectPurchase.ts
//
// "Direct purchase" — an accounted stock purchase entered without first
// drafting a Purchase Order. Unlike record_incoming_stock_v1 (movement_type
// 'incoming', which does NOT feed WAC and posts NO journal entry), this routes
// through the battle-tested Purchasing money-path so the purchase is fully
// integrated:
//   1. create_purchase_order_v2  → a 1-line PO (payment_terms='credit')
//   2. receive_purchase_order_v2 → GRN ⇒ DR Inventory / CR Purchase Payable JE
//                                  + movement_type='purchase' (WAC + price trend)
//   3. record_po_payment_v1      → DR Payable / CR Cash|Bank JE (only when paid)
//
// Each step is idempotent (deterministic sub-keys derived from one base key) so
// a retry after a partial failure re-uses the same PO/GRN/payment.
//
// Accounting note: receive_purchase_order_v2 hardcodes received_date=current_date
// and the payment posts paid_at=now(), so the JEs land on TODAY. The user's
// chosen purchase date is stored on the PO (order_date) and echoed in the
// payment reference; back-dating the JE itself would require an RPC bump.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { STOCK_LEVELS_QUERY_KEY } from './useStockLevels.js';
import { STOCK_LEDGER_KEY } from '@/features/inventory-movements/hooks/useStockLedger.js';

export type DirectPurchasePaymentMethod = 'cash' | 'transfer';

export interface DirectPurchaseArgs {
  supplierId:        string;
  productId:         string;
  /** Quantity expressed in the chosen purchase unit. */
  quantity:          number;
  /** Purchase unit code (base unit or an alternative). */
  unit:              string;
  /** Conversion factor of the purchase unit to the product base unit. */
  unitFactorToBase:  number;
  /** Price per purchase unit (supplier price). */
  pricePerUnit:      number;
  /** Section the stock lands in (warehouse / kitchen). */
  sectionId:         string;
  /** Purchase date (YYYY-MM-DD) — stored as PO order_date. */
  purchaseDate:      string;
  /** Omit / null when the purchase is left unpaid (on credit). */
  paymentMethod:     DirectPurchasePaymentMethod | null;
  /** Amount paid now (0 when unpaid). */
  paymentAmount:     number;
  /** Payment date (YYYY-MM-DD) — echoed in the payment reference. */
  paymentDate:       string;
  notes?:            string;
  /** Base idempotency key — rotate per submit, reused on retry. */
  idempotencyKey:    string;
}

export interface DirectPurchaseResult {
  poId:        string;
  poNumber:    string;
  grnId:       string;
  grnNumber:   string;
  total:       number;
  paymentId:   string | null;
}

export class DirectPurchaseError extends Error {
  constructor(public step: 'create' | 'lookup' | 'receive' | 'payment', message: string) {
    super(message);
    this.name = 'DirectPurchaseError';
  }
}

// Derive a stable UUID-shaped sub-key from the base key + a step tag. We avoid a
// crypto dependency: the base key is already a v4 UUID; XOR-ing in a short tag
// keeps it UUID-shaped and deterministic per (submit, step).
function subKey(base: string, tag: string): string {
  const hex = base.replace(/-/g, '');
  const tagSum = [...tag].reduce((s, c) => s + c.charCodeAt(0), 0) % 16;
  const flipped = (parseInt(hex[0] ?? '0', 16) ^ tagSum).toString(16);
  const mutated = flipped + hex.slice(1);
  return [
    mutated.slice(0, 8), mutated.slice(8, 12), mutated.slice(12, 16),
    mutated.slice(16, 20), mutated.slice(20, 32),
  ].join('-');
}

type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;

export function useRecordDirectPurchase() {
  const qc = useQueryClient();
  return useMutation<DirectPurchaseResult, DirectPurchaseError, DirectPurchaseArgs>({
    mutationFn: async (args) => {
      const rpc = supabase.rpc.bind(supabase) as unknown as Rpc;

      // ── 1. Create the 1-line PO (credit terms → we control the payment) ──────
      const createRes = await rpc('create_purchase_order_v2', {
        p_supplier_id: args.supplierId,
        p_items: [{
          product_id:          args.productId,
          quantity:            args.quantity,
          unit:                args.unit,
          unit_factor_to_base: args.unitFactorToBase,
          unit_cost:           args.pricePerUnit,
        }],
        p_order_date:      args.purchaseDate,
        p_payment_terms:   'credit',
        p_vat_rate:        0,
        p_notes:           args.notes ?? 'Direct purchase',
        p_idempotency_key: subKey(args.idempotencyKey, 'create'),
      });
      if (createRes.error !== null) throw new DirectPurchaseError('create', createRes.error.message);
      const po = createRes.data as { po_id: string; po_number: string; total_amount: number };

      // ── 2. Look up the PO line id (needed by receive) ────────────────────────
      const { data: lineRows, error: lineErr } = await supabase
        .from('purchase_order_items')
        .select('id')
        .eq('po_id', po.po_id)
        .limit(1);
      if (lineErr !== null) throw new DirectPurchaseError('lookup', lineErr.message);
      const poItemId = lineRows?.[0]?.id as string | undefined;
      if (poItemId === undefined) throw new DirectPurchaseError('lookup', 'PO line not found after create');

      // ── 3. Receive → GRN (DR Inventory / CR Payable JE) + purchase movement ──
      const recvRes = await rpc('receive_purchase_order_v2', {
        p_po_id:       po.po_id,
        p_section_id:  args.sectionId,
        p_received_items: [{ po_item_id: poItemId, received_quantity: args.quantity }],
        p_idempotency_key: subKey(args.idempotencyKey, 'receive'),
      });
      if (recvRes.error !== null) throw new DirectPurchaseError('receive', recvRes.error.message);
      const grn = recvRes.data as { grn_id: string; grn_number: string };

      // ── 4. Record the payment (only when paid now) ───────────────────────────
      let paymentId: string | null = null;
      if (args.paymentMethod !== null && args.paymentAmount > 0) {
        const payRes = await rpc('record_po_payment_v1', {
          p_po_id:           po.po_id,
          p_amount:          args.paymentAmount,
          p_method:          args.paymentMethod,
          p_reference:       `Direct purchase ${args.purchaseDate} · paid ${args.paymentDate}`,
          p_idempotency_key: subKey(args.idempotencyKey, 'payment'),
        });
        if (payRes.error !== null) throw new DirectPurchaseError('payment', payRes.error.message);
        paymentId = (payRes.data as { payment_id: string }).payment_id;
      }

      return {
        poId:      po.po_id,
        poNumber:  po.po_number,
        grnId:     grn.grn_id,
        grnNumber: grn.grn_number,
        total:     Number(po.total_amount),
        paymentId,
      };
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: STOCK_LEVELS_QUERY_KEY }),
        qc.invalidateQueries({ queryKey: STOCK_LEDGER_KEY }),
        qc.invalidateQueries({ queryKey: ['product-dashboard'] }),
        qc.invalidateQueries({ queryKey: ['product-analytics'] }),
        qc.invalidateQueries({ queryKey: ['purchase-orders'] }),
      ]);
    },
  });
}
