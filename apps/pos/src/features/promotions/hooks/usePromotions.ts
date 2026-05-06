// apps/pos/src/features/promotions/hooks/usePromotions.ts
import { useQuery } from '@tanstack/react-query';
import type { Promotion } from '@breakery/domain';
import { supabase } from '@/lib/supabase';

export function usePromotions() {
  return useQuery({
    queryKey: ['promotions', 'active'],
    queryFn: async (): Promise<Promotion[]> => {
      const { data, error } = await supabase
        .from('promotions')
        .select('id, name, slug, description, action_type, action_params, conditions, priority, is_active')
        .is('deleted_at', null)
        .eq('is_active', true)
        .order('priority', { ascending: false });
      if (error) throw error;
      return (data ?? []) as Promotion[];
    },
    staleTime: 60_000,
  });
}
