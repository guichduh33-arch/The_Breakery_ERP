// apps/backoffice/src/pages/customers/customer-detail/LoyaltyTab.tsx
//
// "Loyalty" tab of the customer detail page: points transaction history table.
// Co-located split (S57 E-D4) — behaviour unchanged.

import type { JSX } from 'react';
import { Card } from '@/components/BackofficeUi.js';
import { QueryErrorBanner } from '@/components/QueryErrorBanner.js';
import { formatDate } from '@breakery/utils';
import { useCustomerLoyaltyHistory } from '@/features/loyalty/hooks/useCustomerLoyaltyHistory.js';

const TXN_TONE: Record<string, string> = {
  earn: 'text-success',
  refund: 'text-success',
  redeem: 'text-danger',
  adjust: 'text-warning',
};

export function LoyaltyTab({ customerId }: { customerId: string | null }): JSX.Element {
  const { data, isLoading, isError, error, refetch } = useCustomerLoyaltyHistory(customerId);

  if (isLoading) return <Card variant="default" padding="lg"><p className="text-sm text-text-muted">Loading…</p></Card>;
  // Un échec n'est pas un historique vide : « No loyalty activity yet » sur une
  // requête tombée affirmait un fait faux sur un compte de points. Le bandeau
  // SURPLOMBE les lignes déjà chargées (échec d'un rafraîchissement), il ne
  // les remplace que s'il n'y en a aucune.
  const banner = isError ? (
    <QueryErrorBanner detail={error.message} onRetry={() => { void refetch(); }} data-testid="customer-loyalty-error">
      Loyalty history could not be loaded — this does not mean the customer has no activity.
    </QueryErrorBanner>
  ) : null;
  if (data === undefined && banner) return banner;
  if (!data || data.length === 0) {
    return <div className="space-y-3">{banner}<Card variant="default" padding="lg"><p className="text-sm text-text-muted">No loyalty activity yet.</p></Card></div>;
  }

  return (
    <div className="space-y-3">
    {banner}
    <Card variant="default" padding="none" className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">Date, type, description, points and balance per loyalty transaction</caption>
        <thead className="border-b border-border-subtle bg-surface-inert font-data text-xs font-semibold uppercase tracking-widest text-text-muted">
          <tr>
            <th scope="col" className="px-4 py-2.5 text-left font-medium">Date</th>
            <th scope="col" className="px-4 py-2.5 text-left font-medium">Type</th>
            <th scope="col" className="px-4 py-2.5 text-left font-medium">Description</th>
            <th scope="col" className="px-4 py-2.5 text-right font-medium">Points</th>
            <th scope="col" className="px-4 py-2.5 text-right font-medium">Balance</th>
          </tr>
        </thead>
        <tbody>
          {data.map((tx) => (
            <tr key={tx.id} className="border-t border-border-subtle">
              <td className="px-4 py-3 text-text-secondary">{formatDate(tx.created_at)}</td>
              <td className={`px-4 py-3 font-medium capitalize ${TXN_TONE[tx.transaction_type] ?? 'text-text-primary'}`}>{tx.transaction_type}</td>
              <td className="px-4 py-3 text-text-secondary">{tx.description}</td>
              <td className={`px-4 py-3 text-right tabular-nums font-medium ${tx.points >= 0 ? 'text-success' : 'text-danger'}`}>
                {tx.points >= 0 ? '+' : ''}{tx.points.toLocaleString('id-ID')}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-text-secondary">{tx.points_balance_after.toLocaleString('id-ID')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
    </div>
  );
}
