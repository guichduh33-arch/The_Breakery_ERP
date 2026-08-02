// apps/backoffice/src/features/customers/hooks/useUpdateRetailCreditLimit.ts
//
// Session 62 Task 6 — persiste le plafond d'ardoise comptoir d'un client retail.
//
// ADR-020 déc. 1 (2026-08-03) — passe par `update_customer_credit_terms_v1`.
// L'écriture se faisait par UPDATE direct sur `customers`, chemin qui n'a jamais
// fonctionné : la colonne n'est pas dans le GRANT UPDATE de `authenticated`, donc
// chaque sauvegarde repartait en permission refusée — et aucun plafond n'était
// posé nulle part. L'ADR fait de cette RPC le seul chemin d'écriture des champs
// financiers d'une fiche client : elle est gatée (`customers.update` pour le
// plafond retail), verrouille la ligne, et écrit `audit_logs` avec le diff.
//
// Le patch est un JSONB dont la seule présence d'une clé vaut intention : on
// n'envoie donc que `retail_credit_limit`, et les champs B2B restent intouchés.
// `null` efface le plafond — le client retombe alors sur celui de
// l'établissement, il ne redevient pas illimité.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export function useUpdateRetailCreditLimit(customerId: string | undefined) {
  const qc = useQueryClient();
  return useMutation<void, Error, number | null>({
    mutationFn: async (retailCreditLimit) => {
      if (customerId === undefined) throw new Error('id required');
      const { error } = await supabase.rpc('update_customer_credit_terms_v1', {
        p_customer_id: customerId,
        p_patch: { retail_credit_limit: retailCreditLimit },
      });
      if (error !== null) throw new Error(error.message);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['customer-detail', customerId] });
    },
  });
}
