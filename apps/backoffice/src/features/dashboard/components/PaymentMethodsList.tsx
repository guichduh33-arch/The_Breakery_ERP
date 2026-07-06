// apps/backoffice/src/features/dashboard/components/PaymentMethodsList.tsx
// S63 — encaissements du jour par moyen de paiement (montant + part %).

import { EmptyState } from '@breakery/ui';
import { formatIdrFull } from '@/features/reports/utils/chartColors.js';
import type { PaymentMethodLine } from '../hooks/useDashboardOverview.js';

export function PaymentMethodsList({ data }: { data: PaymentMethodLine[] }) {
  if (data.length === 0) {
    return (
      <div className="h-40 flex items-center justify-center">
        <EmptyState size="sm" title="No payments yet" />
      </div>
    );
  }
  const total = data.reduce((s, m) => s + m.amount, 0);
  return (
    <ul className="space-y-2">
      {data.map((m) => (
        <li key={m.method} className="flex items-center gap-3 text-sm">
          <span className="flex-1 truncate text-text-primary">{m.method}</span>
          <span className="text-text-muted tabular-nums">
            {total > 0 ? Math.round((m.amount / total) * 100) : 0}%
          </span>
          <span className="text-text-primary tabular-nums">{formatIdrFull(m.amount)}</span>
        </li>
      ))}
    </ul>
  );
}
