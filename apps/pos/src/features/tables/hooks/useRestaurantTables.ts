import { useQuery } from '@tanstack/react-query';
import type { RestaurantTable } from '@breakery/domain';
import { supabase } from '@/lib/supabase';

interface LooseResult<T> {
  data: T | null;
  error: { message: string } | null;
}

export function useRestaurantTables() {
  return useQuery<RestaurantTable[]>({
    queryKey: ['restaurant_tables'],
    queryFn: async () => {
      const result = await (supabase as unknown as {
        from: (t: string) => {
          select: (c: string) => {
            eq: (c: string, v: unknown) => {
              order: (c: string, o: { ascending: boolean }) => Promise<LooseResult<unknown[]>>;
            };
          };
        };
      })
        .from('restaurant_tables')
        .select('id, name, seats, sort_order, is_active')
        .eq('is_active', true)
        .order('sort_order', { ascending: true });

      if (result.error) throw new Error(result.error.message);
      return (result.data ?? []) as RestaurantTable[];
    },
    staleTime: 5 * 60 * 1_000,
  });
}
