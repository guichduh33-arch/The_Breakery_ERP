// apps/pos/src/components/ErrorState.tsx
//
// Reusable error panel with an optional "Retry" action. Use wherever a fetch
// can fail (boot rehydration, page-level query errors) instead of showing an
// empty state that misleads the operator into thinking there's no data.
// Keep technical detail OUT of the copy — log it to the console/monitoring.

import { AlertTriangle } from 'lucide-react';
import { Button } from '@breakery/ui';

export interface ErrorStateProps {
  title?: string;
  description?: string;
  onRetry?: () => void;
  retryLabel?: string;
  secondaryAction?: { label: string; onClick: () => void };
  fullScreen?: boolean;
}

export function ErrorState({
  title = 'Something went wrong',
  description = 'Unable to load data. Check your connection and try again.',
  onRetry,
  retryLabel = 'Retry',
  secondaryAction,
  fullScreen = false,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={
        fullScreen
          ? 'h-[100dvh] grid place-items-center bg-bg-base p-8'
          : 'grid place-items-center py-16 px-8'
      }
    >
      <div className="max-w-sm text-center space-y-4">
        <AlertTriangle className="h-10 w-10 text-red-as-text mx-auto" aria-hidden />
        <div className="space-y-1">
          <h2 className="font-sans text-xl font-semibold text-text-primary">{title}</h2>
          <p className="text-text-secondary text-sm">{description}</p>
        </div>
        {(onRetry ?? secondaryAction) && (
          <div className="flex items-center justify-center gap-3 pt-2">
            {onRetry && (
              <Button onClick={onRetry} variant="primary">
                {retryLabel}
              </Button>
            )}
            {secondaryAction && (
              <Button onClick={secondaryAction.onClick} variant="ghost">
                {secondaryAction.label}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
