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
  /**
   * Commande de salle à COMPLÉTER (2ᵉ tournée sur une table déjà servie).
   * Absent = création. La RPC porte les deux gestes, comme au comptoir.
   */
  appendToOrderId?: string;
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
    mutationFn: async ({ cart, waiterId, clientUuid, appendToOrderId }: CreateTabletOrderArgs): Promise<CreateTabletOrderResult> => {
      const payload = buildSubmitPayload(cart, waiterId);
      const isAppend = appendToOrderId !== undefined;

      // ADR-018 D7 — on ne met JAMAIS en file ce qu'un garde serveur refusera.
      // `create_tablet_order` exige une table pour un dine-in (P0011, règle
      // propriétaire 2026-07-07). En ligne, ce garde ne fait qu'anticiper le
      // refus ; HORS LIGNE il est vital : l'intent serait accepté par la file,
      // le ticket partirait en cuisine par le bus, puis le rejeu le refuserait
      // à chaque tentative — bloquant derrière lui des encaissements déjà
      // perçus. Le contrôle est ici (et pas dans un composant) pour couvrir
      // les DEUX chemins d'envoi et les deux modes.
      //
      // En AJOUT il ne s'applique pas : la table vient de la commande visée,
      // et le serveur ne la redemande pas.
      if (!isAppend && payload.p_order_type === 'dine_in' && (payload.p_table_number ?? '').trim() === '') {
        throw new Error('table_required_for_dine_in');
      }

      // L'ajout est EN LIGNE SEULEMENT (décision propriétaire 2026-08-01).
      // Hors ligne, il faudrait empiler une intention désignant une commande
      // qui n'existe pas encore en cloud : c'est la mécanique la moins éprouvée
      // du système, et l'ADR-018 demande de ne mettre en file que ce que le
      // serveur ne peut pas refuser. En coupure, la serveuse prend une commande
      // NEUVE — ce chemin-là fonctionne.
      if (isAppend && isOfflineMode()) {
        throw new Error('append_unavailable_offline');
      }

      // Spec 006x lot 4 — envoi tablette en mode OFFLINE : intention durable
      // (rejouée vers create_tablet_order, MÊME client_uuid) PUIS publish
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

      // ADR-022 déc. 3 — pas de p_tolerate_unsellable : envoi en salle nominal,
      // le refus y arrive à temps. Seul le rejeu hors-ligne pose le drapeau.
      const { data, error } = await supabase.rpc('create_tablet_order_v6', {
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
        ...(appendToOrderId !== undefined ? { p_order_id: appendToOrderId } : {}),
      });
      if (error) throw Object.assign(new Error(error.message), { details: error });
      return { orderId: data, localNumber: null };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tablet-orders'] });
      // Un ajout change le montant dû sur la table : l'inbox caisse et la carte
      // table→commande doivent le refléter sans attendre leur intervalle.
      void queryClient.invalidateQueries({ queryKey: ['pending-tablet-orders'] });
      void queryClient.invalidateQueries({ queryKey: ['table_orders'] });
    },
  });
}
