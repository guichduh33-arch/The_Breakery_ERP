// apps/pos/src/features/settings/hooks/usePrinterDevices.ts
//
// ADR-030 — le bouton « Test » de chaque imprimante quitte le back-office pour
// le POS. Le registre lui-même reste dans le cloud et reste géré depuis le BO :
// cette lecture est volontairement en SEULE LECTURE, aucune écriture ici.
//
// Distinct de `useStationPrinters` (features/cart), qui indexe par station et
// laisse donc tomber les imprimantes sans station et les doublons de station —
// pour tester du matériel, on veut toutes les lignes.
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface PrinterDevice {
  id: string;
  code: string;
  name: string;
  ip_address: string | null;
  port: number | null;
  station: string | null;
}

interface PrinterDeviceRow {
  id: string;
  code: string;
  name: string;
  ip_address: string | null;
  port: number | null;
  capabilities: Record<string, unknown> | null;
}

export function usePrinterDevices() {
  return useQuery<PrinterDevice[], Error>({
    queryKey: ['settings-printer-devices'],
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('lan_devices')
        .select('id, code, name, ip_address, port, capabilities')
        .eq('device_type', 'printer')
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('code');

      if (error) throw error;

      return ((data ?? []) as PrinterDeviceRow[]).map((row) => {
        const station = row.capabilities?.station;
        return {
          id: row.id,
          code: row.code,
          name: row.name,
          ip_address: row.ip_address,
          port: row.port,
          station: typeof station === 'string' && station !== '' ? station : null,
        };
      });
    },
  });
}
