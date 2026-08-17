// apps/backoffice/src/components/QueryErrorBanner.tsx
//
// Le bandeau d'erreur des pages de liste — UNE définition, trois appelants.
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

import type { JSX, ReactNode } from 'react';

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
      className="rounded-md border border-red bg-red-soft p-3 text-sm text-red-as-text"
    >
      {children}
      {detail !== undefined && detail !== '' && (
        <span className="ml-1 font-data text-xs">{detail}</span>
      )}{' '}
      <button type="button" className="underline" onClick={onRetry}>
        Try again
      </button>
    </p>
  );
}
