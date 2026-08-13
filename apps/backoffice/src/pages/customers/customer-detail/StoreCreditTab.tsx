// apps/backoffice/src/pages/customers/customer-detail/StoreCreditTab.tsx
// ADR-013 Lot 4 — onglet "Store credit" de la fiche client : historique du
// ledger append-only. Clone structurel de LoyaltyTab (co-located split).

import type { JSX } from 'react';
import { Card } from '@breakery/ui';
import { formatDate } from '@breakery/utils';
import {
  useStoreCreditHistory, type StoreCreditSource,
} from '@/features/customers/hooks/useStoreCreditHistory.js';
import { rp } from './shared.js';

const SOURCE_TONE: Record<StoreCreditSource, string> = {
  refund:             'text-success',
  manager_grant:      'text-success',
  loyalty_conversion: 'text-success',
  spend:              'text-danger',
  expiry:             'text-warning',
};

const SOURCE_LABEL: Record<StoreCreditSource, string> = {
  refund:             'Refund',
  manager_grant:      'Manager grant',
  loyalty_conversion: 'Points conversion',
  spend:              'Spent',
  expiry:             'Expired',
};

export function StoreCreditTab({ customerId }: { customerId: string | null }): JSX.Element {
  const { data, isLoading } = useStoreCreditHistory(customerId);

  if (isLoading) return <Card variant="default" padding="lg"><p className="text-sm text-text-muted">Loading…</p></Card>;
  if (!data || data.length === 0) {
    return <Card variant="default" padding="lg"><p className="text-sm text-text-muted">No store-credit activity yet.</p></Card>;
  }

  return (
    <Card variant="default" padding="none" className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead className="border-b border-border-subtle bg-surface-inert font-data text-[10px] font-semibold uppercase tracking-widest text-text-muted">
          <tr>
            <th className="px-4 py-2.5 text-left font-medium">Date</th>
            <th className="px-4 py-2.5 text-left font-medium">Source</th>
            <th className="px-4 py-2.5 text-left font-medium">By</th>
            <th className="px-4 py-2.5 text-right font-medium">Amount</th>
            <th className="px-4 py-2.5 text-right font-medium">Balance</th>
            <th className="px-4 py-2.5 text-right font-medium">Expires</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr key={row.id} className="border-t border-border-subtle">
              <td className="px-4 py-3 text-text-secondary">{formatDate(row.created_at)}</td>
              <td className={`px-4 py-3 font-medium ${SOURCE_TONE[row.source] ?? 'text-text-primary'}`}>
                {SOURCE_LABEL[row.source] ?? row.source}
              </td>
              <td className="px-4 py-3 text-text-secondary">{row.author?.full_name ?? '—'}</td>
              <td className={`px-4 py-3 text-right tabular-nums font-medium ${row.delta >= 0 ? 'text-success' : 'text-danger'}`}>
                {row.delta >= 0 ? '+' : ''}{rp(row.delta)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-text-secondary">{rp(row.balance_after)}</td>
              <td className="px-4 py-3 text-right text-text-secondary">
                {row.expires_at ? formatDate(row.expires_at) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
