// apps/backoffice/src/components/DetailPageSkeleton.tsx
//
// LA SILHOUETTE D'UNE PAGE DE DÉTAIL pendant que sa requête tourne.
//
// Trois écrans de détail (bon de commande, recette, comptage) rendaient un mot
// gris — « Loading… », « Loading recipe… », « Loading count… » — là où le reste
// du back-office rend déjà une silhouette : `RouteFallback` du shell pour un
// chunk de route, `DataTable` pour un tableau. Un mot ne dit ni ce qui arrive
// ni combien il en reste ; la silhouette garde la forme de la page, donc l'œil
// reste posé où le contenu va apparaître.
//
// DESIGN.md § Do's : « utiliser le papier pressé pour les squelettes de
// chargement posés sur une carte blanche ». C'est exactement ce que porte le
// primitif `Skeleton` (`bg-surface-4`), qui coupe aussi sa pulsation sous
// `prefers-reduced-motion`. On ne redéfinit donc aucune couleur ici.
//
// L'annonce d'accessibilité est portée par le CONTENEUR (`aria-busy` +
// `aria-live`), jamais par chaque barre : les barres sont `aria-hidden` par
// construction. Même geste que `RouteFallback`.

import type { JSX } from 'react';
import { Skeleton } from '@breakery/ui';

export interface DetailPageSkeletonProps {
  /** Ce qui charge, pour le lecteur d'écran : « Loading purchase order ». */
  label: string;
  /** Nombre de blocs de corps sous la bande de titre. Défaut : 2. */
  blocks?: number;
  'data-testid'?: string;
}

export function DetailPageSkeleton({
  label,
  blocks = 2,
  'data-testid': testId,
}: DetailPageSkeletonProps): JSX.Element {
  return (
    <div
      className="flex flex-col gap-5"
      aria-busy="true"
      aria-live="polite"
      aria-label={label}
      data-testid={testId}
    >
      {/* Bande de titre : fil d'Ariane, puis titre, puis sous-titre. */}
      <div className="flex flex-col gap-2">
        <Skeleton width="14rem" height="0.75rem" />
        <Skeleton width="18rem" height="1.75rem" />
        <Skeleton width="11rem" />
      </div>
      {Array.from({ length: blocks }).map((_, i) => (
        <Skeleton key={i} variant="block" height={i === 0 ? '7rem' : '18rem'} />
      ))}
    </div>
  );
}
