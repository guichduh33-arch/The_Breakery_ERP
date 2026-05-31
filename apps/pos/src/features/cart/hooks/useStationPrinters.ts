// apps/pos/src/features/cart/hooks/useStationPrinters.ts
// Session 34 / Wave 2.3 — fetch active printer devices and index them by station role.
//
// Queries lan_devices for rows that are:
//   - device_type = 'printer'
//   - is_active = true
//   - have a non-null capabilities->>'station' tag
//   - have non-null ip_address and port
//
// Returns a Map<PrinterRole, { ip_address, port, name }> so callers can do:
//   const printers = useStationPrinters();
//   const kitchen = printers.data?.get('kitchen');

import { useQuery } from '@tanstack/react-query';
import type { PrinterRole } from '@breakery/domain';
import { supabase } from '@/lib/supabase';

export interface StationPrinterInfo {
  ip_address: string;
  port: number;
  name: string;
}

export type StationPrintersMap = Map<PrinterRole, StationPrinterInfo>;

// lan_devices row shape for the columns we need.
// Using a local interface so we don't depend on the generated types having `capabilities`.
interface PrinterDeviceRow {
  id: string;
  name: string;
  ip_address: string | null;
  port: number | null;
  // JSONB — typed loosely; at runtime we read capabilities?.station
  capabilities: Record<string, unknown> | null;
}

export function useStationPrinters() {
  return useQuery<StationPrintersMap, Error>({
    queryKey: ['station-printers'],
    staleTime: 1000 * 60 * 5, // 5 min — printer config is semi-static
    queryFn: async () => {
      const { data, error } = await supabase
        .from('lan_devices')
        .select('id, name, ip_address, port, capabilities')
        .eq('device_type', 'printer')
        .eq('is_active', true)
        .is('deleted_at', null);

      if (error) throw error;

      const map: StationPrintersMap = new Map();

      for (const row of (data ?? []) as PrinterDeviceRow[]) {
        const station = row.capabilities?.['station'];
        if (
          typeof station !== 'string' ||
          station === '' ||
          row.ip_address == null ||
          row.port == null
        ) {
          continue;
        }
        // Trust the DB value; cast to PrinterRole — invalid tags are just skipped
        map.set(station as PrinterRole, {
          ip_address: row.ip_address,
          port: row.port,
          name: row.name,
        });
      }

      return map;
    },
  });
}
