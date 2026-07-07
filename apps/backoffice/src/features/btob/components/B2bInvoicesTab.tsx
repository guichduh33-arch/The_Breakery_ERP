// apps/backoffice/src/features/btob/components/B2bInvoicesTab.tsx
// Session 56 — DEV-S52-03 : per-invoice surface (view_b2b_invoices).
// Filters: customer + unpaid-only (default ON) + page-level search.
// Row actions: Record payment (pre-checks the invoice), Cancel (b2b_pending,
// nothing allocated, gate b2b.order.cancel).

import { useMemo, useState, type JSX } from 'react';
import { FileText, XCircle } from 'lucide-react';
import { Button, EmptyState } from '@breakery/ui';
import { formatIdr } from '@breakery/utils';
import { useB2bInvoices, type B2bInvoiceRow } from '../hooks/useB2bInvoices.js';
import { useB2bCustomers } from '../hooks/useB2bCustomers.js';
import { CancelB2bOrderModal } from './CancelB2bOrderModal.js';

function statusBadge(inv: B2bInvoiceRow): { label: string; cls: string } {
  if (Number(inv.outstanding) === 0) return { label: 'paid',    cls: 'bg-success-soft text-success' };
  if (Number(inv.amount_paid) > 0)   return { label: 'partial', cls: 'bg-warning-soft text-warning' };
  return { label: 'unpaid', cls: 'bg-red-soft text-red' };
}

export interface B2bInvoicesTabProps {
  search:    string;
  canRecord: boolean;
  canCancel: boolean;
  onRecord:  (customerId: string, invoiceIds?: string[]) => void;
}

export function B2bInvoicesTab({ search, canRecord, canCancel, onRecord }: B2bInvoicesTabProps): JSX.Element {
  const customers = useB2bCustomers();
  const [customerId, setCustomerId] = useState('');
  const [unpaidOnly, setUnpaidOnly] = useState(true);
  const [cancelTarget, setCancelTarget] = useState<B2bInvoiceRow | null>(null);

  const invoices = useB2bInvoices(customerId || undefined, unpaidOnly);

  const rows = useMemo(() => {
    const q = search.toLowerCase();
    return (invoices.data ?? []).filter((r) =>
      q === '' ||
      r.order_number.toLowerCase().includes(q) ||
      (r.b2b_company_name ?? '').toLowerCase().includes(q) ||
      (r.customer_name ?? '').toLowerCase().includes(q));
  }, [invoices.data, search]);

  return (
    <div className="border-t border-border-subtle">
      <div className="flex flex-wrap items-center gap-3 p-4">
        <select
          value={customerId}
          onChange={(e) => setCustomerId(e.target.value)}
          className="h-9 rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary"
          aria-label="Filter by customer"
          data-testid="inv-customer-filter"
        >
          <option value="">All customers</option>
          {customers.data?.map((c) => (
            <option key={c.id} value={c.id}>{c.b2b_company_name ?? c.name}</option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-text-secondary">
          <input
            type="checkbox"
            checked={unpaidOnly}
            onChange={(e) => setUnpaidOnly(e.target.checked)}
            data-testid="inv-unpaid-toggle"
          />
          Unpaid only
        </label>
      </div>

      {invoices.isLoading ? (
        <div className="p-6 text-sm text-text-secondary">Loading…</div>
      ) : rows.length === 0 ? (
        <EmptyState icon={FileText} title="No invoices" description="B2B invoices will appear here." size="md" />
      ) : (
        <ul className="divide-y divide-border-subtle" data-testid="inv-list">
          {rows.map((inv) => {
            const badge = statusBadge(inv);
            const cancellable = inv.order_status === 'b2b_pending' && Number(inv.amount_paid) === 0;
            return (
              <li key={inv.invoice_id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-text-primary">{inv.order_number}</span>
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${badge.cls}`}>
                      {badge.label}
                    </span>
                  </div>
                  <div className="text-xs text-text-secondary">
                    {inv.b2b_company_name ?? inv.customer_name ?? 'Unknown'}
                    {' • '}{new Date(inv.invoice_date).toLocaleDateString()}
                    {' • '}{inv.age_days}d
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right text-xs">
                    <div className="font-mono text-base text-text-primary">{formatIdr(Number(inv.outstanding))}</div>
                    <div className="text-text-muted">
                      of {formatIdr(Number(inv.invoice_total))} • paid {formatIdr(Number(inv.amount_paid))}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {canRecord && Number(inv.outstanding) > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onRecord(inv.customer_id, [inv.invoice_id])}
                        data-testid={`inv-record-${inv.order_number}`}
                      >
                        Record payment
                      </Button>
                    )}
                    {canCancel && cancellable && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setCancelTarget(inv)}
                        className="text-red"
                        data-testid={`inv-cancel-${inv.order_number}`}
                      >
                        <XCircle className="mr-1 h-3.5 w-3.5" aria-hidden /> Cancel
                      </Button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {cancelTarget !== null && (
        <CancelB2bOrderModal
          open
          orderId={cancelTarget.invoice_id}
          orderNumber={cancelTarget.order_number}
          onClose={() => setCancelTarget(null)}
        />
      )}
    </div>
  );
}
