// apps/pos/src/features/payment/components/RetryBanner.tsx
// Iso-behaviour extraction of PaymentTerminal's idempotency banners.
// Renders the retryable banner OR the already-paid banner from `lastError`.
// data-testids preserved byte-for-byte (consumed by PaymentTerminal.idempotency.test).

import { AlertCircle, CheckCircle2, RefreshCw } from 'lucide-react';
import { Button } from '@breakery/ui';
import type { RetryClassification } from '@breakery/domain';

export interface RetryBannerProps {
  lastError: RetryClassification | null;
  checkoutPending: boolean;
  onRetry: () => void;
  onDismissAlreadyPaid: () => void;
}

export function RetryBanner({
  lastError,
  checkoutPending,
  onRetry,
  onDismissAlreadyPaid,
}: RetryBannerProps) {
  if (lastError?.kind === 'retryable') {
    return (
      <div
        role="alert"
        data-testid="payment-retry-banner"
        className="mb-4 rounded-md border border-warning bg-warning-soft p-3 text-sm"
      >
        <div className="flex items-start gap-2">
          <AlertCircle className="h-4 w-4 mt-0.5 text-warning shrink-0" aria-hidden />
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-text-primary">Payment did not reach the server</div>
            <p className="text-text-secondary mt-1">{lastError.userMessage}</p>
            <Button
              variant="secondary"
              size="sm"
              className="mt-2"
              onClick={onRetry}
              disabled={checkoutPending}
              data-testid="payment-retry-button"
            >
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" aria-hidden />
              {checkoutPending ? 'Retrying…' : 'Retry payment'}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (lastError?.kind === 'already_paid') {
    return (
      <div
        role="alert"
        data-testid="payment-already-paid-banner"
        className="mb-4 rounded-md border border-success bg-success-soft p-3 text-sm"
      >
        <div className="flex items-start gap-2">
          <CheckCircle2 className="h-4 w-4 mt-0.5 text-success shrink-0" aria-hidden />
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-text-primary">Order already finalized</div>
            <p className="text-text-secondary mt-1">{lastError.userMessage}</p>
            <Button
              variant="secondary"
              size="sm"
              className="mt-2"
              onClick={onDismissAlreadyPaid}
              data-testid="payment-already-paid-dismiss"
            >
              Continue
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // S43 P0-1b — fatal errors used to surface only as a 4 s toast, easy to miss.
  // Render a persistent banner (no Retry — fatal means "fix the cart, don't
  // replay the same key"). It clears on the next checkout attempt
  // (dispatchCheckout resets lastError) — same lifecycle as the other banners.
  if (lastError?.kind === 'fatal') {
    return (
      <div
        role="alert"
        data-testid="payment-fatal-banner"
        className="mb-4 rounded-md border border-danger/40 bg-danger-soft p-3 text-sm"
      >
        <div className="flex items-start gap-2">
          <AlertCircle className="h-4 w-4 mt-0.5 text-danger shrink-0" aria-hidden />
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-danger">Payment failed</div>
            <p className="text-text-secondary mt-1">{lastError.userMessage}</p>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
