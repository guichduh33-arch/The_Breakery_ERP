// apps/backoffice/src/features/purchasing/import/purchasesImportDef.ts
// Historical purchases import: one Excel row = one PO line, grouped by po_reference server-side.
import type { EntityImportDef } from '@/features/data-import/entityImportDef.js';
import { PURCHASE_ORDERS_QUERY_KEY } from '@/features/purchasing/hooks/usePurchaseOrdersList.js';

export const purchasesImportDef: EntityImportDef = {
  entity: 'purchases',
  sheetName: 'Purchases',
  rpcName: 'import_purchases_v1',
  columns: [
    { key: 'po_reference',  required: true,  type: 'text' },
    { key: 'supplier_code', required: true,  type: 'text' },
    { key: 'order_date',    required: true,  type: 'text' },
    { key: 'payment_terms', required: false, type: 'text' },
    { key: 'notes',         required: false, type: 'text' },
    { key: 'product_sku',   required: true,  type: 'text' },
    { key: 'quantity',      required: true,  type: 'number' },
    { key: 'unit_cost',     required: true,  type: 'number' },
    { key: 'unit',          required: true,  type: 'text' },
  ],
  example: {
    po_reference: 'PO-2026-001', supplier_code: 'SUP-FLOUR', order_date: '2026-01-15',
    payment_terms: 'credit', product_sku: 'SKU-FLOUR-25', quantity: 10, unit_cost: 12000, unit: 'kg',
  },
  queryKeysToInvalidate: [PURCHASE_ORDERS_QUERY_KEY],
};
