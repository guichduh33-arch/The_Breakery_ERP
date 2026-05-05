import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';

const P0011 = 'P0011';

export function useMarkItemServed() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (itemId: string) => {
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
