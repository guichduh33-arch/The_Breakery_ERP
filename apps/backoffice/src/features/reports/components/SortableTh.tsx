// apps/backoffice/src/features/reports/components/SortableTh.tsx
//
// Lot G (campagne Reports 2026-08-15) — l'en-tête de colonne triable, posé une
// fois pour les quatre journaux du lot. Extension ADDITIVE du socle : elle ne
// remplace rien et aucune page migrée avant ce lot n'en dépend.
//
// Deux points d'accessibilité qui justifient un composant plutôt qu'un copier-
// coller de `<th>` :
//
//  · L'état de tri s'annonce par `aria-sort` SUR LE `<th>`, jamais par la
//    couleur ou la seule icône. C'est le mécanisme du pattern `table` de
//    WAI-ARIA, et le seul que restitue un lecteur d'écran.
//  · Le déclencheur est un vrai `<button>` DANS le `<th>` — donc atteignable au
//    clavier, avec l'anneau de focus maison. Un `onClick` posé sur le `<th>`
//    lui-même ne l'est pas : c'est exactement le défaut que le lot A2 a corrigé
//    sur les lignes dépliables.
//
// L'icône est décorative (`aria-hidden`) : elle double l'information portée par
// `aria-sort`, elle ne la remplace pas.

import type { JSX } from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { cn } from '@breakery/ui';
import { FOCUS_RING } from '@/components/focusRing.js';
import type { SortControl } from '../hooks/useSortedRows.js';

export interface SortableThProps<K extends string> {
  label: string;
  /** Absente, l'en-tête est INERTE : pas de bouton, pas d'`aria-sort`. Toutes
   *  les colonnes ne se trient pas (un JSON de contexte n'a pas d'ordre). */
  sortKey?: K;
  align?: 'left' | 'right';
  sorted: SortControl<K>;
  className?: string;
}

export function SortableTh<K extends string>({
  label, sortKey, align = 'left', sorted, className,
}: SortableThProps<K>): JSX.Element {
  const cell = cn(
    'py-2 font-medium',
    align === 'right' ? 'text-right' : 'text-left',
    className,
  );

  if (sortKey === undefined) {
    return <th scope="col" className={cell}>{label}</th>;
  }

  const active = sorted.sort !== null && sorted.sort.key === sortKey;
  const Icon = !active ? ChevronsUpDown : sorted.sort?.dir === 'asc' ? ArrowUp : ArrowDown;

  return (
    <th scope="col" aria-sort={sorted.ariaSort(sortKey)} className={cell}>
      <button
        type="button"
        onClick={() => { sorted.toggle(sortKey); }}
        data-testid={`sort-${sortKey}`}
        className={cn(
          'inline-flex items-center gap-1 rounded-sm',
          // Aligné à droite, l'icône passe AVANT le libellé : elle reste
          // collée au bord de la colonne, comme les chiffres qu'elle range.
          align === 'right' && 'flex-row-reverse',
          active ? 'text-text-primary' : 'hover:text-text-primary',
          FOCUS_RING,
        )}
      >
        {label}
        <Icon
          className={cn('h-3 w-3', active ? 'text-text-primary' : 'text-text-inert')}
          aria-hidden
        />
      </button>
    </th>
  );
}
