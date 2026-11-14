import type { Database } from '@breakery/supabase';
import { supabase } from '@/lib/supabase.js';

type WasteReason = Database['public']['Enums']['waste_reason'];

export interface StockDeclarationResult {
  declaration_id: string;
  status: 'pending' | 'approved' | 'rejected';
  idempotent_replay: boolean;
}

// Famille `submit_stock_declaration`. Une perte (`waste`) porte un motif de la
// liste fermée et une note facultative dans `reason` ; un ajustement garde son
// texte libre et n'envoie aucun motif (le serveur le refuserait).
export async function submitStockDeclaration(
  operation: 'adjust' | 'waste', productId: string, quantity: number, reason: string, idempotencyKey: string,
  wasteReason?: WasteReason,
): Promise<StockDeclarationResult> {
  const { data, error } = await supabase.rpc('submit_stock_declaration_v3', {
    p_operation: operation, p_product_id: productId, p_quantity: quantity,
    p_reason: reason, p_idempotency_key: idempotencyKey,
    ...(operation === 'waste' && wasteReason !== undefined ? { p_waste_reason: wasteReason } : {}),
  });
  if (error) throw new Error(error.message);
  const result = data as unknown as StockDeclarationResult | null;
  if (!result || typeof result.declaration_id !== 'string' ||
    !['pending', 'approved', 'rejected'].includes(result.status)) {
    throw new Error('Invalid stock declaration response');
  }
  return result;
}
