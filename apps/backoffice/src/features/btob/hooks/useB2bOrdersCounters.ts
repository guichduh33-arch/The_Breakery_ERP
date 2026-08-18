// apps/backoffice/src/features/btob/hooks/useB2bOrdersCounters.ts
//
// Les compteurs de la liste B2B — comptés PAR LE SERVEUR.
//
// Ils dérivaient des lignes reçues : au plafond de 500 de l'ancien hook, les
// quatre tuiles comptaient 500 factures en se présentant comme le tout. Dès que
// la liste est fenêtrée, un compte en mémoire ne compte plus que la fenêtre — il
// fallait donc les sortir du client, pas seulement les recâbler.
//
// Deux sources, aucune neuve :
//   · trois `count: 'exact', head: true` sur `view_b2b_invoices` — head, donc
//     zéro ligne transportée pour un nombre ;
//   · `get_b2b_dashboard_counters_v1` pour l'ENCOURS, qu'elle rend déjà
//     (`outstanding_ar`) et que le dashboard B2B lit depuis l'ADR-026.
//
// CHAQUE COMPTEUR PORTE LE PRÉDICAT EXACT DE SON FILTRE (2026-08-18).
// « Réglées » était `total − impayées`, où « impayées » compte
// `outstanding > 0`. Or `> 0` et `<= 0` ne partitionnent pas une colonne
// NULLABLE : une facture à `outstanding IS NULL` échappe aux deux, elle était
// donc comptée « réglée » par la tuile ET absente de la table que cette tuile
// filtre (`useB2bOrdersList` : `.lte('outstanding', 0)`). Dans l'archétype List
// le compteur EST le filtre — c'est la seule voie par laquelle il peut mentir.
// On compte désormais « réglées » avec `.lte('outstanding', 0)`, le prédicat
// littéral du filtre. Le troisième aller-retour est un `head: true` : il ne
// transporte rien, et il achète l'égalité tuile/table quel que soit ce que la
// vue garantit — on ne fait donc reposer aucune exactitude d'affichage sur une
// nullabilité de schéma non vérifiée.
//
// Conséquence assumée : `total` peut être supérieur à `unpaid + paid`. C'est
// exact, et c'est l'information — l'écart, s'il apparaît, dit qu'il existe des
// lignes qu'aucun des deux filtres n'atteint.
//
// Les compteurs couvrent TOUT le registre, jamais la recherche : l'encours
// serveur est un total d'AR global, et une bande dont trois tuiles suivraient un
// filtre que la quatrième ignore serait illisible. La page le DIT quand une
// recherche est active, plutôt que de laisser lire une contradiction — même
// geste que la note de compteurs d'`OrdersListPage`.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { B2B_INVOICES_QUERY_KEY } from './useB2bInvoices.js';

export interface B2bOrdersCounters {
  total:  number;
  unpaid: number;
  paid:   number;
  /** `null` = la RPC d'encours n'a pas répondu ; la tuile rend un tiret. */
  outstandingAr: number | null;
}

/** Lecture DÉFENSIVE d'une réponse RPC typée `Json` — jamais un cast aveugle. */
function readOutstanding(raw: unknown): number | null {
  if (raw === null || typeof raw !== 'object') return null;
  const v = (raw as { outstanding_ar?: unknown }).outstanding_ar;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function useB2bOrdersCounters() {
  return useQuery<B2bOrdersCounters>({
    queryKey: [...B2B_INVOICES_QUERY_KEY, 'orders-counters'],
    staleTime: 15_000,
    queryFn: async () => {
      const [allRes, unpaidRes, paidRes] = await Promise.all([
        supabase.from('view_b2b_invoices').select('invoice_id', { count: 'exact', head: true }),
        // Prédicat IDENTIQUE à celui de `useB2bOrdersList` pour `payment=unpaid`.
        supabase.from('view_b2b_invoices').select('invoice_id', { count: 'exact', head: true })
          .gt('outstanding', 0),
        // Prédicat IDENTIQUE à celui de `useB2bOrdersList` pour `payment=paid`.
        supabase.from('view_b2b_invoices').select('invoice_id', { count: 'exact', head: true })
          .lte('outstanding', 0),
      ]);
      if (allRes.error)    throw allRes.error;
      if (unpaidRes.error) throw unpaidRes.error;
      if (paidRes.error)   throw paidRes.error;

      const total  = allRes.count ?? 0;
      const unpaid = unpaidRes.count ?? 0;
      const paid   = paidRes.count ?? 0;

      // L'encours ne fait PAS échouer la bande : une RPC muette rend un tiret
      // sur sa tuile, les trois comptes restent justes. Un `throw` ici
      // remplacerait trois nombres vrais par quatre tirets.
      const { data: rpcRaw, error: rpcErr } = await supabase
        .rpc('get_b2b_dashboard_counters_v1');

      return {
        total,
        unpaid,
        paid,
        outstandingAr: rpcErr ? null : readOutstanding(rpcRaw),
      };
    },
  });
}
