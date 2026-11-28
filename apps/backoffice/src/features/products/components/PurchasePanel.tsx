// apps/backoffice/src/features/products/components/PurchasePanel.tsx
//
// Product detail "Purchase" tab — the last purchase-order line items for this
// product (supplier, PO #, date, qty, received, unit price, total, receipt
// status). Read-only over useProductPurchaseItems; no new RPC.
//
// Harmonisation 2026-11-28 : le numéro de bon et le fournisseur sont des liens
// (ils étaient du texte inerte), la pastille de réception est la pastille
// commune des achats (le statut brut s'affichait en minuscules), les dates
// suivent le vocabulaire commun, et deux filtres arrivent — fournisseur et
// réception — sur les lignes chargées.

import { useMemo, useState, type JSX } from 'react';
import { Link } from 'react-router-dom';
import { Card, EmptyState } from '@/components/BackofficeUi.js';
import { SectionLabel } from '@/components/SectionLabel.js';
import { FOCUS_RING } from '@/components/focusRing.js';
// La tuile du back-office (23 px, `valueTitle`) et non celle de `@breakery/ui`
// (34 px) : « Total Spent » cumule des achats fournisseur et déborde dès huit
// chiffres. Le prix unitaire, sa voisine, suit pour que la rangée reste une.
import { KpiTile, KPI_NOTE } from '@/components/kpi/KpiTile.js';
import { formatIdr, formatIdrShort } from '@/features/dashboard/utils/format.js';
import { ShoppingCart } from 'lucide-react';
import { formatCurrency } from '@breakery/utils';
import { POStatusBadge, PO_STATUS_LABELS } from '@/features/purchasing/components/POStatusBadge.js';
import { PO_DATE_LABELS, formatPoDay } from '@/features/purchasing/poVocabulary.js';
import {
  useProductPurchaseItems,
  type ProductPurchaseItem,
} from '../hooks/useProductPurchaseItems.js';

const SELECT_CLS = `h-9 rounded-md border border-border-strong bg-bg-input px-3 text-sm text-text-primary ${FOCUS_RING}`;
const RECEPTION = ['pending', 'partial', 'received', 'cancelled'] as const;

interface Props {
  productId: string;
}

export function PurchasePanel({ productId }: Props): JSX.Element {
  const q = useProductPurchaseItems(productId);
  const [supplier, setSupplier] = useState('');
  const [reception, setReception] = useState('');

  const items: ProductPurchaseItem[] = useMemo(() => q.data ?? [], [q.data]);
  const suppliers = useMemo(
    () => [...new Map(items.map((it) => [it.supplier_id, it.supplier_name])).entries()]
      .sort((a, b) => a[1].localeCompare(b[1])),
    [items],
  );
  const shown = useMemo(
    () => items.filter((it) => (supplier === '' || it.supplier_id === supplier)
      && (reception === '' || it.status === reception)),
    [items, supplier, reception],
  );

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
          {summary.lastDate !== null && <span className={KPI_NOTE}>{formatPoDay(summary.lastDate)}</span>}
        </KpiTile>
      </div>

      <div className="flex flex-wrap items-center gap-3" data-testid="product-purchase-filters">
        <select value={supplier} onChange={(e) => setSupplier(e.target.value)} aria-label="Supplier filter" className={SELECT_CLS}>
          <option value="">All suppliers</option>
          {suppliers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <select value={reception} onChange={(e) => setReception(e.target.value)} aria-label="Reception filter" className={SELECT_CLS}>
          <option value="">Any reception</option>
          {RECEPTION.map((s) => <option key={s} value={s}>{PO_STATUS_LABELS[s]}</option>)}
        </select>
        <span className="text-xs text-text-muted">{shown.length} of {items.length} line(s)</span>
      </div>

      <Card variant="default" padding="none">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Order date, purchase order, supplier, ordered and received quantity, unit price, total and reception status per purchase line</caption>
            <thead className="border-b border-border-subtle bg-surface-inert">
              <tr>
                <th scope="col" className="px-4 py-3 text-left"><SectionLabel as="span" size="xs">{PO_DATE_LABELS.ordered}</SectionLabel></th>
                <th scope="col" className="px-4 py-3 text-left"><SectionLabel as="span" size="xs">PO #</SectionLabel></th>
                <th scope="col" className="px-4 py-3 text-left"><SectionLabel as="span" size="xs">Supplier</SectionLabel></th>
                <th scope="col" className="px-4 py-3 text-right"><SectionLabel as="span" size="xs">Qty</SectionLabel></th>
                <th scope="col" className="px-4 py-3 text-right"><SectionLabel as="span" size="xs">Received</SectionLabel></th>
                <th scope="col" className="px-4 py-3 text-right"><SectionLabel as="span" size="xs">Unit Price</SectionLabel></th>
                <th scope="col" className="px-4 py-3 text-right"><SectionLabel as="span" size="xs">Total</SectionLabel></th>
                <th scope="col" className="px-4 py-3 text-left"><SectionLabel as="span" size="xs">Reception</SectionLabel></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((it, i) => (
                <tr key={`${it.po_id}-${i}`} className="border-t border-border-subtle">
                  <td className="px-4 py-3 font-data tabular-nums text-text-secondary">{formatPoDay(it.order_date)}</td>
                  <td className="px-4 py-3">
                    <Link to={`/backoffice/purchasing/purchase-orders/${it.po_id}`} className={`font-mono text-xs text-gold hover:underline ${FOCUS_RING}`}>
                      {it.po_number}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <Link to={`/backoffice/suppliers/${it.supplier_id}`} className={`hover:text-gold hover:underline ${FOCUS_RING}`}>
                      {it.supplier_name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-right font-data tabular-nums">{it.quantity} {it.unit}</td>
                  <td className="px-4 py-3 text-right font-data tabular-nums text-text-secondary">{it.received_quantity} {it.unit}</td>
                  <td className="px-4 py-3 text-right font-data tabular-nums">{formatCurrency(it.unit_cost)}</td>
                  <td className="px-4 py-3 text-right font-data font-medium tabular-nums">{formatCurrency(it.subtotal)}</td>
                  <td className="px-4 py-3"><POStatusBadge status={it.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
