// apps/backoffice/src/pages/customers/customer-detail/shared.tsx
//
// Shared helpers for the CustomerDetailPage tab panels (co-located split, S57
// E-D4). Pure presentation — no behaviour change vs the original inline code.

import type { JSX } from 'react';
import { formatCurrency } from '@breakery/utils';

/** Format a numeric/string/null amount as IDR. */
export function rp(amount: number | string | null): string {
  return formatCurrency(Number(amount ?? 0));
}

// Badge carré (coins 3 px), label mono capitales — la pilule arrondie lisait
// « application grand public », pas « instrument ».
export function StatusPill({ status }: { status: string }): JSX.Element {
  const tone =
    status === 'completed' || status === 'paid'
      ? 'bg-success-soft text-success'
      : status === 'voided'
        ? 'bg-danger-soft text-danger'
        : status === 'pending_payment' || status === 'b2b_pending'
          ? 'bg-warning-soft text-warning'
          : 'bg-surface-4 text-text-muted';
  return (
    <span className={`inline-flex rounded-sm px-1.5 py-0.5 font-data text-[10px] font-semibold uppercase tracking-widest ${tone}`}>
      {status.replace('_', ' ')}
    </span>
  );
}
