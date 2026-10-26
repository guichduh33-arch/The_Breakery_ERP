// apps/pos/src/features/customerCategories/hooks/useCustomerProductPrice.ts
import { useCallback } from 'react';
import type { Database } from '@breakery/supabase';
import { supabase } from '@/lib/supabase';

type GetCustomerProductPriceArgs =
  Database['public']['Functions']['get_pos_product_price_v1']['Args'];

export function useCustomerProductPrice() {
  return useCallback(async (productId: string, customerId: string | null): Promise<number> => {
    const args: Record<string, unknown> = { p_product_id: productId };
    if (customerId) args.p_customer_id = customerId;
    const { data, error } = await supabase.rpc(
      'get_pos_product_price_v1',
      args as GetCustomerProductPriceArgs,
    );
    if (error) throw error;
    if ((typeof data !== 'number' && typeof data !== 'string') || String(data).trim() === '') {
      throw new Error('The product price could not be confirmed. Try again.');
    }
    const price = Number(data);
    if (!Number.isFinite(price) || price < 0) throw new Error('The product price could not be confirmed. Try again.');
    return price;
  }, []);
}
