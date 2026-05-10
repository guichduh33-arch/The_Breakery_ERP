// apps/pos/src/features/customerCategories/hooks/useCustomerProductPrice.ts
import { useCallback } from 'react';
import type { Database } from '@breakery/supabase';
import { supabase } from '@/lib/supabase';

type GetCustomerProductPriceArgs =
  Database['public']['Functions']['get_customer_product_price']['Args'];

export function useCustomerProductPrice() {
  return useCallback(async (productId: string, customerId: string | null): Promise<number> => {
    const args: Record<string, unknown> = { p_product_id: productId };
    if (customerId) args.p_customer_id = customerId;
    const { data, error } = await supabase.rpc(
      'get_customer_product_price',
      args as GetCustomerProductPriceArgs,
    );
    if (error) throw error;
    return Number(data);
  }, []);
}
