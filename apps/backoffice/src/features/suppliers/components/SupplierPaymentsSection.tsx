// Onglet « Payments » de la fiche fournisseur — sorti de SupplierDetailPage.
//
// Harmonisation 2026-11-28 :
//   · la colonne « Due Date » affichait `expected_date`, la LIVRAISON prévue :
//     elle porte désormais son vrai nom, « Expected delivery » ;
//   · la tuile « Overdue » garde sa règle (bons à crédit non reçus dont la
//     livraison prévue est dépassée). Cet écart avec la règle de la dette est
//     déjà noté dans les specs (§ Achats) ; le corriger exige une règle
//     d'échéance que personne n'a décidée. L'écran le dit en clair ;
//   · mêmes pastilles, dates et filtres que l'onglet des achats.

import { Suspense, lazy, useMemo, useState, type JSX } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Clock, CreditCard } from 'lucide-react';
import { formatCurrency } from '@breakery/utils';
import { Card, EmptyState, KpiTile } from '@/components/BackofficeUi.js';
import { SectionLabel } from '@/components/SectionLabel.js';
import { FOCUS_RING } from '@/components/focusRing.js';
import { PoPaymentBadge } from '@/features/purchasing/components/PoPaymentBadge.js';
import { formatPoDay, PO_DATE_LABELS } from '@/features/purchasing/poVocabulary.js';
import type { SupplierPOListRow } from '../hooks/useSupplierPurchases.js';
import type { useSupplierOutstanding } from '../hooks/useSupplierOutstanding.js';
import {
  CapNote,
  EMPTY_SUPPLIER_PO_FILTERS,
  SupplierPoFilterBar,
  filterSupplierPos,
  type SupplierPoFilters,
} from './SupplierPurchasesTab.js';

const SupplierPaymentDistribution = lazy(() =>
  import('./SupplierPaymentDistribution.js').then((m) => ({ default: m.SupplierPaymentDistribution })),
);

/** Règle inchangée : bons à crédit non reçus dont la livraison prévue est passée. */
export function overdueAmount(rows: readonly SupplierPOListRow[], todayIso: string): number {
  return rows.reduce((acc, r) => {
    if (r.status === 'cancelled' || r.payment_terms !== 'credit' || r.received_date !== null) return acc;
    return r.expected_date !== null && r.expected_date < todayIso ? acc + Number(r.total_amount ?? 0) : acc;
  }, 0);
}

function fmtLedger(amount: number | undefined, isError: boolean): string {
  if (isError) return '—';
  if (amount === undefined) return '…';
  return formatCurrency(amount);
}

const HEAD_LEFT = ['PO #', PO_DATE_LABELS.ordered, PO_DATE_LABELS.expected, PO_DATE_LABELS.received];

export function SupplierPaymentsSection({
  rows, ledger, isLoading,
}: {
  rows: SupplierPOListRow[];
  ledger: ReturnType<typeof useSupplierOutstanding>;
  isLoading: boolean;
}): JSX.Element {
  const [filters, setFilters] = useState<SupplierPoFilters>(EMPTY_SUPPLIER_PO_FILTERS);
  // Les hooks précèdent le retour anticipé (ordre des hooks stable).
  const todayIso = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Makassar' }).format(new Date());
  const overdue = useMemo(() => overdueAmount(rows, todayIso), [rows, todayIso]);
  const shown = useMemo(
    () => filterSupplierPos(rows.filter((r) => r.status !== 'cancelled'), filters),
    [rows, filters],
  );

  if (isLoading) {
    return <div className="h-32 animate-pulse rounded-md border border-border-subtle bg-bg-elevated motion-reduce:animate-none" />;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <KpiTile label="Total Paid"   value={fmtLedger(ledger.data?.totalPaid, ledger.isError)}   icon={CheckCircle2} />
        <KpiTile label="Total Unpaid" value={fmtLedger(ledger.data?.outstanding, ledger.isError)} icon={CreditCard} />
        <KpiTile label="Overdue"      value={formatCurrency(overdue)} icon={Clock} />
      </div>
      <p className="text-xs text-text-muted">
        Unpaid counts received orders only. Overdue counts credit orders not yet received whose
        expected delivery has passed.
      </p>

      {rows.length === 0 ? (
        <EmptyState icon={CreditCard} title="No payment history"
          description="Payments recorded on this supplier's purchase orders will appear here." size="md" />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_1fr]">
          <Card variant="default" padding="md">
            <Suspense fallback={<div className="h-44 animate-pulse rounded bg-surface-4 motion-reduce:animate-none" />}>
              <SupplierPaymentDistribution paidAmount={ledger.data?.totalPaid ?? 0} overdueAmount={overdue} />
            </Suspense>
          </Card>
          <div className="min-w-0 space-y-3">
            <SupplierPoFilterBar value={filters} onChange={setFilters} testId="supplier-payments-filters" />
            <CapNote count={rows.length} />
            <div className="overflow-x-auto rounded-lg border border-border-subtle bg-bg-elevated">
              <table className="w-full text-sm">
                <caption className="sr-only">Purchase order, order date, expected delivery, received date, total, amount paid and payment status per order</caption>
                <thead className="border-b border-border-subtle bg-surface-inert">
                  <tr>
                    {HEAD_LEFT.map((h) => (
                      <th key={h} scope="col" className="px-4 py-3 text-left"><SectionLabel as="span" size="xs">{h}</SectionLabel></th>
                    ))}
                    <th scope="col" className="px-4 py-3 text-right"><SectionLabel as="span" size="xs">Total</SectionLabel></th>
                    <th scope="col" className="px-4 py-3 text-right"><SectionLabel as="span" size="xs">Paid</SectionLabel></th>
                    <th scope="col" className="px-4 py-3 text-left"><SectionLabel as="span" size="xs">Payment</SectionLabel></th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.id} className="border-t border-border-subtle">
                      <td className="px-4 py-3">
                        <Link to={`/backoffice/purchasing/purchase-orders/${r.id}`} className={`font-mono text-xs text-gold hover:underline ${FOCUS_RING}`}>
                          {r.po_number}
                        </Link>
                      </td>
                      <td className="px-4 py-3 font-data tabular-nums">{formatPoDay(r.order_date)}</td>
                      <td className="px-4 py-3 font-data tabular-nums">{formatPoDay(r.expected_date)}</td>
                      <td className="px-4 py-3 font-data tabular-nums">{formatPoDay(r.received_date)}</td>
                      <td className="px-4 py-3 text-right font-data tabular-nums">{formatCurrency(Number(r.total_amount ?? 0))}</td>
                      <td className="px-4 py-3 text-right font-data tabular-nums">{formatCurrency(r.paid_amount)}</td>
                      <td className="px-4 py-3">
                        <PoPaymentBadge status={r.status} totalAmount={r.total_amount} paidAmount={r.paid_amount} isHistoricalImport={r.is_historical_import} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
