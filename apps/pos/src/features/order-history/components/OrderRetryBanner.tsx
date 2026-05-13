// apps/pos/src/features/order-history/components/OrderRetryBanner.tsx
//
// Session 13 / Phase 4.A — banner shown inside OrderDetailDrawer when the
// order is `status='paid'` but no `journal_entries` row exists (rare race :
// sale JE trigger failed e.g. missing account mapping / fiscal period flip
// mid-tx). One-click button calls `retry_sale_journal_entry_v1`.

import type { JSX } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@breakery/ui';
import { toast } from 'sonner';
import { useOrderRetryStatus } from '../hooks/useOrderRetryStatus';
import { useRetryOrderJournal } from '../hooks/useRetryOrderJournal';

export interface OrderRetryBannerProps {
  orderId: string;
  /** Filtered upstream — banner only renders the probe for paid orders. */
  status: 'paid' | 'voided' | 'draft';
}

export function OrderRetryBanner({ orderId, status }: OrderRetryBannerProps): JSX.Element | null {
  const probe = useOrderRetryStatus(orderId, status);
  const retry = useRetryOrderJournal();

  // The probe is gated on status === 'paid' inside the hook ; this branch keeps
  // the early-return explicit so the component is trivially tree-shakable when
  // status is non-paid.
  if (status !== 'paid') return null;
  if (probe.isLoading || probe.isError) return null;
  if (!probe.data?.needsRetry) return null;

  async function handleRetry(): Promise<void> {
    try {
      const result = await retry.mutateAsync(orderId);
      if (result.idempotent_replay) {
        toast.info('Journal entry was already posted.');
      } else {
        toast.success('Journal entry posted successfully.');
      }
    } catch (err: unknown) {
      const e = err as { message?: string };
      toast.error(`Retry failed: ${e.message ?? 'unknown'}`);
    }
  }

  return (
    <div
      role="alert"
      data-testid="order-retry-banner"
      className="rounded-md border border-warning bg-warning-soft p-3 text-sm"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 mt-0.5 text-warning shrink-0" aria-hidden />
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-text-primary">Accounting entry missing</div>
          <p className="text-text-secondary mt-1">
            This order is paid but its journal entry didn&apos;t post (usually a transient
            backend issue). Retry will safely create the entry — duplicate posts are
            blocked by the idempotency guard.
          </p>
          <Button
            variant="secondary"
            size="sm"
            className="mt-2"
            onClick={() => { void handleRetry(); }}
            disabled={retry.isPending}
            data-testid="order-retry-banner-button"
          >
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" aria-hidden />
            {retry.isPending ? 'Retrying…' : 'Retry journal entry'}
          </Button>
        </div>
      </div>
    </div>
  );
}
