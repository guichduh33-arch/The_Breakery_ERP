import type { Database } from '@breakery/supabase';
import { supabase } from './supabase';

type ProductRow = Database['public']['Tables']['products']['Row'];
type CategoryRow = Database['public']['Tables']['categories']['Row'];
export type OperationalProduct = Omit<ProductRow, 'current_stock'> & {
  current_stock: number | null;
  categories: CategoryRow | null;
  display_stock: { quantity: number | null } | null;
  is_sellable: boolean;
  has_variants: boolean;
};

// Le serveur décide de la visibilité ; NULL n'est jamais converti en stock zéro.
export async function getOperationalProducts(): Promise<OperationalProduct[]> {
  const { data, error } = await supabase.rpc('get_operational_products_v1');
  if (error) throw new Error(error.message);
  if (!Array.isArray(data)) throw new Error('Invalid product catalogue response');
  return data as unknown as OperationalProduct[];
}

