import { useEffect } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { TABLE_RELEASING_STATUSES_FILTER } from '../tableActivity';

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
    .not('status', 'in', TABLE_RELEASING_STATUSES_FILTER);

  if (error) throw new Error(error.message);
  return new Set((data ?? []).map((r) => r.table_number));
}

// Re-audit 2026-08-24 (perf P1) — le hook est monté DEUX fois sur /pos via
// BottomActionBar (TableSelectorButton + useDineInTableGuard) : chaque mount
// ouvrait son propre canal sur `orders` et doublait le trafic realtime pour la
// même invalidation. Canal partagé refcompté au niveau module : le premier
// consommateur l'ouvre, le dernier le ferme. StrictMode reste sûr — ses
// mount/unmount sont séquentiels, donc chaque cycle recrée un canal au nom
// UUID frais (pas de collision avec le removeChannel asynchrone du précédent ;
// pattern ref: useKdsRealtime.ts).
let sharedChannel: ReturnType<typeof supabase.channel> | null = null;
let subscriberCount = 0;

function acquireOccupancyChannel(queryClient: QueryClient): () => void {
  subscriberCount += 1;
  if (subscriberCount === 1) {
    const channelName = `table_occupancy_realtime-${crypto.randomUUID()}`;
    sharedChannel = supabase
      .channel(channelName)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
        void queryClient.invalidateQueries({ queryKey: OCCUPANCY_KEY });
      })
      .subscribe();
  }
  return () => {
    subscriberCount -= 1;
    if (subscriberCount === 0 && sharedChannel) {
      void supabase.removeChannel(sharedChannel);
      sharedChannel = null;
    }
  };
}

export function useTableOccupancy(): Record<string, boolean> {
  const queryClient = useQueryClient();

  const { data: occupied = new Set<string>() } = useQuery({
    queryKey: OCCUPANCY_KEY,
    queryFn: fetchOccupied,
    staleTime: 30_000,
    // LOT 5 (audit 2026-06-25) — reconnect safety net: a realtime event lost
    // during a Wi-Fi blip is recovered in ≤30s. Realtime stays the nominal path.
    refetchInterval: 30_000,
  });

  useEffect(() => acquireOccupancyChannel(queryClient), [queryClient]);

  return Object.fromEntries([...occupied].map((name) => [name, true]));
}
