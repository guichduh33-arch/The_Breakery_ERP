// apps/backoffice/src/components/Breadcrumb.tsx
//
// Le fil d'Ariane de l'ossature commune (DESIGN.md § Page Archetypes) : 12 px,
// segments séparés par un chevron, le dernier segment est la page courante.
//
// Il existait recopié à la main sur Orders et la fiche commande, et les autres
// pages du domaine Sales l'écrivaient chacune à sa façon (« B2B › Orders »,
// lien « ← Back to… » souligné, ou rien) — audit Sales du 2026-11-21. Un seul
// composant, un seul vocabulaire : chaque page de Sales commence par « Sales ».

import { Fragment, type JSX } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { cn } from '@breakery/ui';
import { FOCUS_RING } from '@/components/focusRing.js';

export interface BreadcrumbItem {
  label: string;
  /** Absent = segment non navigable (section du menu, page courante). Présent,
   *  le segment reste un lien même en dernière position : une fiche en erreur
   *  n'a pas encore de feuille, et son retour vers la liste doit rester un lien. */
  to?: string;
  /** Identifiant d'objet (numéro de commande) : rendu en mono tabulaire. */
  mono?: boolean;
}

export function Breadcrumb({ items }: { items: readonly BreadcrumbItem[] }): JSX.Element {
  return (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-xs text-text-muted">
      {items.map((item, i) => {
        const last = i === items.length - 1;
        return (
          <Fragment key={`${item.label}-${i}`}>
            {i > 0 && <ChevronRight className="h-3 w-3 text-text-inert" aria-hidden />}
            {item.to !== undefined ? (
              <Link to={item.to} className={cn('rounded-sm hover:text-text-primary', FOCUS_RING)}>
                {item.label}
              </Link>
            ) : (
              <span
                className={cn(last && 'text-text-secondary', item.mono === true && 'font-data tabular-nums')}
                {...(last ? { 'aria-current': 'page' as const } : {})}
              >
                {item.label}
              </span>
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}
