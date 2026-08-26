// apps/backoffice/src/features/accounting/hooks/useEntityNames.ts
//
// Résout un lot d'identifiants techniques vers des noms lisibles, pour
// l'AFFICHAGE seul (voir `utils/journalDescription.ts` pour le pourquoi).
//
// TROIS tables couvrent ce que les triggers comptables écrivent dans une
// description : `products` (mouvements de stock), `customers` (encaissements et
// ajustements B2B) et `pos_sessions` (« Shift close variance (session … ) »).
// On n'aiguille PAS sur `reference_type` pour choisir la table : l'identifiant
// du texte n'est pas celui de `reference_id` — pour un mouvement de stock, la
// référence est le mouvement et le texte porte le produit. Trois requêtes qui
// ratent proprement coûtent moins cher qu'un aiguillage qui pourrit au premier
// trigger ajouté.
//
// BEST-EFFORT ASSUMÉ : les erreurs des trois requêtes sont ignorées. Un
// comptable peut n'avoir aucun droit de lecture sur le catalogue, sur les
// clients ou sur les postes ; dans ce cas la description garde son identifiant
// brut — exactement l'état d'avant. Cet embellissement ne doit jamais faire
// échouer la page qu'il décore.
//
// CE QU'IL NE RÉSOUDRA PAS, et pourquoi. Un produit SUPPRIMÉ (soft delete)
// reste en UUID à l'écran. Ce n'est pas un filtre oublié dans la requête
// ci-dessous : la policy RLS `products.auth_read` de la base V3 vaut
// `is_authenticated() AND deleted_at IS NULL`, donc la ligne n'existe pas pour
// un client authentifié (relevé du 2026-08-26 : « Americano »
// 998c9eee-…, deleted_at 2026-06-17, invisible au client). `customers` porte la
// même clause. Contourner demanderait une RPC `SECURITY DEFINER` ou un
// assouplissement de RLS — deux gestes qui se décident, ils ne se glissent pas
// dans un embellissement d'affichage.

// CACHE PAR ENTITÉ, pas par LOT. La clé de requête était l'ensemble complet des
// identifiants triés : chaque cran « Load more » de la liste en formait un
// nouveau, donc re-résolvait TOUT depuis zéro (coût quadratique en nombre de
// crans), et le tiroir de détail, ouvert sur une ligne déjà humanisée, ne
// touchait jamais ce cache. Chaque nom vit désormais sous SA clé
// `[...ENTITY_NAMES_KEY, <uuid>]` : la requête reste groupée — un aller-retour
// pour tout un lot — mais ne demande que les identifiants ABSENTS du cache.
// Un identifiant résolu à rien (produit supprimé, cf. plus haut) s'y écrit
// `null` : c'est ce qui l'empêche d'être redemandé à chaque rendu.

import { useMemo } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDateShortWita } from '@breakery/utils';
import { supabase } from '@/lib/supabase.js';

export const ENTITY_NAMES_KEY = ['accounting', 'entity-names'] as const;

// La liste part dans l'URL d'un GET PostgREST (`in.(…)`), ~37 octets par
// identifiant : au-delà d'une centaine on dépasse les limites d'en-tête usuelles
// des proxys. On tranche en lots plutôt que de laisser la requête grandir avec
// le nombre de crans « Load more ».
const CHUNK = 100;

// Un nom d'entité ne périme pas à l'échelle d'une session de consultation :
// on le garde une demi-heure après le démontage du dernier écran qui l'observe,
// pour qu'un aller-retour liste → tiroir → liste ne le repaie pas.
const NAME_GC_TIME = 30 * 60_000;

/** Une session de caisse, telle que PostgREST la rend avec son poste embarqué. */
interface SessionRow {
  id:        string;
  opened_at: string;
  /** Le poste rattaché. `null` quand `terminal_id` est vide OU quand la policy
   *  `lan_devices` refuse la ligne — un embed refusé n'est pas une erreur. */
  terminal:  { name: string } | { name: string }[] | null;
}

/**
 * Le libellé humain d'une session de caisse : « 21 May · Register 1 », ou
 * « 21 May » quand le poste n'est pas connu.
 *
 * La description journalisée porte un `pos_sessions.id` nu — « Shift close
 * variance (session 4d11cb01-… ) ». Ce qu'un comptable cherche derrière cet
 * identifiant, c'est QUAND et OÙ : la date d'ouverture du poste et son nom.
 *
 * IL NE RÉPÈTE PAS LE NOM DE L'ENTITÉ. Un libellé « shift 21 May » rendrait
 * « (session shift 21 May) » : les NEUF formes de description qui portent un
 * identifiant nomment déjà l'entité juste avant lui — « for product … »,
 * « from customer … », « (cust … ) », « (session … ) » (relevé exhaustif sur la
 * base de développement, 2026-08-26). Ce que cette fonction rend est donc un
 * NOM, au même titre que `products.name` : la phrase fournit le nom commun.
 *
 * Le nom du poste est OPTIONNEL, et l'est en pratique presque toujours :
 * `pos_sessions.terminal_id` est nullable et 66 des 67 sessions de la base de
 * développement l'avaient vide au 2026-08-26 ; par-dessus, `lan_devices` exige
 * la permission `lan.devices.read`, qu'un profil comptable n'a pas
 * nécessairement. La date seule est donc la forme courante, et c'est déjà tout
 * ce que l'UUID ne disait pas.
 *
 * Le format de date est `formatDateShortWita` (« 21 May ») — le cran « seconde
 * ligne d'une cellule » du récapitulatif de `packages/utils/dates.ts`. On n'en
 * invente pas un septième, et l'année est déjà dans la colonne Date de la ligne.
 */
export function shiftLabel(row: SessionRow): string {
  const embedded = Array.isArray(row.terminal) ? row.terminal[0] : row.terminal;
  const station  = embedded?.name ?? '';
  const day      = formatDateShortWita(row.opened_at);
  return station === '' ? day : `${day} · ${station}`;
}

export function useEntityNames(ids: readonly string[]): ReadonlyMap<string, string> {
  const qc = useQueryClient();

  // Liste STABLE : `ids` est un tableau neuf à chaque rendu ; on dédoublonne et
  // on trie pour que l'ordre d'arrivée des lignes ne change rien.
  const key = useMemo(
    () => [...new Set(ids.map((i) => i.toLowerCase()))].sort().join(','),
    [ids],
  );
  const wanted = useMemo(() => (key === '' ? [] : key.split(',')), [key]);

  // LECTEURS DE CACHE. Une entrée par identifiant, jamais fetchée (`enabled:
  // false`) : ces observateurs existent pour lire le cache ET pour re-rendre
  // quand le résolveur ci-dessous y écrit. `undefined` = jamais résolu,
  // `null` = résolu à rien (entité supprimée ou hors RLS).
  const cached = useQueries({
    queries: wanted.map((id) => ({
      queryKey: [...ENTITY_NAMES_KEY, id],
      queryFn: (): string | null => null,
      enabled:   false,
      staleTime: Infinity,
      gcTime:    NAME_GC_TIME,
    })),
  });

  const missing = wanted.filter((_, i) => cached[i]?.data === undefined);
  const missingKey = missing.join(',');

  // RÉSOLVEUR GROUPÉ. Sa clé ne porte que les identifiants ABSENTS : un
  // « Load more » n'y met que le delta, et un tiroir ouvert sur une ligne déjà
  // humanisée ne le déclenche pas du tout.
  useQuery({
    queryKey: [...ENTITY_NAMES_KEY, 'resolve', missingKey],
    enabled: missingKey !== '',
    staleTime: Infinity,
    retry: false,
    queryFn: async (): Promise<null> => {
      const targets = missingKey.split(',');
      let partial = false;
      for (let i = 0; i < targets.length; i += CHUNK) {
        const slice = targets.slice(i, i + CHUNK);
        const [products, customers, sessions] = await Promise.all([
          supabase.from('products').select('id, name').in('id', slice),
          supabase.from('customers').select('id, name').in('id', slice),
          // Le poste vient en RESSOURCE EMBARQUÉE plutôt qu'en second
          // aller-retour : la clé étrangère `pos_sessions_terminal_id_fkey`
          // suffit à PostgREST, et la RLS de `lan_devices` s'applique à l'embed
          // seul — un profil sans `lan.devices.read` reçoit `terminal: null`,
          // pas une erreur.
          supabase.from('pos_sessions').select('id, opened_at, terminal:lan_devices(name)').in('id', slice),
        ]);
        const resolved = new Map<string, string>();
        for (const r of products.data ?? [])  resolved.set(r.id.toLowerCase(), r.name);
        for (const r of customers.data ?? []) resolved.set(r.id.toLowerCase(), r.name);
        for (const r of (sessions.data ?? []) as SessionRow[]) {
          resolved.set(r.id.toLowerCase(), shiftLabel(r));
        }
        for (const [id, name] of resolved) {
          qc.setQueryData([...ENTITY_NAMES_KEY, id], name);
        }
        // Le `null` de non-résolution ne s'écrit QUE si les trois requêtes ont
        // répondu : figer « inconnu » sur un refus passager rendrait l'UUID
        // définitif pour toute la session.
        if (products.error === null && customers.error === null && sessions.error === null) {
          for (const id of slice) {
            if (!resolved.has(id)) qc.setQueryData([...ENTITY_NAMES_KEY, id], null);
          }
        } else {
          partial = true;
        }
      }
      // BEST-EFFORT ASSUMÉ côté AFFICHAGE (cf. l'en-tête) : la carte rendue
      // porte déjà ce qui a été résolu. L'échec n'est signalé qu'à React Query,
      // pour qu'un remontage ou un retour de focus retente le reste.
      if (partial) throw new Error('entity_names_partially_resolved');
      return null;
    },
  });

  return useMemo(() => {
    const out = new Map<string, string>();
    wanted.forEach((id, i) => {
      const name = cached[i]?.data;
      if (typeof name === 'string' && name !== '') out.set(id, name);
    });
    return out;
    // `cached` est un tableau neuf à chaque rendu : la mémo ne coupe que le
    // travail, pas les re-rendus — elle reste moins chère que la carte rebâtie
    // par chaque consommateur.
  }, [wanted, cached]);
}
