import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { TabletOrderEntry } from '@breakery/domain';

interface RawOrderItem {
  id: string;
  /** Calculé SERVEUR : (unit_price + modificateurs) × quantité, arrondi IDR. */
  line_total: number;
  is_cancelled: boolean;
}

interface RawProfile {
  full_name?: string;
}

export function usePendingTabletOrders() {
  const queryClient = useQueryClient();

  useEffect(() => {
    // StrictMode double-invokes effects in dev; with a static channel name the
    // second mount's .on() runs against the still-subscribed channel from the
    // first mount (removeChannel is async). Suffix with a per-mount UUID.
    const channelName = `pending-tablet-orders-${crypto.randomUUID()}`;
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'orders',
          filter: `created_via=eq.tablet`,
        },
        () => {
          void queryClient.invalidateQueries({ queryKey: ['pending-tablet-orders'] });
        },
      )
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, [queryClient]);

  return useQuery({
    queryKey: ['pending-tablet-orders'],
    // P0-2 filet (audit 2026-06-12) : un event realtime perdu (blip Wi-Fi,
    // reconnexion) est rattrapé en ≤ 30 s. Le realtime reste le chemin nominal.
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select(`
          id,
          order_number,
          table_number,
          order_type,
          waiter_id,
          sent_to_kitchen_at,
          notes,
          order_items(id, line_total, is_cancelled),
          user_profiles!waiter_id(full_name)
        `)
        .eq('created_via', 'tablet')
        .eq('status', 'pending_payment')
        .order('sent_to_kitchen_at', { ascending: false });
      if (error) throw new Error(error.message);

      return (data ?? []).map((row) => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const rawProfile = Array.isArray(row.user_profiles)
          ? row.user_profiles[0]
          : row.user_profiles;
        const profile = rawProfile as RawProfile | null | undefined;
        const orderItems = (row.order_items as unknown as RawOrderItem[]) ?? [];
        // Le montant affiché au caissier était recalculé en `unit_price ×
        // quantité` — il IGNORAIT les modificateurs, que le serveur inclut
        // pourtant dans `line_total`. Une commande avec suppléments s'annonçait
        // moins chère qu'elle ne l'est. On somme la valeur serveur, et on
        // exclut les lignes annulées : ce qui reste dû, pas ce qui fut commandé.
        const items_total = orderItems
          .filter((i) => !i.is_cancelled)
          .reduce((sum, i) => sum + i.line_total, 0);
        return {
          id: row.id,
          order_number: row.order_number,
          table_number: row.table_number,
          order_type: row.order_type as 'dine_in' | 'take_out',
          waiter_id: row.waiter_id!,
          waiter_name: profile?.full_name ?? 'Waiter',
          sent_to_kitchen_at: row.sent_to_kitchen_at!,
          items_count: orderItems.length,
          active_items_count: orderItems.filter((i) => !i.is_cancelled).length,
          items_total,
          notes: row.notes ?? null,
        } satisfies TabletOrderEntry;
      });
    },
  });
}
