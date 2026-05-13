// apps/backoffice/src/features/inventory/components/MovementHistoryDrawer.tsx
//
// Read-only paginated ledger view for one product. Shows every stock_movement
// row (sale, sale_void, purchase, adjustment, waste, production) with their
// reason / supplier reference. 50 entries per page.

import { useState, type JSX } from 'react';
import { Badge, Button, Dialog, DialogContent, DialogTitle, DialogDescription } from '@breakery/ui';
import { classifyMovement } from '@breakery/domain';
import type { StockMovement } from '@breakery/domain';
import {
  useStockMovements,
  PAGE_SIZE,
  type StockMovementRow,
} from '../hooks/useStockMovements.js';
import type { StockLevelRow } from '../hooks/useStockLevels.js';

export interface MovementHistoryDrawerProps {
  product: StockLevelRow | undefined;
  onClose: () => void;
}

const TYPE_LABEL: Record<StockMovementRow['movement_type'], string> = {
  sale:                'Sale',
  sale_void:           'Sale void',
  purchase:            'Purchase',
  purchase_return:     'Purchase return',
  adjustment:          'Adjustment',
  adjustment_in:       'Adjustment +',
  adjustment_out:      'Adjustment −',
  waste:               'Waste',
  production:          'Production',
  production_in:       'Production in',
  production_out:      'Production out',
  transfer_in:         'Transfer in',
  transfer_out:        'Transfer out',
  opname_in:           'Opname +',
  opname_out:          'Opname −',
  incoming:            'Incoming',
  reservation_hold:    'Reservation hold',
  reservation_release: 'Reservation release',
};

const TYPE_VARIANT: Record<StockMovementRow['movement_type'], 'default' | 'secondary' | 'destructive' | 'outline'> = {
  sale:                'secondary',
  sale_void:           'outline',
  purchase:            'default',
  purchase_return:     'outline',
  adjustment:          'outline',
  adjustment_in:       'outline',
  adjustment_out:      'outline',
  waste:               'destructive',
  production:          'default',
  production_in:       'default',
  production_out:      'secondary',
  transfer_in:         'default',
  transfer_out:        'secondary',
  opname_in:           'outline',
  opname_out:          'outline',
  incoming:            'default',
  reservation_hold:    'outline',
  reservation_release: 'outline',
};

function toDomainMovement(row: StockMovementRow): StockMovement {
  // tsconfig has `exactOptionalPropertyTypes` so we only set the optional
  // fields when they have a concrete value, never `undefined`.
  const base: StockMovement = {
    id:             row.id,
    productId:      row.product_id,
    movementType:   row.movement_type,
    quantity:       row.quantity,
    referenceType:  row.reference_type as StockMovement['referenceType'],
    createdBy:      row.created_by,
    createdAt:      row.created_at,
  };
  if (row.reason          !== null) base.reason          = row.reason;
  if (row.unit_cost       !== null) base.unitCost        = row.unit_cost;
  if (row.supplier_id     !== null) base.supplierId      = row.supplier_id;
  if (row.idempotency_key !== null) base.idempotencyKey  = row.idempotency_key;
  if (row.reference_id    !== null) base.referenceId     = row.reference_id;
  return base;
}

function describeReference(row: StockMovementRow): string {
  // Sales reference an order_item / order; UI displays a short hint.
  if (row.movement_type === 'sale' || row.movement_type === 'sale_void') {
    if (row.reference_id !== null) {
      return `${row.reference_type === 'order' ? 'Order' : 'Line'} ${row.reference_id.slice(0, 8)}…`;
    }
    return row.reason ?? '—';
  }
  if (row.movement_type === 'purchase' && row.supplier !== null) {
    const prefix = `From ${row.supplier.name} (${row.supplier.code})`;
    return row.reason !== null && row.reason !== '' ? `${prefix} — ${row.reason}` : prefix;
  }
  return row.reason ?? '—';
}

export function MovementHistoryDrawer({ product, onClose }: MovementHistoryDrawerProps): JSX.Element {
  const open = product !== undefined;
  const [page, setPage] = useState<number>(0);
  const q = useStockMovements(product?.product_id ?? null, page);

  function handleClose(): void {
    setPage(0);
    onClose();
  }

  const hasMore = q.data?.length === PAGE_SIZE;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogTitle>
          {product?.name} <span className="text-text-secondary font-mono text-sm">({product?.sku})</span>
        </DialogTitle>
        <DialogDescription>Stock movements, most recent first.</DialogDescription>

        {q.isLoading && <div className="text-text-secondary py-12 text-center">Loading…</div>}
        {q.error && <div className="text-red py-12 text-center">{q.error.message}</div>}
        {q.data?.length === 0 && page === 0 && (
          <div className="text-text-secondary py-12 text-center">No movements recorded yet.</div>
        )}
        {q.data !== undefined && q.data.length > 0 && (
          <>
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-widest text-text-secondary">
                <tr>
                  <th className="px-2 py-1 text-left">When</th>
                  <th className="px-2 py-1 text-left">Type</th>
                  <th className="px-2 py-1 text-right">Qty</th>
                  <th className="px-2 py-1 text-left">Reason / reference</th>
                  <th className="px-2 py-1 text-left">By</th>
                </tr>
              </thead>
              <tbody>
                {q.data.map((row) => {
                  const cls = classifyMovement(toDomainMovement(row));
                  const qtyClass =
                    cls.direction === 'IN' ? 'text-green' :
                    row.quantity === 0    ? 'text-text-muted' :
                                            'text-red';
                  return (
                    <tr key={row.id} className="border-t border-border-subtle">
                      <td className="px-2 py-1 text-text-secondary">
                        {new Date(row.created_at).toLocaleString()}
                      </td>
                      <td className="px-2 py-1">
                        <Badge variant={TYPE_VARIANT[row.movement_type]} className="text-[10px]">
                          {TYPE_LABEL[row.movement_type]}
                        </Badge>
                      </td>
                      <td className={`px-2 py-1 text-right font-mono ${qtyClass}`}>
                        {row.quantity > 0 ? '+' : ''}{row.quantity}
                      </td>
                      <td className="px-2 py-1">{describeReference(row)}</td>
                      <td className="px-2 py-1 text-text-secondary">{row.author?.full_name ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div className="flex items-center justify-between pt-3 text-xs">
              <span className="text-text-secondary">
                Page {page + 1} · showing {q.data.length} {q.data.length === 1 ? 'entry' : 'entries'}
              </span>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                >
                  Previous
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setPage((p) => p + 1)}
                  disabled={!hasMore}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}

        <div className="flex justify-end pt-2">
          <Button type="button" variant="secondary" onClick={handleClose}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
