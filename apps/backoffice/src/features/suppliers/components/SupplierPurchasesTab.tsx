// Onglet « Purchases » de la fiche fournisseur — sorti de SupplierDetailPage.
//
// Harmonisation 2026-11-28 : mêmes pastilles que la liste des bons (réception
// ET paiement, deux colonnes), mêmes libellés et format de dates, et des
// filtres — numéro de bon, réception, paiement, plage sur le jour de commande.
// Les filtres portent sur les bons chargés (jusqu'au plafond, dit à l'écran).

import { useMemo, useState, type JSX } from 'react';
import { Link } from 'react-router-dom';
import { Package } from 'lucide-react';
import { formatCurrency } from '@breakery/utils';
import { EmptyState } from '@/components/BackofficeUi.js';
import { SectionLabel } from '@/components/SectionLabel.js';
import { FOCUS_RING } from '@/components/focusRing.js';
import { DateRangePicker } from '@/features/reports/components/DateRangePicker.js';
import { POStatusBadge, PO_STATUS_LABELS } from '@/features/purchasing/components/POStatusBadge.js';
import {
  PAYMENT_STATUS_LABELS,
  PoPaymentBadge,
  poPaymentStatusOf,
} from '@/features/purchasing/components/PoPaymentBadge.js';
import { PO_DATE_LABELS, formatPoDay } from '@/features/purchasing/poVocabulary.js';
import { SUPPLIER_PURCHASES_LIMIT, type SupplierPOListRow } from '../hooks/useSupplierPurchases.js';

const SELECT_CLS = `h-9 rounded-md border border-border-strong bg-bg-input px-3 text-sm text-text-primary ${FOCUS_RING}`;
const RECEPTION = ['pending', 'partial', 'received', 'cancelled'] as const;
const PAYMENT = ['unpaid', 'partial', 'paid'] as const;

export interface SupplierPoFilters {
  search:    string;
  reception: string;
  payment:   string;
  from:      string;
  to:        string;
}

export const EMPTY_SUPPLIER_PO_FILTERS: SupplierPoFilters = { search: '', reception: '', payment: '', from: '', to: '' };

/** Filtre pur, exporté pour l'onglet des paiements et les tests. */
export function filterSupplierPos(rows: readonly SupplierPOListRow[], f: SupplierPoFilters): SupplierPOListRow[] {
  const term = f.search.trim().toLowerCase();
  return rows.filter((r) => {
    if (term !== '' && !r.po_number.toLowerCase().includes(term)) return false;
    if (f.reception !== '' && r.status !== f.reception) return false;
    if (f.payment !== '') {
      const s = poPaymentStatusOf({ status: r.status, totalAmount: r.total_amount, paidAmount: r.paid_amount, isHistoricalImport: r.is_historical_import });
      if (s !== f.payment) return false;
    }
    if (f.from !== '' && (r.order_date ?? '') < f.from) return false;
    if (f.to !== '' && (r.order_date ?? '') > f.to) return false;
    return true;
  });
}

export function SupplierPoFilterBar({
  value, onChange, testId,
}: { value: SupplierPoFilters; onChange: (next: SupplierPoFilters) => void; testId: string }): JSX.Element {
  const set = (k: keyof SupplierPoFilters, v: string): void => onChange({ ...value, [k]: v });
  const active = Object.values(value).some((v) => v !== '');
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border-subtle bg-bg-elevated px-4 py-3" data-testid={testId}>
      <input value={value.search} onChange={(e) => set('search', e.target.value)} maxLength={64}
        placeholder="Search by PO number…" aria-label="Search purchase orders"
        className={`h-9 min-w-[12rem] flex-1 rounded-md border border-border-strong bg-bg-input px-3 text-sm text-text-primary placeholder:text-text-muted ${FOCUS_RING}`} />
      <select value={value.reception} onChange={(e) => set('reception', e.target.value)} aria-label="Reception filter" className={SELECT_CLS}>
        <option value="">Any reception</option>
        {RECEPTION.map((s) => <option key={s} value={s}>{PO_STATUS_LABELS[s]}</option>)}
      </select>
      <select value={value.payment} onChange={(e) => set('payment', e.target.value)} aria-label="Payment filter" className={SELECT_CLS}>
        <option value="">Any payment</option>
        {PAYMENT.map((s) => <option key={s} value={s}>{PAYMENT_STATUS_LABELS[s]}</option>)}
      </select>
      <span className="text-sm text-text-secondary">{PO_DATE_LABELS.ordered}</span>
      <DateRangePicker start={value.from} end={value.to}
        onStartChange={(v) => set('from', v)} onEndChange={(v) => set('to', v)} />
      {active && (
        <button type="button" onClick={() => onChange(EMPTY_SUPPLIER_PO_FILTERS)}
          className={`text-sm text-text-secondary underline-offset-2 hover:text-text-primary hover:underline ${FOCUS_RING}`}>
          Clear filters
        </button>
      )}
    </div>
  );
}

export function CapNote({ count }: { count: number }): JSX.Element | null {
  if (count < SUPPLIER_PURCHASES_LIMIT) return null;
  return (
    <p role="note" className="text-xs text-text-muted">
      Showing the latest {SUPPLIER_PURCHASES_LIMIT.toLocaleString('id-ID')} orders. Use the purchase order list for older ones.
    </p>
  );
}

export function SupplierPurchasesTab({ rows, isLoading }: { rows: SupplierPOListRow[]; isLoading: boolean }): JSX.Element {
  const [filters, setFilters] = useState<SupplierPoFilters>(EMPTY_SUPPLIER_PO_FILTERS);
  const shown = useMemo(() => filterSupplierPos(rows, filters), [rows, filters]);

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={`po-skel-${i}`} className="h-10 animate-pulse rounded-md border border-border-subtle bg-bg-elevated motion-reduce:animate-none" />
        ))}
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <EmptyState icon={Package} title="No purchases yet"
        description="Purchase orders for this supplier will appear here." size="md" />
    );
  }
  return (
    <div className="space-y-3">
      <SupplierPoFilterBar value={filters} onChange={setFilters} testId="supplier-purchases-filters" />
      <CapNote count={rows.length} />
      {shown.length === 0 ? (
        <EmptyState icon={Package} title="No purchase order matches these filters"
          description="Change or clear the filters above." size="sm" />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border-subtle bg-bg-elevated">
          <table className="w-full text-sm">
            <caption className="sr-only">Order date, purchase order number, reception status, payment status, received date, item count and total per order</caption>
            <thead className="border-b border-border-subtle bg-surface-inert">
              <tr>
                {[PO_DATE_LABELS.ordered, 'PO Number', 'Reception', 'Payment', PO_DATE_LABELS.received].map((h) => (
                  <th key={h} scope="col" className="px-4 py-3 text-left"><SectionLabel as="span" size="xs">{h}</SectionLabel></th>
                ))}
                <th scope="col" className="px-4 py-3 text-right"><SectionLabel as="span" size="xs">Items</SectionLabel></th>
                <th scope="col" className="px-4 py-3 text-right"><SectionLabel as="span" size="xs">Total</SectionLabel></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className="border-t border-border-subtle hover:bg-surface-4">
                  <td className="px-4 py-3 font-data tabular-nums text-text-secondary">{formatPoDay(r.order_date)}</td>
                  <td className="px-4 py-3">
                    <Link to={`/backoffice/purchasing/purchase-orders/${r.id}`} className={`font-mono text-xs text-gold hover:underline ${FOCUS_RING}`}>
                      {r.po_number}
                    </Link>
                  </td>
                  <td className="px-4 py-3"><POStatusBadge status={r.status} /></td>
                  <td className="px-4 py-3">
                    <PoPaymentBadge status={r.status} totalAmount={r.total_amount} paidAmount={r.paid_amount} isHistoricalImport={r.is_historical_import} />
                  </td>
                  <td className="px-4 py-3 font-data tabular-nums text-text-secondary">{formatPoDay(r.received_date)}</td>
                  <td className="px-4 py-3 text-right font-data tabular-nums">{r.item_count}</td>
                  <td className="px-4 py-3 text-right font-data tabular-nums">{formatCurrency(Number(r.total_amount ?? 0))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
