// apps/backoffice/src/hooks/useListParams.ts
//
// L'état de liste vit dans l'URL — le geste d'écriture, en un seul endroit.
//
// Deux pages portaient ce bloc MOT POUR MOT (`Products.tsx`, `OrdersListPage`)
// et une troisième ne l'avait pas du tout (`B2BOrdersPage`, dont le filtre et
// les lignes dépliées vivaient en `useState` : rien de partageable, rien qui
// survive au retour arrière). Une duplication qui se répare à deux endroits
// finit par diverger ; c'est déjà arrivé une fois sur ce même bloc.
//
// DEUX PIÈGES sont gravés ici, chacun payé une fois :
//
//   1. `setSearchParams` reçoit les paramètres COURANTS, pas un delta. Deux
//      appels dans le même geste s'écrasent donc l'un l'autre — d'où un patch
//      UNIQUE qui écrit le filtre ET la remise en page 1 d'un seul mouvement.
//      (Products.tsx, avant extraction.)
//
//   2. La forme FONCTIONNELLE `setParams(prev => …)` est obligatoire, et
//      `setParams` doit rester dans les dépendances du `useCallback`. Un
//      `patchParams` figé capturait un `setSearchParams` clos sur une URL
//      périmée : un clic de compteur pendant un refetch écrasait les filtres
//      (review PR #367, OrdersListPage).
//
// `replace: true` partout : régler un filtre n'est pas une étape de navigation,
// et empiler une entrée d'historique par frappe rendrait le bouton Retour
// inutilisable.

import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Applique un patch de paramètres d'URL. Une valeur `null` ou `''` SUPPRIME la
 * clé — c'est ce qui garde une URL propre quand un filtre retombe sur son
 * défaut.
 */
export type PatchParams = (patch: Record<string, string | null>) => void;

export function useListParams(): readonly [URLSearchParams, PatchParams] {
  const [params, setParams] = useSearchParams();

  const patchParams = useCallback<PatchParams>((patch) => {
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === '') p.delete(k);
        else p.set(k, v);
      }
      return p;
    }, { replace: true });
  }, [setParams]);

  return [params, patchParams] as const;
}
