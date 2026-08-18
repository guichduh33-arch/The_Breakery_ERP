// apps/backoffice/src/components/QueryErrorBanner.tsx
//
// Le bandeau d'erreur des pages de liste — UNE définition, cinq appelants
// (B2BOrdersPage ×2, OrdersListPage ×2, Products ×1).
//
// Il ne remplace PAS `ErrorState` : celui-ci est le patron des frontières
// d'erreur (`App`, `AppErrorBoundary`, `RouteErrorBoundary`), où la page entière
// a échoué et où il n'y a plus rien à lire. Ici c'est l'inverse — une REQUÊTE a
// échoué, la page tient debout, et les lignes déjà chargées restent lisibles.
//
// Le patron vient d'`OrdersListPage` (review PR #367), la seule instance qui le
// tenait :
//   · le bandeau SURPLOMBE la table, il ne la remplace pas ;
//   · une phrase humaine dit ce qui est en jeu (« les lignes ci-dessous peuvent
//     être périmées »), le message SERVEUR est relégué en `font-data text-xs` —
//     il est du diagnostic, pas de l'information ;
//   · « Try again » est câblé sur `refetch`. Sans lui, la seule issue offerte à
//     l'opérateur était de recharger la page, ce qui lui faisait perdre ses
//     filtres.
//
// `role="alert"` et non `role="status"` : l'échec d'un rafraîchissement
// interrompt ce que l'opérateur croyait à jour, il ne peut pas attendre une
// pause dans la lecture.

// FOND FEUILLE BLANCHE, pas l'aplat rouge translucide (mesuré le 2026-08-18).
// `bg-red-soft` vaut `rgba(180,52,44,0.12)` : il ne remplace pas le fond, il s'y
// compose. Les CINQ sites d'appel posent ce bandeau en enfant direct de la
// colonne de page, donc sur le papier gradué — et non sur une carte :
//   · sur le papier `#f0efec`   → composite rgb(233,217,213), 4,426:1  ✗
//   · sur un point de grille `#dfddd6` → composite rgb(218,201,194), 3,781:1  ✗
//   · sur la feuille blanche    → composite rgb(246,231,230), 5,043:1  ✓
// Autrement dit, le texte qui prévient que les lignes peuvent être périmées
// était le moins lisible de la page. Posé sur la feuille blanche
// (`bg-bg-elevated` = `--surface-2` = `#ffffff` ; il n'existe AUCUNE famille
// `sheet` dans le preset, `bg-sheet` serait une classe morte), `--red-as-text`
// (#b4342c) vaut 6,055:1 sans aucune composition, et le liseré `border-red` tient
// WCAG 1.4.11 sur tous les fonds voisins (5,266:1 papier, 4,455:1 point de
// grille, 6,055:1 feuille) — c'est lui, désormais, qui porte le signal rouge.

import type { JSX, ReactNode } from 'react';
import { FOCUS_RING } from '@/components/focusRing.js';

export interface QueryErrorBannerProps {
  /** La phrase humaine — ce qui a échoué, et ce que ça change pour le lecteur. */
  children: ReactNode;
  /** Message brut du serveur. Diagnostic : petit, mono, jamais en tête. */
  detail?: string | undefined;
  onRetry: () => void;
  'data-testid'?: string;
}

export function QueryErrorBanner({
  children, detail, onRetry, 'data-testid': testId,
}: QueryErrorBannerProps): JSX.Element {
  return (
    <p
      role="alert"
      data-testid={testId}
      className="rounded-md border border-red bg-bg-elevated p-3 text-sm text-red-as-text"
    >
      {children}
      {detail !== undefined && detail !== '' && (
        <span className="ml-1 font-data text-xs">{detail}</span>
      )}{' '}
      {/* Seul contrôle d'un composant partagé par cinq appelants — il n'avait
          aucun anneau de focus, dans la branche même où `DataTable` en recevait
          un. L'anneau par défaut du navigateur est mesuré à 2,09-2,40:1, sous
          les 3:1 de WCAG 1.4.11 (cf. focusRing.ts). */}
      <button type="button" className={`rounded-sm underline ${FOCUS_RING}`} onClick={onRetry}>
        Try again
      </button>
    </p>
  );
}
