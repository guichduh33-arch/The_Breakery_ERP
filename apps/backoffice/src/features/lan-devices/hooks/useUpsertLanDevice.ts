// apps/backoffice/src/features/lan-devices/hooks/useUpsertLanDevice.ts
// Writes directs sous la RLS lan.devices.manage (design S13 — spec D8, pas de RPC).
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import type { Json } from '@breakery/supabase';
import { LAN_DEVICES_KEY, type LanDeviceType } from './useLanDevices.js';

export interface LanDeviceInput {
  id?: string;
  code: string;
  name: string;
  device_type: LanDeviceType;
  ip_address: string | null;
  port: number | null;
  location: string | null;
  is_active: boolean;
  /** printer only — écrit dans capabilities.station ; null = retire la clé. */
  station: string | null;
  /** capabilities actuelles de la ligne (edit) — préservées par merge. */
  existingCapabilities?: Record<string, unknown>;
}

function buildCapabilities(input: LanDeviceInput): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...(input.existingCapabilities ?? {}) };
  if (input.device_type === 'printer' && input.station !== null && input.station !== '') {
    merged.station = input.station;
  } else {
    delete merged.station;
  }
  return merged;
}

export function useUpsertLanDevice() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, LanDeviceInput>({
    mutationFn: async (input) => {
      const row = {
        code: input.code.trim(),
        name: input.name.trim(),
        device_type: input.device_type,
        ip_address: input.ip_address,
        port: input.port,
        location: input.location,
        is_active: input.is_active,
        // capabilities est un Record<string, unknown> métier ; le générateur type la
        // colonne en Json — même pattern de cast que useUpsertCombo.ts (p_combo).
        capabilities: buildCapabilities(input) as unknown as Json,
      };
      const result = input.id !== undefined
        ? await supabase.from('lan_devices').update(row).eq('id', input.id)
        : await supabase.from('lan_devices').insert(row);
      if (result.error !== null) {
        throw new Error(result.error.code === '23505' ? 'code_taken' : result.error.message);
      }
    },
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: LAN_DEVICES_KEY }); },
  });
}
