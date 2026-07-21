// apps/pos/src/features/lan/offlineReplay.ts
//
// Spec 006x lot 4 — replay SÉQUENTIEL de l'outbox offline au retour du cloud
// (§4.3 RETOUR ONLINE) : chaque intent rejoue la RPC EXISTANTE avec sa clé
// d'idempotence D'ORIGINE — un double replay est un no-op serveur, aucune RPC
// « spéciale offline » côté money-path. Ordre strict par seq (fire avant
// paiement d'une même commande) ; premier échec = arrêt du drain (l'ordre est
// préservé, on retentera au prochain déclencheur). A4 : pay_existing_order_v13
// est appelée avec p_offline_replay=true — le serveur ACCEPTE (stock forcé
// négatif au besoin) et trace offline_replay dans audit_logs.

import { logger } from '@breakery/utils';
import type { Database, Json } from '@breakery/supabase';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { useCartStore } from '@/stores/cartStore';
import { emitPosEvent } from '@/features/audit/emitPosEvent';
import { getPendingIntents, removeIntents, type OfflineIntent } from './offlineOutbox';

type FireArgs = Database['public']['Functions']['fire_counter_order_v4']['Args'];
type TabletArgs = Database['public']['Functions']['create_tablet_order_v4']['Args'];

interface FireEnvelope {
  order_id: string;
  order_number: string;
  idempotent_replay: boolean;
}

export interface ReplayResult {
  replayed: number;
  failed: number;
  /** Premier message d'erreur rencontré (drain arrêté dessus). */
  error?: string;
}

let replaying = false;

async function replayOne(intent: OfflineIntent, orderIdByRoot: Map<string, string>): Promise<void> {
  if (intent.kind === 'fire') {
    const isAppend = intent.id !== intent.root_client_uuid;
    const rootOrderId = orderIdByRoot.get(intent.root_client_uuid);
    if (isAppend && rootOrderId === undefined) {
      // La racine a été rejouée dans un run précédent (record déjà supprimé) :
      // son replay idempotent renvoie la commande sans revalider les items —
      // le lookup client_uuid court-circuite AVANT toute validation.
      const { data, error } = await supabase.rpc('fire_counter_order_v4', {
        p_client_uuid: intent.root_client_uuid,
        p_session_id: intent.session_id,
        p_items: [],
      });
      if (error) throw Object.assign(new Error(error.message), { details: error });
      orderIdByRoot.set(intent.root_client_uuid, (data as unknown as FireEnvelope).order_id);
    }

    const args: Record<string, unknown> = {
      p_client_uuid: intent.id,
      p_session_id: intent.session_id,
      p_items: intent.items,
      p_order_type: intent.order_type,
    };
    if (isAppend) args.p_order_id = orderIdByRoot.get(intent.root_client_uuid);
    if (intent.table_number !== null) args.p_table_number = intent.table_number;
    if (intent.discount_authorized_by !== undefined) args.p_discount_authorized_by = intent.discount_authorized_by;

    const { data, error } = await supabase.rpc('fire_counter_order_v4', args as FireArgs);
    if (error) throw Object.assign(new Error(error.message), { details: error });
    const env = data as unknown as FireEnvelope;
    orderIdByRoot.set(intent.root_client_uuid, env.order_id);

    // Raccordement du cart ACTIF : si la commande locale rejouée est encore
    // ouverte sur ce terminal, le checkout suivant doit payer la commande
    // CLOUD (pay_existing), jamais re-créer via process-payment.
    const cart = useCartStore.getState();
    if (cart.offlineOrder?.clientUuid === intent.root_client_uuid) {
      cart.setPickedUpOrderId(env.order_id);
      cart.setOfflineOrder(null);
    }
    return;
  }

  if (intent.kind === 'cash_payment') {
    let orderId = orderIdByRoot.get(intent.root_client_uuid);
    if (orderId === undefined) {
      // Fire rejoué dans un run précédent — replay idempotent pour retrouver
      // l'order_id (voir note ci-dessus : court-circuit avant validation).
      const { data, error } = await supabase.rpc('fire_counter_order_v4', {
        p_client_uuid: intent.root_client_uuid,
        // La branche idempotente n'atteint jamais ces args ; s'ils sont
        // atteints, la racine n'a JAMAIS été rejouée (anomalie) → l'échec de
        // validation garde l'intent en file et remonte l'erreur.
        p_session_id: intent.root_client_uuid,
        p_items: [],
      });
      if (error) throw Object.assign(new Error(error.message), { details: error });
      orderId = (data as unknown as FireEnvelope).order_id;
      orderIdByRoot.set(intent.root_client_uuid, orderId);
    }

    const { error } = await supabase.rpc('pay_existing_order_v13', {
      p_order_id: orderId,
      p_payment: intent.payment as unknown as Json,
      p_idempotency_key: intent.id,
      p_offline_replay: true,
      ...(intent.customer_id !== undefined ? { p_customer_id: intent.customer_id } : {}),
    });
    if (error) throw Object.assign(new Error(error.message), { details: error });
    return;
  }

  // tablet_order
  const args: Record<string, unknown> = {
    p_client_uuid: intent.id,
    p_waiter_id: intent.waiter_id,
    p_table_number: intent.table_number,
    p_order_type: intent.order_type,
    p_items: intent.items,
  };
  if (intent.notes !== null) args.p_notes = intent.notes;
  const { error } = await supabase.rpc('create_tablet_order_v4', args as TabletArgs);
  if (error) throw Object.assign(new Error(error.message), { details: error });
}

/** Draine l'outbox offline vers le cloud. Réentrant-safe (verrou module) ;
 *  no-op si non authentifié (les intents attendent le prochain déclencheur). */
export async function replayOfflineOutbox(): Promise<ReplayResult> {
  if (replaying) return { replayed: 0, failed: 0 };
  if (!useAuthStore.getState().isAuthenticated) return { replayed: 0, failed: 0 };

  replaying = true;
  try {
    const pending = await getPendingIntents();
    if (pending.length === 0) return { replayed: 0, failed: 0 };

    logger.info('offline_replay.start', { pending: pending.length });
    const orderIdByRoot = new Map<string, string>();
    let replayed = 0;

    for (const intent of pending) {
      try {
        await replayOne(intent, orderIdByRoot);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn('offline_replay.intent_failed', { kind: intent.kind, id: intent.id, err: message });
        // Trace opérationnelle : une vente encaissée qui ne se resynchronise
        // pas est un signal comptable — jamais silencieux (A4).
        if (intent.kind === 'cash_payment') {
          emitPosEvent('payment_failed', {
            amount: intent.payment.amount,
            reason: message,
            order_number_snap: intent.local_number,
            payload: { offline_replay: true, idempotency_key: intent.id },
          });
        }
        return { replayed, failed: pending.length - replayed, error: message };
      }
      await removeIntents([intent.id]);
      replayed += 1;
    }

    logger.info('offline_replay.done', { replayed });
    return { replayed, failed: 0 };
  } finally {
    replaying = false;
  }
}
