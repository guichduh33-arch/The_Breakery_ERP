import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

interface OccupiedRow {
  table_number: string;
}

const OCCUPANCY_KEY = ['table_occupancy'];

async function fetchOccupied(): Promise<Set<string>> {
  const { data, error } = await (supabase as unknown as {
    from: (t: string) => {
      select: (c: string) => {
        not: (c: string, op: string, v: unknown) => {
          not: (c: string, op: string, v: unknown) => Promise<{ data: OccupiedRow[] | null; error: { message: string } | null }>;
        };
      };
    };
  })
    .from('orders')
    .select('table_number')
    .not('table_number', 'is', null)
    .not('status', 'in', '(completed,voided)');

  if (error) throw new Error(error.message);
  return new Set((data ?? []).map((r) => r.table_number));
}

export function useTableOccupancy(): Record<string, boolean> {
  const queryClient = useQueryClient();
  // StrictMode double-invokes effects in dev; a static channel name would
  // collide with the still-subscribed channel from the first mount
  // (removeChannel is async). Suffix with a per-mount UUID.
  // Pattern ref: apps/pos/src/features/kds/hooks/useKdsRealtime.ts (C2 fix).
  const mountId = useMemo(() => crypto.randomUUID(), []);

  const { data: occupied = new Set<string>() } = useQuery({
    queryKey: OCCUPANCY_KEY,
    queryFn: fetchOccupied,
    staleTime: 30_000,
  });

  useEffect(() => {
    const channel = supabase
      .channel(`table_occupancy_realtime-${mountId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
        void queryClient.invalidateQueries({ queryKey: OCCUPANCY_KEY });
      })
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, [queryClient, mountId]);

  return Object.fromEntries([...occupied].map((name) => [name, true]));
}
