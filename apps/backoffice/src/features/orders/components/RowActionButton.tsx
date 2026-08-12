// apps/backoffice/src/features/orders/components/RowActionButton.tsx
//
// Bouton d'action de ligne (24 px, icône seule) — extrait de la page Orders
// (review PR #367, budget de 500 lignes). Même dessin que l'action de ligne
// de la table Products ; l'extraction en primitif partagé multi-features est
// un chantier de kit distinct.

import type { JSX } from 'react';
import { cn } from '@breakery/ui';

export function RowActionButton({
  label, onClick, destructive = false, testId, children,
}: {
  label: string;
  onClick: () => void;
  destructive?: boolean;
  testId?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      data-testid={testId}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={cn(
        'inline-flex h-6 w-6 items-center justify-center rounded-sm text-text-subtle transition-colors',
        destructive ? 'hover:bg-red-soft hover:text-danger' : 'hover:bg-surface-4 hover:text-text-primary',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold',
      )}
    >
      {children}
    </button>
  );
}
