// apps/pos/src/features/promotions/hooks/usePromotions.ts
// Note: supabase generated types (types.generated.ts) are from session 7 and do not yet
// include the session-8 'promotions' table and 'evaluate_promotions' RPC.
// We cast through `unknown` to bypass stale type mismatch until types are regenerated.
import { useQuery } from '@tanstack/react-query';
import type { Promotion } from '@breakery/domain';
import { supabase } from '@/lib/supabase';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supabaseAny = supabase as unknown as any;

export function usePromotions() {
  return useQuery({
    queryKey: ['promotions', 'active'],
    queryFn: async (): Promise<Promotion[]> => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      const { data, error } = await supabaseAny
        .from('promotions')
        .select('id, name, slug, description, action_type, action_params, conditions, priority, is_active')
        .is('deleted_at', null)
        .eq('is_active', true)
        .order('priority', { ascending: false });
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      if (error) throw error;
      return (data ?? []) as Promotion[];
    },
    staleTime: 60_000,
  });
}
