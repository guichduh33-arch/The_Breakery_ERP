// apps/backoffice/src/features/accounting/hooks/useEntityNames.ts
//
// Résout un lot d'identifiants techniques vers des noms lisibles, pour
// l'AFFICHAGE seul (voir `utils/journalDescription.ts` pour le pourquoi).
//
// Deux tables suffisent à couvrir ce que les triggers comptables écrivent dans
// une description : `products` (mouvements de stock) et `customers`
// (encaissements et ajustements B2B). On n'aiguille PAS sur `reference_type`
// pour choisir la table : l'identifiant du texte n'est pas celui de
// `reference_id` — pour un mouvement de stock, la référence est le mouvement et
// le texte porte le produit. Deux requêtes qui ratent proprement coûtent moins
// cher qu'un aiguillage qui pourrit au premier trigger ajouté.
//
// BEST-EFFORT ASSUMÉ : les erreurs des deux requêtes sont ignorées. Un
// comptable peut n'avoir aucun droit de lecture sur le catalogue ou sur les
// clients ; dans ce cas la description garde son identifiant brut — exactement
// l'état d'avant. Cet embellissement ne doit jamais faire échouer la page qu'il
// décore.

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export const ENTITY_NAMES_KEY = ['accounting', 'entity-names'] as const;

// La liste part dans l'URL d'un GET PostgREST (`in.(…)`), ~37 octets par
// identifiant : au-delà d'une centaine on dépasse les limites d'en-tête usuelles
// des proxys. On tranche en lots plutôt que de laisser la requête grandir avec
// le nombre de crans « Load more ».
const CHUNK = 100;

const EMPTY: ReadonlyMap<string, string> = new Map();

export function useEntityNames(ids: readonly string[]): ReadonlyMap<string, string> {
  // Clé STABLE : `ids` est un tableau neuf à chaque rendu, et un tri rend la
  // clé indépendante de l'ordre d'arrivée des lignes.
  const key = useMemo(() => [...ids].sort().join(','), [ids]);

  const query = useQuery<ReadonlyMap<string, string>>({
    queryKey: [...ENTITY_NAMES_KEY, key],
    enabled: key !== '',
    staleTime: 5 * 60_000,
    retry: false,
    // Un « Load more » ajoute des identifiants, donc change la clé : sans ceci
    // les noms déjà affichés retomberaient sur leur UUID le temps du refetch.
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const wanted = key.split(',');
      const out = new Map<string, string>();
      for (let i = 0; i < wanted.length; i += CHUNK) {
        const slice = wanted.slice(i, i + CHUNK);
        const [products, customers] = await Promise.all([
          supabase.from('products').select('id, name').in('id', slice),
          supabase.from('customers').select('id, name').in('id', slice),
        ]);
        for (const r of products.data ?? [])  out.set(r.id.toLowerCase(), r.name);
        for (const r of customers.data ?? []) out.set(r.id.toLowerCase(), r.name);
      }
      return out;
    },
  });

  return query.data ?? EMPTY;
}
