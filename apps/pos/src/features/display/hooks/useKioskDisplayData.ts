import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { DisplayOrder } from './useDisplayOrders';
import type { ReadyOrder } from './useReadyOrders';
import type { ShowcaseProduct } from './useShowcaseProducts';

export interface KioskDisplayData {
  footer: string;
  slogan: string;
  show_ready_orders: boolean;
  products: ShowcaseProduct[];
  orders: Omit<DisplayOrder, 'total' | 'created_at'>[];
  ready_orders: ReadyOrder[];
}

export function useKioskDisplayData(deviceId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['kiosk-display', deviceId],
    enabled: enabled && deviceId !== null,
    // Pas d'abonnement aux tables complètes : uniquement la projection serveur.
    refetchInterval: 2_000,
    refetchIntervalInBackground: true,
    retry: false,
    gcTime: 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_kiosk_display_v1');
      if (error) throw error;
      if (!data || typeof data !== 'object' || Array.isArray(data)
        || !Array.isArray(data.products) || !Array.isArray(data.orders) || !Array.isArray(data.ready_orders)) {
        throw new Error('Invalid display response');
      }
      return data as unknown as KioskDisplayData;
    },
  });
}
