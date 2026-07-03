// apps/backoffice/src/pages/customers/customer-detail/LoyaltyTab.tsx
//
// "Loyalty" tab of the customer detail page: points transaction history table.
// Co-located split (S57 E-D4) — behaviour unchanged.

import type { JSX } from 'react';
import { Card } from '@breakery/ui';
import { useCustomerLoyaltyHistory } from '@/features/loyalty/hooks/useCustomerLoyaltyHistory.js';

const TXN_TONE: Record<string, string> = {
  earn: 'text-emerald-600',
  refund: 'text-emerald-600',
  redeem: 'text-rose-600',
  adjust: 'text-amber-600',
};

export function LoyaltyTab({ customerId }: { customerId: string | null }): JSX.Element {
  const { data, isLoading } = useCustomerLoyaltyHistory(customerId);

  if (isLoading) return <Card variant="default" padding="lg"><p className="text-sm text-text-muted">Loading…</p></Card>;
  if (!data || data.length === 0) {
    return <Card variant="default" padding="lg"><p className="text-sm text-text-muted">No loyalty activity yet.</p></Card>;
  }

  return (
    <Card variant="default" padding="none" className="overflow-hidden">
      <table className="w-full border-collapse text-sm">
        <thead className="border-b border-border-subtle bg-bg-base/40 text-xs uppercase tracking-widest text-text-secondary">
          <tr>
            <th className="px-4 py-2.5 text-left font-medium">Date</th>
            <th className="px-4 py-2.5 text-left font-medium">Type</th>
            <th className="px-4 py-2.5 text-left font-medium">Description</th>
            <th className="px-4 py-2.5 text-right font-medium">Points</th>
            <th className="px-4 py-2.5 text-right font-medium">Balance</th>
          </tr>
        </thead>
        <tbody>
          {data.map((tx) => (
            <tr key={tx.id} className="border-t border-border-subtle">
              <td className="px-4 py-3 text-text-secondary">{new Date(tx.created_at).toLocaleDateString('id-ID')}</td>
              <td className={`px-4 py-3 font-medium capitalize ${TXN_TONE[tx.transaction_type] ?? 'text-text-primary'}`}>{tx.transaction_type}</td>
              <td className="px-4 py-3 text-text-secondary">{tx.description}</td>
              <td className={`px-4 py-3 text-right tabular-nums font-medium ${tx.points >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                {tx.points >= 0 ? '+' : ''}{tx.points.toLocaleString()}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-text-secondary">{tx.points_balance_after.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
