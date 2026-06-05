// apps/backoffice/src/components/ErrorState.tsx
//
// Reusable error panel with an optional "Retry" action. Use anywhere a data
// fetch can fail (page-level query errors, the boot rehydration screen, etc.)
// instead of silently degrading the UI. Keep the technical detail OUT of the
// user-facing copy — log it to the console/monitoring instead.

import { AlertTriangle } from 'lucide-react';
import { Button } from '@breakery/ui';

export interface ErrorStateProps {
  /** User-facing title. Defaults to a generic message. */
  title?: string;
  /** User-facing description. Keep it non-technical. */
  description?: string;
  /** When provided, renders a "Retry" button wired to this handler. */
  onRetry?: () => void;
  /** Optional secondary action (e.g. "Sign out") rendered next to Retry. */
  secondaryAction?: { label: string; onClick: () => void };
  /** When true, fills the viewport (used by the boot screen). */
  fullScreen?: boolean;
}

export function ErrorState({
  title = 'Une erreur est survenue',
  description = 'Impossible de charger les données. Vérifiez votre connexion et réessayez.',
  onRetry,
  secondaryAction,
  fullScreen = false,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={
        fullScreen
          ? 'min-h-screen grid place-items-center bg-bg-base p-8'
          : 'grid place-items-center py-16 px-8'
      }
    >
      <div className="max-w-sm text-center space-y-4">
        <AlertTriangle className="h-10 w-10 text-red mx-auto" aria-hidden />
        <div className="space-y-1">
          <h2 className="font-serif text-xl text-text-primary">{title}</h2>
          <p className="text-text-secondary text-sm">{description}</p>
        </div>
        {(onRetry || secondaryAction) && (
          <div className="flex items-center justify-center gap-3 pt-2">
            {onRetry && (
              <Button onClick={onRetry} variant="primary">
                Réessayer
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
