// apps/backoffice/src/features/expenses/hooks/useSetExpenseEquipment.ts
//
// ADR-047 décision 2 — marque « équipement » d'un brouillon de dépense
// (set_expense_equipment_v1). `assetType = null` retire la marque. Le serveur
// refuse hors brouillon, hors créateur sans `expenses.manage`, et sous le
// seuil de 2 000 000 IDR TTC PAR ARTICLE ; il revérifie le seuil à l'approbation.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Database } from '@breakery/supabase';
import { supabase } from '@/lib/supabase.js';
import { EXPENSES_QUERY_KEY } from './useExpensesList.js';

type Enums = Database['public']['Enums'];
type Args = Database['public']['Functions']['set_expense_equipment_v1']['Args'];

export type ExpenseEquipmentInput =
  | { expenseId: string; assetType: null }
  | {
    expenseId: string;
    assetType: Enums['fixed_asset_type'];
    taxGroup: Enums['fixed_asset_tax_group'];
    assetName: string;
    quantity: number;
  };

const MESSAGES: Record<string, string> = {
  expense_not_draft: 'Only a draft expense can be marked as equipment.',
  expense_not_owner: 'Only the creator of this expense, or a manager, can change its equipment mark.',
  expense_not_found: 'This expense no longer exists.',
  fixed_asset_below_threshold: 'Each item must cost at least 2,000,000 IDR, incl. VAT.',
  fixed_asset_tax_group_required: 'Pick a tax group.',
  fixed_asset_name_invalid: 'The equipment name must be 2 to 120 characters.',
  fixed_asset_quantity_invalid: 'The quantity must be between 1 and 50.',
};

/** Phrase lisible d'un refus de set_expense_equipment_v1. */
export function expenseEquipmentErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : '';
  const known = Object.entries(MESSAGES).find(([code]) => message.includes(code));
  if (known !== undefined) return known[1];
  if (message.includes('missing permission')) return 'You do not have the permission to edit expenses.';
  return 'The equipment mark is not saved. Check the connection and try again.';
}

export function useSetExpenseEquipment() {
  const qc = useQueryClient();
  return useMutation<void, Error, ExpenseEquipmentInput>({
    retry: false,
    mutationFn: async (input) => {
      // Les types générés ne savent pas qu'un argument enum accepte NULL :
      // NULL retire la marque, c'est le contrat de la fonction.
      const args: { [K in keyof Args]-?: Args[K] | null } = input.assetType === null
        ? { p_expense_id: input.expenseId, p_asset_type: null, p_tax_group: null, p_asset_name: null, p_quantity: null }
        : {
          p_expense_id: input.expenseId,
          p_asset_type: input.assetType,
          p_tax_group: input.taxGroup,
          p_asset_name: input.assetName.trim(),
          p_quantity: input.quantity,
        };
      const { data, error } = await supabase.rpc('set_expense_equipment_v1', args as Args);
      if (error) throw new Error(error.message);
      // Le serveur doit confirmer CETTE dépense ; sinon rien n'est affirmé.
      const body = typeof data === 'object' && data !== null && !Array.isArray(data) ? data : {};
      if ((body as Record<string, unknown>).expense_id !== input.expenseId) {
        throw new Error('equipment_mark_not_confirmed');
      }
    },
    onSuccess: async (_d, { expenseId }) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['expense-detail', expenseId] }),
        qc.invalidateQueries({ queryKey: EXPENSES_QUERY_KEY }),
      ]);
    },
  });
}
