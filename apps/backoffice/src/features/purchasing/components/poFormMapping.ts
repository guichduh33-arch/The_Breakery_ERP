// apps/backoffice/src/features/purchasing/components/poFormMapping.ts
//
// S3-06 — Passage bon enregistré ⇄ formulaire d'édition, sorti de la page de
// détail. Le taux de PPN se déduit de la base taxable (sous-total moins
// escompte global), comme le fait update_purchase_order_v2.

import type { PurchaseOrderDetail } from '../hooks/usePurchaseOrderDetail.js';
import type { UpdatePOItemArg } from '../hooks/useUpdatePurchaseOrder.js';
import type { POFormDraftValue } from './POFormDraft.js';

export function poToFormDraftValue(po: PurchaseOrderDetail): POFormDraftValue {
  const discount = Number(po.discount_amount ?? 0);
  const taxable  = Number(po.subtotal) - discount;
  const vatRate  = taxable > 0
    ? Math.round((Number(po.vat_amount) / taxable) * 10000) / 10000
    : 0.11;
  return {
    supplierId:     po.supplier_id,
    expectedDate:   po.expected_date ?? '',
    orderDate:      po.order_date ?? '',
    paymentTerms:   po.payment_terms === 'cash' ? 'cash' : 'credit',
    vatRate,
    discountAmount: discount,
    deliveryFee:    Number(po.delivery_fee ?? 0),
    notes:          po.notes ?? '',
    items: po.purchase_order_items.map((it) => ({
      productId:        it.product_id,
      quantity:         Number(it.quantity),
      unit:             it.unit ?? '',
      unitFactorToBase: Number(it.unit_factor_to_base ?? 1),
      unitCost:         Number(it.unit_cost),
      discountAmount:   Number(it.discount_amount ?? 0),
      notes:            it.notes ?? '',
    })),
  };
}

export function toUpdatePOItems(v: POFormDraftValue): UpdatePOItemArg[] {
  return v.items.map((it) => ({
    product_id:          it.productId,
    quantity:            it.quantity,
    unit_factor_to_base: it.unitFactorToBase,
    unit_cost:           it.unitCost,
    discount_amount:     it.discountAmount,
    ...(it.unit.trim()  !== '' ? { unit:  it.unit.trim() }  : {}),
    ...(it.notes.trim() !== '' ? { notes: it.notes.trim() } : {}),
  }));
}
