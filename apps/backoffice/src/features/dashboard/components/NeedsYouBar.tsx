// apps/backoffice/src/features/dashboard/components/NeedsYouBar.tsx
//
// Écran 1c — « Needs you », la file d'actions, posée AU-DESSUS des chiffres.
//
// C'est le renversement de l'écran : un dashboard qui commence par le CA raconte
// la journée d'hier ; celui-ci commence par le travail qui reste. Chaque ligne
// est un fait vérifiable doublé de sa destination de résolution — rien ne se
// « marque comme lu », une ligne disparaît quand le fait qui la produit
// disparaît (la RPC les recalcule à chaque appel).
//
// Le filtrage par droit est fait SERVEUR, source par source : un caissier reçoit
// une file vide, pas une file d'items inertes. Ici on ne fait donc que rendre.

import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Check, ListChecks } from 'lucide-react';
import { Card, cn } from '@breakery/ui';
import type { ActionQueue, ActionSeverity } from '../hooks/useDashboardPanels.js';

const DOT: Record<ActionSeverity, string> = {
  blocking: 'bg-danger',
  warning:  'bg-warning',
  info:     'bg-info',
};

const CELL = 'flex min-w-0 flex-1 items-center gap-2.5 border-r border-border-muted px-3.5 py-2.5 last:border-r-0 hover:bg-surface-4';

export function NeedsYouBar({
  queue,
  isLoading,
  isRestricted = false,
}: {
  queue: ActionQueue | null;
  isLoading: boolean;
  /** La RPC a répondu 42501 — le rôle n'a aucune des permissions sources. */
  isRestricted?: boolean;
}): JSX.Element | null {
  // Restreint = « cette carte ne vous est pas destinée ». On ne rend rien
  // plutôt qu'un bandeau vide qui occuperait la première ligne de l'écran.
  if (isRestricted) return null;

  if (isLoading && queue === null) {
    return (
      <Card
        variant="default"
        padding="none"
        className="h-[41px] animate-pulse shadow-none motion-reduce:animate-none"
        data-testid="needs-you-skeleton"
      />
    );
  }

  const items = queue?.items ?? [];

  return (
    <Card
      variant="default"
      padding="none"
      className="flex items-stretch overflow-hidden shadow-none"
      data-testid="needs-you-bar"
      aria-label="Actions needing attention"
    >
      <div className="flex shrink-0 items-center gap-2 border-r border-border-muted px-3.5 py-2.5">
        <ListChecks className="h-3.5 w-3.5 text-text-muted" aria-hidden />
        <span className="font-data text-[10.5px] font-semibold uppercase tracking-widest text-text-primary">
          Needs you
        </span>
        {items.length > 0 && (
          <span className="inline-flex min-w-[17px] justify-center rounded-[9px] bg-danger px-1 py-px font-data text-[10px] font-bold text-red-fg">
            {queue?.total ?? items.length}
          </span>
        )}
      </div>

      {items.length === 0 ? (
        <div className="flex flex-1 items-center gap-2 px-3.5 py-2.5 text-[13px] text-text-secondary">
          <Check className="h-3.5 w-3.5 text-success" aria-hidden />
          Nothing needs you right now.
        </div>
      ) : (
        items.map((item) => (
          <Link key={item.key} to={item.to} className={CELL} data-testid={`needs-you-${item.key}`}>
            <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', DOT[item.severity])} aria-hidden />
            <span className="truncate text-[13px] text-text-primary">{item.label}</span>
            <span className="ml-auto shrink-0 text-xs font-medium text-gold">{item.action}</span>
          </Link>
        ))
      )}

      {items.some((i) => i.severity === 'blocking') && (
        <div className="flex shrink-0 items-center gap-1.5 border-l border-border-muted px-3.5 py-2.5">
          <AlertTriangle className="h-3.5 w-3.5 text-danger" aria-hidden />
          <span className="text-xs text-text-secondary">blocking</span>
        </div>
      )}
    </Card>
  );
}
