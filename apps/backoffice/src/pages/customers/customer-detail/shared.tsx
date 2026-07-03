// apps/backoffice/src/pages/customers/customer-detail/shared.tsx
//
// Shared helpers for the CustomerDetailPage tab panels (co-located split, S57
// E-D4). Pure presentation — no behaviour change vs the original inline code.

import type { JSX } from 'react';
import { formatIdr } from '@breakery/utils';

/** Format a numeric/string/null amount as IDR. */
export function rp(amount: number | string | null): string {
  return formatIdr(Number(amount ?? 0));
}

export function StatusPill({ status }: { status: string }): JSX.Element {
  const tone =
    status === 'completed' || status === 'paid'
      ? 'bg-emerald-100 text-emerald-700'
      : status === 'voided'
        ? 'bg-rose-100 text-rose-700'
        : status === 'pending_payment' || status === 'b2b_pending'
          ? 'bg-amber-100 text-amber-700'
          : 'bg-gray-100 text-gray-600';
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${tone}`}>
      {status}
    </span>
  );
}
