// apps/backoffice/src/features/inventory-production/hooks/useRevertProduction.ts
//
// Calls `revert_production_v2`. ADMIN+ only (server-side gate) — ADR-008 D8 acte
// que la permission `inventory.production.delete` suffit, sans PIN.
//
// ADR-008 D7 — l'annulation est refusée dès que le stock produit est ressorti
// (`already_consumed`) : annuler retirerait des unités qui ne sont plus là, et
// le stock comme la comptabilité deviendraient faux. Le correctif passe alors
// par un AJUSTEMENT de stock, pas par une annulation — c'est ce que le message
// d'erreur doit dire, sinon l'utilisateur est refusé sans issue. Le DETAIL du
// serveur porte la liste des sorties qui bloquent.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export type RevertProductionErrorCode =
  | 'forbidden'
  | 'reason_required'
  | 'production_not_found'
  | 'already_reverted'
  | 'already_consumed'
  | 'production_too_old'
  | 'unknown';

/** Une sortie de stock qui empêche l'annulation (ADR-008 D7). */
export interface RevertBlocker {
  movement_id:   string;
  movement_type: string;
  quantity:      number;
  occurred_at:   string;
  reason:        string | null;
}

export class RevertProductionError extends Error {
  constructor(
    public code: RevertProductionErrorCode,
    message?: string,
    /** Renseigné sur `already_consumed` : les sorties qui bloquent. */
    public blockers?: RevertBlocker[],
  ) {
    super(message ?? code);
    this.name = 'RevertProductionError';
  }
}

export interface RevertProductionArgs {
  productionId: string;
  reason:       string;
}

function classify(message: string): RevertProductionErrorCode {
  if (message.includes('forbidden'))              return 'forbidden';
  if (message.includes('reason_required'))        return 'reason_required';
  if (message.includes('production_not_found'))   return 'production_not_found';
  if (message.includes('already_reverted'))       return 'already_reverted';
  if (message.includes('already_consumed'))       return 'already_consumed';
  if (message.includes('production_too_old'))     return 'production_too_old';
  return 'unknown';
}

export function useRevertProduction() {
  const qc = useQueryClient();
  return useMutation<unknown, RevertProductionError, RevertProductionArgs>({
    mutationFn: async (args) => {
      const { data, error } = await supabase.rpc('revert_production_v2', {
        p_production_id: args.productionId,
        p_reason:        args.reason,
      });
      if (error) {
        const detail = (error as unknown as { details?: string }).details;
        let blockers: RevertBlocker[] | undefined;
        if (typeof detail === 'string' && detail.trim().startsWith('[')) {
          try { blockers = JSON.parse(detail) as RevertBlocker[]; } catch { /* ignore */ }
        }
        throw new RevertProductionError(classify(error.message), error.message, blockers);
      }
      return data;
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['inventory-production', 'records'] }),
        qc.invalidateQueries({ queryKey: ['stock-levels'] }),
      ]);
    },
  });
}
