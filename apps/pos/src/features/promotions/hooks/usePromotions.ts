// apps/pos/src/features/promotions/hooks/usePromotions.ts
// Note: supabase generated types are from session 7 and do not yet include the
// session-8 'promotions' table. We cast to an untyped query builder interface
// until types are regenerated after session-8 migrations are applied.
import { useQuery } from '@tanstack/react-query';
import type { Promotion } from '@breakery/domain';
import { supabase } from '@/lib/supabase';

interface UnboundFrom {
  select: (cols: string) => {
    is: (col: string, val: null) => {
      eq: (col: string, val: boolean) => {
        order: (col: string, opts: { ascending: boolean }) => Promise<{ data: unknown; error: unknown }>;
      };
    };
  };
}

interface AnySupabase {
  from: (table: string) => UnboundFrom;
}

export function usePromotions() {
  return useQuery({
    queryKey: ['promotions', 'active'],
    queryFn: async (): Promise<Promotion[]> => {
      const client = supabase as unknown as AnySupabase;
      const { data, error } = await client
        .from('promotions')
        .select('id, name, slug, description, action_type, action_params, conditions, priority, is_active')
        .is('deleted_at', null)
        .eq('is_active', true)
        .order('priority', { ascending: false });
      if (error) throw error instanceof Error ? error : new Error('promotions_query_failed');
      return (data ?? []) as Promotion[];
    },
    staleTime: 60_000,
  });
}
