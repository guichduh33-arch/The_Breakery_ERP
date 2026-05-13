// apps/backoffice/src/features/lan-devices/hooks/useLanDevices.ts
// Session 13 / Phase 5.A — list LAN devices from the registry.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export type LanDeviceType = 'printer' | 'kiosk_display' | 'kds' | 'tablet' | 'pos';

export interface LanDeviceRow {
  id:                string;
  code:              string;
  name:              string;
  device_type:       LanDeviceType;
  ip_address:        string | null;
  port:              number | null;
  location:          string | null;
  is_active:         boolean;
  last_heartbeat_at: string | null;
  capabilities:      Record<string, unknown>;
  created_at:        string;
  updated_at:        string;
  deleted_at:        string | null;
}

export const LAN_DEVICES_KEY = ['lan-devices'] as const;

export function useLanDevices() {
  return useQuery<LanDeviceRow[]>({
    queryKey: LAN_DEVICES_KEY,
    staleTime: 15_000,
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const builder = (supabase as any).from('lan_devices')
        .select('*')
        .is('deleted_at', null)
        .order('created_at', { ascending: false });
      const { data, error } = await builder;
      if (error !== null && error !== undefined) throw new Error((error as { message: string }).message);
      return (data ?? []) as LanDeviceRow[];
    },
  });
}
