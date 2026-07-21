import { useMutation, useQueryClient } from '@tanstack/react-query';
import { buildSubmitPayload } from '@breakery/domain';
import type { TabletCart } from '@breakery/domain';
import type { Json } from '@breakery/supabase';
import { supabase } from '@/lib/supabase';
import { isOfflineMode } from '@/features/lan/offlineMode';
import { hubBus } from '@/features/lan/hubBusClient';
import { nextLocalOrderNumber } from '@/features/lan/localOrderNumber';
import { enqueueIntent, nextIntentSeq } from '@/features/lan/offlineOutbox';
import type { OrderFiredPayload } from '@/features/lan/busTopics';
import { getStationMap } from '@/features/cart/hooks/useStationMap';

interface CreateTabletOrderArgs {
  cart: TabletCart;
  waiterId: string;
  clientUuid: string;
}

export interface CreateTabletOrderResult {
  /** order_id cloud, ou null quand l'envoi est parti par le bus LAN (offline). */
  orderId: string | null;
  /** Numéro local L-… quand offline (affichage toast), null sinon. */
  localNumber: string | null;
}

export function useCreateTabletOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ cart, waiterId, clientUuid }: CreateTabletOrderArgs): Promise<CreateTabletOrderResult> => {
      const payload = buildSubmitPayload(cart, waiterId);

      // Spec 006x lot 4 — envoi tablette en mode OFFLINE : intention durable
      // (rejouée vers create_tablet_order_v4, MÊME client_uuid) PUIS publish
      // order.fired sur le bus — le KDS affiche le ticket sans cloud. Pas de
      // KOT papier depuis la tablette (comportement online inchangé : c'est
      // la création DB qui alimente le KDS, l'impression reste côté caisse).
      if (isOfflineMode()) {
        const stationByProductId = await getStationMap(queryClient).catch(
          (): Record<string, string[]> => ({}),
        );
        const localNumber = nextLocalOrderNumber();
        const firedAt = new Date().toISOString();

        await enqueueIntent({
          kind: 'tablet_order',
          id: clientUuid,
          seq: nextIntentSeq(),
          created_at: firedAt,
          local_number: localNumber,
          waiter_id: payload.p_waiter_id,
          table_number: payload.p_table_number ?? '',
          order_type: payload.p_order_type,
          notes: payload.p_notes,
          items: payload.p_items,
        });

        const firedPayload: OrderFiredPayload = {
          client_uuid: clientUuid,
          order_number: localNumber,
          order_type: payload.p_order_type,
          table_number: payload.p_table_number,
          notes: payload.p_notes,
          fired_at: firedAt,
          items: cart.items.map((i) => ({
            id: i.id,
            product_id: i.product_id,
            product_name: i.name,
            quantity: i.quantity,
            unit_price: i.unit_price,
            modifiers: i.modifiers,
            dispatch_stations: stationByProductId[i.product_id] ?? [],
          })),
        };
        hubBus.publish('order.fired', firedPayload);

        return { orderId: null, localNumber };
      }

      const { data, error } = await supabase.rpc('create_tablet_order_v4', {
        p_client_uuid: clientUuid,
        p_waiter_id: payload.p_waiter_id,
        p_table_number: payload.p_table_number ?? '',
        p_order_type: payload.p_order_type,
        p_items: payload.p_items as unknown as Json,
        // The generated RPC arg type models the SQL `DEFAULT NULL` param as
        // an optional key (exactOptionalPropertyTypes forbids `undefined` as
        // an explicit value) — omit the key entirely when there is no note;
        // the server DEFAULT NULL applies exactly as it would for an
        // explicit null.
        ...(payload.p_notes != null ? { p_notes: payload.p_notes } : {}),
      });
      if (error) throw Object.assign(new Error(error.message), { details: error });
      return { orderId: data, localNumber: null };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tablet-orders'] });
    },
  });
}
