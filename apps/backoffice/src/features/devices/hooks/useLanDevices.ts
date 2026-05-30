// apps/backoffice/src/features/devices/hooks/useLanDevices.ts
// Session 33 / Wave 2.3 — fetch active LAN devices for terminal selectors.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface LanDevice {
  id:          string;
  code:        string;
  name:        string;
  device_type: 'printer' | 'kiosk_display' | 'kds' | 'tablet' | 'pos';
  is_active:   boolean;
}

export function useLanDevices(opts?: { deviceType?: LanDevice['device_type'] }) {
  return useQuery<LanDevice[], Error>({
    queryKey: ['lan_devices', opts?.deviceType ?? 'all'],
    staleTime: 1000 * 60 * 60 * 24,                              // 24h
    queryFn: async () => {
      let q = supabase
        .from('lan_devices')
        .select('id, code, name, device_type, is_active')
        .eq('is_active', true)
        .is('deleted_at', null);
      if (opts?.deviceType) q = q.eq('device_type', opts.deviceType);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as LanDevice[];
    },
  });
}
