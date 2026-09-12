import { parseStockQuantity } from '@/features/inventory/stockQuantity.js';
import type { ProducibleProduct } from './hooks/useProducibleProductsBySection.js';
import type { BatchItemInput } from './hooks/useRecordBatchProduction.js';
import type { WasteReason } from './hooks/useRecordProduction.js';

export interface EntryRow {
  rowId: string;
  product: ProducibleProduct;
  unitCode: string;
  quantity: string;
  waste: string;
  wasteReason: WasteReason | '';
  note: string;
}

/** Toutes les lignes saisies doivent être valides : jamais de lot partiel silencieux. */
export function validateProductionEntry(rows: EntryRow[], productionAt: string): {
  items: BatchItemInput[];
  error: string | null;
} {
  const items: BatchItemInput[] = [];
  let error: string | null = null;
  for (const row of rows) {
    const quantity = parseStockQuantity(row.quantity);
    const waste = parseStockQuantity(row.waste);
    const factor = row.product.units.find((unit) => unit.code === row.unitCode)?.factor_to_base;
    if (quantity === null || quantity <= 0 || factor === undefined || !Number.isFinite(factor) || factor <= 0) {
      error ??= `${row.product.name}: enter a positive quantity with up to 3 decimal places and a valid unit.`;
      continue;
    }
    const baseQuantity = parseStockQuantity(String(quantity * factor));
    if (baseQuantity === null || baseQuantity <= 0) {
      error ??= `${row.product.name}: the converted quantity must fit 3 decimal places in ${row.product.unit}.`;
      continue;
    }
    if (waste === null) {
      error ??= `${row.product.name}: waste must be a non-negative quantity with up to 3 decimal places.`;
      continue;
    }
    if (waste > 0 && row.wasteReason === '') {
      error ??= `${row.product.name}: select a waste reason.`;
    }
    items.push({
      productId: row.product.id,
      quantityProduced: baseQuantity,
      ...(waste > 0 ? { quantityWaste: waste } : {}),
      ...(waste > 0 && row.wasteReason !== '' ? { wasteReason: row.wasteReason } : {}),
    });
  }
  if (productionAt.trim() === '' || !Number.isFinite(new Date(productionAt).getTime())) {
    error ??= 'Enter a valid production date and time.';
  }
  return { items, error };
}
