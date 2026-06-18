// apps/backoffice/src/features/products/components/PurchasePanel.tsx
//
// Product detail "Purchase" tab — the last purchase-order line items for this
// product (supplier, PO #, date, qty, received, unit price, total, receipt
// status). Read-only over useProductPurchaseItems; no new RPC.

import { useMemo, type JSX } from 'react';
import { Badge, Card, EmptyState, KpiTile, SectionLabel } from '@breakery/ui';
import { ShoppingCart } from 'lucide-react';
import { formatIdr } from '@breakery/utils';
import {
  useProductPurchaseItems,
  type ProductPurchaseItem,
} from '../hooks/useProductPurchaseItems.js';

function fmtDate(iso: string | null): string {
  if (iso === null) return '—';
  return new Date(iso).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: '2-digit' });
}

// Map the free-text PO status to one of the Badge primitive's variants.
function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'received':  return 'default';
    case 'partial':   return 'secondary';
    case 'cancelled': return 'destructive';
    default:          return 'outline';
  }
}

interface Props {
  productId: string;
}

export function PurchasePanel({ productId }: Props): JSX.Element {
  const q = useProductPurchaseItems(productId);

  const items: ProductPurchaseItem[] = q.data ?? [];

  const summary = useMemo(() => {
    if (items.length === 0) {
      return { count: 0, totalSpent: 0, lastPrice: null as number | null, lastDate: null as string | null };
    }
    const totalSpent = items.reduce((s, it) => s + it.subtotal, 0);
    // items are sorted newest-first by the hook.
    const last = items[0];
    return {
      count: items.length,
      totalSpent,
      lastPrice: last?.unit_cost ?? null,
      lastDate: last?.order_date ?? null,
    };
  }, [items]);

  if (q.isLoading) {
    return <div className="py-12 text-center text-sm text-text-secondary">Loading purchase history…</div>;
  }
  if (q.error !== null && q.error !== undefined) {
    return (
      <div className="rounded-lg border border-red bg-red-soft p-4 text-sm text-red" role="alert">
        Failed to load purchase history: {(q.error as Error).message}
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <EmptyState
        icon={ShoppingCart}
        title="No purchase history yet"
        description="Past purchase orders for this product — supplier, price and quantity — appear here once it has been ordered."
        size="lg"
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <KpiTile label="Purchases" value={String(summary.count)} />
        <KpiTile label="Total Spent" value={formatIdr(summary.totalSpent)} />
        <KpiTile
          label="Last Unit Price"
          value={summary.lastPrice !== null ? formatIdr(summary.lastPrice) : '—'}
          footer={summary.lastDate !== null ? fmtDate(summary.lastDate) : undefined}
        />
      </div>

      <Card variant="default" padding="none">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border-subtle bg-bg-base/40">
              <tr>
                <th className="px-4 py-3 text-left"><SectionLabel as="span" size="xs">Date</SectionLabel></th>
                <th className="px-4 py-3 text-left"><SectionLabel as="span" size="xs">PO #</SectionLabel></th>
                <th className="px-4 py-3 text-left"><SectionLabel as="span" size="xs">Supplier</SectionLabel></th>
                <th className="px-4 py-3 text-right"><SectionLabel as="span" size="xs">Qty</SectionLabel></th>
                <th className="px-4 py-3 text-right"><SectionLabel as="span" size="xs">Received</SectionLabel></th>
                <th className="px-4 py-3 text-right"><SectionLabel as="span" size="xs">Unit Price</SectionLabel></th>
                <th className="px-4 py-3 text-right"><SectionLabel as="span" size="xs">Total</SectionLabel></th>
                <th className="px-4 py-3 text-left"><SectionLabel as="span" size="xs">Status</SectionLabel></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={`${it.po_id}-${i}`} className="border-t border-border-subtle">
                  <td className="px-4 py-3 tabular-nums text-text-secondary">{fmtDate(it.order_date)}</td>
                  <td className="px-4 py-3 font-mono text-text-primary">{it.po_number}</td>
                  <td className="px-4 py-3">{it.supplier_name}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{it.quantity} {it.unit}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-text-secondary">{it.received_quantity} {it.unit}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatIdr(it.unit_cost)}</td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums">{formatIdr(it.subtotal)}</td>
                  <td className="px-4 py-3">
                    <Badge variant={statusVariant(it.status)}>{it.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
