// apps/backoffice/src/features/orders/components/RowActionButton.tsx
//
// Bouton d'action de ligne (32 px, icône seule) — extrait de la page Orders
// (review PR #367, budget de 500 lignes). Même dessin que l'action de ligne
// de la table Products ; l'extraction en primitif partagé multi-features est
// un chantier de kit distinct.
//
// 32 px, et non 24, depuis la critique du 2026-08-21 (P1-2) : la cible qui
// porte `Void` faisait 24×24 à 2 px d'une cible bénigne. Le plancher WCAG
// 2.5.8 était atteint par la seule grâce d'un espacement que l'œil ne voit
// pas. La taille et l'écart se corrigent ensemble — l'un sans l'autre ne
// change rien au risque de cliquer le mauvais bouton.

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
        'inline-flex h-8 w-8 items-center justify-center rounded-sm text-text-subtle transition-colors',
        destructive ? 'hover:bg-red-soft hover:text-danger' : 'hover:bg-surface-4 hover:text-text-primary',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold',
      )}
    >
      {children}
    </button>
  );
}
