// apps/backoffice/src/features/products/components/PurchasePanel.tsx
//
// Product detail "Purchase" tab — the last purchase-order line items for this
// product (supplier, PO #, date, qty, received, unit price, total, receipt
// status). Read-only over useProductPurchaseItems; no new RPC.

import { useMemo, type JSX } from 'react';
import { Badge, Card, EmptyState } from '@breakery/ui';
import { SectionLabel } from '@/components/SectionLabel.js';
// La tuile du back-office (23 px, `valueTitle`) et non celle de `@breakery/ui`
// (34 px) : « Total Spent » cumule des achats fournisseur et déborde dès huit
// chiffres. Le prix unitaire, sa voisine, suit pour que la rangée reste une.
import { KpiTile, KPI_NOTE } from '@/components/kpi/KpiTile.js';
import { formatIdr, formatIdrShort } from '@/features/dashboard/utils/format.js';
import { ShoppingCart } from 'lucide-react';
import { formatCurrency, formatDate } from '@breakery/utils';
import {
  useProductPurchaseItems,
  type ProductPurchaseItem,
} from '../hooks/useProductPurchaseItems.js';

function fmtDate(iso: string | null): string {
  if (iso === null) return '—';
  return formatDate(iso);
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
        Failed to load purchase history: {(q.error).message}
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
        <KpiTile label="Purchases" value={String(summary.count)} testId="kpi-purchases-count" />
        <KpiTile
          label="Total Spent"
          value={formatIdrShort(summary.totalSpent)}
          valueTitle={formatIdr(summary.totalSpent)}
          testId="kpi-total-spent"
        />
        <KpiTile
          label="Last Unit Price"
          value={summary.lastPrice !== null ? formatIdrShort(summary.lastPrice) : '—'}
          {...(summary.lastPrice !== null ? { valueTitle: formatIdr(summary.lastPrice) } : {})}
          unavailable={summary.lastPrice === null}
          testId="kpi-last-unit-price"
        >
          {summary.lastDate !== null && <span className={KPI_NOTE}>{fmtDate(summary.lastDate)}</span>}
        </KpiTile>
      </div>

      <Card variant="default" padding="none">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Date, purchase order, supplier, ordered and received quantity, unit price, total and status per purchase line</caption>
            <thead className="border-b border-border-subtle bg-surface-inert">
              <tr>
                <th scope="col" className="px-4 py-3 text-left"><SectionLabel as="span" size="xs">Date</SectionLabel></th>
                <th scope="col" className="px-4 py-3 text-left"><SectionLabel as="span" size="xs">PO #</SectionLabel></th>
                <th scope="col" className="px-4 py-3 text-left"><SectionLabel as="span" size="xs">Supplier</SectionLabel></th>
                <th scope="col" className="px-4 py-3 text-right"><SectionLabel as="span" size="xs">Qty</SectionLabel></th>
                <th scope="col" className="px-4 py-3 text-right"><SectionLabel as="span" size="xs">Received</SectionLabel></th>
                <th scope="col" className="px-4 py-3 text-right"><SectionLabel as="span" size="xs">Unit Price</SectionLabel></th>
                <th scope="col" className="px-4 py-3 text-right"><SectionLabel as="span" size="xs">Total</SectionLabel></th>
                <th scope="col" className="px-4 py-3 text-left"><SectionLabel as="span" size="xs">Status</SectionLabel></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={`${it.po_id}-${i}`} className="border-t border-border-subtle">
                  <td className="px-4 py-3 tabular-nums text-text-secondary">{fmtDate(it.order_date)}</td>
                  <td className="px-4 py-3 font-mono text-text-primary">{it.po_number}</td>
                  <td className="px-4 py-3">{it.supplier_name}</td>
                  <td className="px-4 py-3 text-right font-data tabular-nums">{it.quantity} {it.unit}</td>
                  <td className="px-4 py-3 text-right font-data tabular-nums text-text-secondary">{it.received_quantity} {it.unit}</td>
                  <td className="px-4 py-3 text-right font-data tabular-nums">{formatCurrency(it.unit_cost)}</td>
                  <td className="px-4 py-3 text-right font-data font-medium tabular-nums">{formatCurrency(it.subtotal)}</td>
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
