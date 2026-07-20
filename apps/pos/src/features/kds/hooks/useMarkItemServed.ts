import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { tryLocalItemStatus } from '../offlineItemStatus';

const P0011 = 'P0011';

export function useMarkItemServed() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (itemId: string) => {
      // Spec 006x lot 3 — ligne locale (bus LAN) : statut local, pas de RPC.
      if (tryLocalItemStatus(itemId, 'served')) return;
      const { error } = await (supabase as unknown as {
        rpc: (fn: string, args: Record<string, unknown>) => Promise<{ error: { code?: string; message: string } | null }>;
      }).rpc('mark_item_served', { p_item_id: itemId });

      if (error) {
        const err = Object.assign(new Error(error.message), { code: error.code });
        throw err;
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['kds'] });
      // Session 59 review (finding 1) — a served item leaves the main ['kds']
      // query and becomes eligible for the recall strip, which reads a
      // separate ['kds-served', station] key that ['kds'] does not prefix.
      // Without this, "Recently served" lags up to 30s (refetchInterval).
      void queryClient.invalidateQueries({ queryKey: ['kds-served'] });
    },
    onError: (err: Error & { code?: string }) => {
      if (err.code === P0011) {
        toast.error('Could not mark served — item must be ready first');
      } else {
        toast.error('Could not mark served — item must be ready first');
      }
    },
  });
}
