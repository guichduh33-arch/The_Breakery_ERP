// apps/pos/src/features/customerCategories/hooks/useCustomerProductPrice.ts
import { useCallback } from 'react';
import { supabase } from '@/lib/supabase';

export function useCustomerProductPrice() {
  return useCallback(async (productId: string, customerId: string | null): Promise<number> => {
    const { data, error } = await supabase.rpc('get_customer_product_price', {
      p_product_id: productId,
      p_customer_id: customerId,
    });
    if (error) throw error;
    return Number(data);
  }, []);
}
