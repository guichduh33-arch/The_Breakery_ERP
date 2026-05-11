// apps/backoffice/src/features/loyalty/components/LoyaltyHistoryDrawer.tsx
//
// Read-only ledger view for one customer. Last 50 entries.

import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@breakery/ui';
import { useCustomerLoyaltyHistory, type LoyaltyTxnRow } from '../hooks/useCustomerLoyaltyHistory.js';
import type { CustomerListRow } from '../hooks/useLoyaltyCustomersList.js';

export interface LoyaltyHistoryDrawerProps {
  customer: CustomerListRow | undefined;
  onClose:  () => void;
}

const TYPE_LABEL: Record<LoyaltyTxnRow['transaction_type'], string> = {
  earn:   'Earn',
  redeem: 'Redeem',
  adjust: 'Adjust',
  refund: 'Refund',
};

export function LoyaltyHistoryDrawer({ customer, onClose }: LoyaltyHistoryDrawerProps) {
  const open = customer !== undefined;
  const q = useCustomerLoyaltyHistory(customer?.id ?? null);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogTitle>{customer?.name} — Loyalty history</DialogTitle>
        <DialogDescription>Most recent 50 transactions.</DialogDescription>

        {q.isLoading && <div className="text-text-secondary py-12 text-center">Loading…</div>}
        {q.error && <div className="text-red py-12 text-center">{q.error.message}</div>}
        {q.data?.length === 0 && <div className="text-text-secondary py-12 text-center">No transactions yet.</div>}
        {q.data && q.data.length > 0 && (
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-widest text-text-secondary">
              <tr>
                <th className="px-2 py-1 text-left">When</th>
                <th className="px-2 py-1 text-left">Type</th>
                <th className="px-2 py-1 text-right">Points</th>
                <th className="px-2 py-1 text-right">Balance after</th>
                <th className="px-2 py-1 text-left">Description</th>
                <th className="px-2 py-1 text-left">Author</th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((row) => (
                <tr key={row.id} className="border-t border-border-subtle">
                  <td className="px-2 py-1 text-text-secondary">{new Date(row.created_at).toLocaleString()}</td>
                  <td className="px-2 py-1">{TYPE_LABEL[row.transaction_type]}</td>
                  <td className={`px-2 py-1 text-right font-mono ${row.points >= 0 ? 'text-green' : 'text-red'}`}>
                    {row.points >= 0 ? '+' : ''}{row.points}
                  </td>
                  <td className="px-2 py-1 text-right font-mono">{row.points_balance_after}</td>
                  <td className="px-2 py-1">{row.description}</td>
                  <td className="px-2 py-1 text-text-secondary">{row.author?.full_name ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </DialogContent>
    </Dialog>
  );
}
