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
//   · deux `count: 'exact', head: true` sur `view_b2b_invoices` — head, donc
//     zéro ligne transportée pour un nombre ;
//   · `get_b2b_dashboard_counters_v1` pour l'ENCOURS, qu'elle rend déjà
//     (`outstanding_ar`) et que le dashboard B2B lit depuis l'ADR-026.
//
// « Réglées » n'a pas son propre appel : c'est `total − impayées`, et la vue
// exclut déjà les commandes annulées. Un troisième aller-retour pour une
// soustraction exacte serait du trafic sans information.
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
      const [allRes, unpaidRes] = await Promise.all([
        supabase.from('view_b2b_invoices').select('invoice_id', { count: 'exact', head: true }),
        supabase.from('view_b2b_invoices').select('invoice_id', { count: 'exact', head: true })
          .gt('outstanding', 0),
      ]);
      if (allRes.error)    throw allRes.error;
      if (unpaidRes.error) throw unpaidRes.error;

      const total  = allRes.count ?? 0;
      const unpaid = unpaidRes.count ?? 0;

      // L'encours ne fait PAS échouer la bande : une RPC muette rend un tiret
      // sur sa tuile, les trois comptes restent justes. Un `throw` ici
      // remplacerait trois nombres vrais par quatre tirets.
      const { data: rpcRaw, error: rpcErr } = await supabase
        .rpc('get_b2b_dashboard_counters_v1');

      return {
        total,
        unpaid,
        paid: total - unpaid,
        outstandingAr: rpcErr ? null : readOutstanding(rpcRaw),
      };
    },
  });
}
