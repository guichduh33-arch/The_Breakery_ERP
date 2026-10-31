import { supabase } from '@/lib/supabase.js';

export interface StockDeclarationResult {
  declaration_id: string;
  status: 'pending' | 'approved' | 'rejected';
  idempotent_replay: boolean;
  display_withdrawal_applied: boolean;
}

export async function submitStockDeclaration(
  operation: 'adjust' | 'waste', productId: string, quantity: number, reason: string, idempotencyKey: string,
): Promise<StockDeclarationResult> {
  const { data, error } = await supabase.rpc('submit_stock_declaration_v2', {
    p_operation: operation, p_product_id: productId, p_quantity: quantity,
    p_reason: reason, p_idempotency_key: idempotencyKey,
  });
  if (error) throw new Error(error.message);
  const result = data as unknown as StockDeclarationResult | null;
  if (!result || typeof result.declaration_id !== 'string' ||
    !['pending', 'approved', 'rejected'].includes(result.status) ||
    typeof result.display_withdrawal_applied !== 'boolean' || typeof result.idempotent_replay !== 'boolean') {
    throw new Error('Invalid stock declaration response');
  }
  return result;
}
