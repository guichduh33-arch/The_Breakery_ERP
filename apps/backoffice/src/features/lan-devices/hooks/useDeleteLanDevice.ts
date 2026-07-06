// apps/backoffice/src/features/lan-devices/hooks/useDeleteLanDevice.ts
// Soft-delete (deleted_at) — la ligne disparaît des listes BO/POS qui filtrent deleted_at IS NULL.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { LAN_DEVICES_KEY } from './useLanDevices.js';

export function useDeleteLanDevice() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, { id: string }>({
    mutationFn: async ({ id }) => {
      const { error } = await supabase
        .from('lan_devices')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id);
      if (error !== null) throw new Error(error.message);
    },
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: LAN_DEVICES_KEY }); },
  });
}
