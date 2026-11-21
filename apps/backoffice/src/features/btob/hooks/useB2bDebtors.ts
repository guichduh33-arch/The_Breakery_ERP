// apps/backoffice/src/features/btob/hooks/useB2bDebtors.ts
//
// Onglet « Outstanding » de B2B Payments : TOUS les clients B2B qui doivent
// de l'argent, triés par solde décroissant.
//
// L'onglet filtrait les « top clients » du dashboard (famille
// `get_b2b_dashboard_counters`) : cinq lignes, classées par chiffre
// d'affaires. Un débiteur hors de ce top 5 n'apparaissait pas, et le compteur
// de l'onglet confirmait l'absence. Constaté en production le 2026-11-21 :
// 4 clients listés pour 17 débiteurs, Rp 13,5 M d'encours invisibles.
//
// La clé commence par ['customers'] : chaque mutation qui bouge un solde B2B
// (paiement, création, annulation) invalide déjà ce préfixe.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface B2bDebtorRow {
  id:                  string;
  name:                string;
  b2b_company_name:    string | null;
  b2b_current_balance: number;
  b2b_credit_limit:    number | null;
}

export interface B2bDebtors {
  rows:  B2bDebtorRow[];
  /** Nombre de débiteurs côté serveur, pour annoncer une liste tronquée. */
  total: number;
}

/** Plafond de lecture. Au-delà, la page dit combien de lignes manquent. */
export const B2B_DEBTORS_LIMIT = 500;

export const B2B_DEBTORS_QUERY_KEY = ['customers', 'b2b-debtors'] as const;

export function useB2bDebtors() {
  return useQuery<B2bDebtors>({
    queryKey: B2B_DEBTORS_QUERY_KEY,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error, count } = await supabase
        .from('customers')
        .select('id, name, b2b_company_name, b2b_current_balance, b2b_credit_limit', { count: 'exact' })
        .is('deleted_at', null)
        .eq('customer_type', 'b2b')
        .gt('b2b_current_balance', 0)
        .order('b2b_current_balance', { ascending: false })
        .limit(B2B_DEBTORS_LIMIT);
      if (error) throw error;
      const rows: B2bDebtorRow[] = (data ?? []).map((r) => ({
        id:                  r.id,
        name:                r.name,
        b2b_company_name:    r.b2b_company_name,
        b2b_current_balance: Number(r.b2b_current_balance ?? 0),
        b2b_credit_limit:    r.b2b_credit_limit === null ? null : Number(r.b2b_credit_limit),
      }));
      return { rows, total: count ?? rows.length };
    },
  });
}
