// apps/pos/src/features/lan/offlineReplay.ts
//
// Spec 006x lot 4 — replay SÉQUENTIEL de l'outbox offline au retour du cloud
// (§4.3 RETOUR ONLINE) : chaque intent rejoue la RPC EXISTANTE avec sa clé
// d'idempotence D'ORIGINE — un double replay est un no-op serveur, aucune RPC
// « spéciale offline » côté money-path. Ordre strict par seq (fire avant
// paiement d'une même commande) ; premier échec = arrêt du drain (l'ordre est
// préservé, on retentera au prochain déclencheur). A4 : pay_existing_order_v16
// est appelée avec p_offline_replay=true — le serveur ACCEPTE (stock forcé
// négatif au besoin) et trace offline_replay dans audit_logs.

import { logger } from '@breakery/utils';
import type { Database, Json } from '@breakery/supabase';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { useCartStore } from '@/stores/cartStore';
import { emitPosEvent } from '@/features/audit/emitPosEvent';
import {
  getPendingIntents,
  removeIntents,
  quarantineIntents,
  type OfflineIntent,
} from './offlineOutbox';

/** ADR-018 D2 — liste EXPLICITE des échecs définitifs. Le défaut est
 *  « transitoire » : tout code absent d'ici laisse l'intent en file et arrête
 *  le drain, comme avant. L'asymétrie est voulue — se tromper en gardant coûte
 *  un retard, se tromper en quarantinant coûte la remontée d'une vente. Le
 *  défaut protège l'argent.
 *
 *  Ajouter un garde serveur sur une RPC rejouée oblige à revoir cette liste
 *  dans le même lot (D2). Ne PAS y mettre P0001 (session expirée) ni P0003
 *  (permission) : ces deux-là se réparent et l'intent doit survivre. */
const DEFINITIVE_ERROR_CODES: ReadonlySet<string> = new Set([
  'P0011', // règle métier (ex. table_required_for_dine_in) — rejouée à l'identique, refusée à l'identique
  '23514', // check_violation — validation serveur (items vides, client_uuid manquant…)
  '23503', // foreign_key_violation — référence disparue (produit supprimé depuis la coupure)
  '22P02', // invalid_text_representation — payload non réparable côté serveur
]);

function errorCodeOf(err: unknown): string | null {
  const details = (err as { details?: { code?: string } } | null)?.details;
  return details?.code ?? null;
}

/** Racine de commande d'un intent, ou null quand il n'en a pas (`tablet_order`
 *  est autonome : rien dans la file ne dépend de lui). */
function rootOf(intent: OfflineIntent): string | null {
  return intent.kind === 'tablet_order' ? null : intent.root_client_uuid;
}

/** Montant encaissé porté par l'intent, ou null si ce n'est pas un règlement. */
function amountOf(intent: OfflineIntent): number | null {
  if (intent.kind === 'payment') return intent.payments.reduce((sum, t) => sum + t.amount, 0);
  if (intent.kind === 'cash_payment') return intent.payment.amount;
  return null;
}

/** A4 — une vente encaissée qui ne se resynchronise pas est un signal
 *  comptable. Émis à CHAQUE échec de règlement, transitoire ou définitif. */
function emitPaymentFailure(intent: OfflineIntent, message: string): void {
  if (intent.kind !== 'payment' && intent.kind !== 'cash_payment') return;
  const methods =
    intent.kind === 'payment'
      ? intent.payments.map((t) => t.method)
      : [intent.payment.method];
  emitPosEvent('payment_failed', {
    amount: amountOf(intent),
    reason: message,
    order_number_snap: intent.local_number,
    payload: { offline_replay: true, idempotency_key: intent.id, methods },
  });
}

type FireArgs = Database['public']['Functions']['fire_counter_order_v5']['Args'];
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
  /** ADR-018 — intents sortis vers la quarantaine pendant ce drain. Absent
   *  quand il n'y en a eu aucun (cas nominal). */
  quarantined?: number;
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
      const { data, error } = await supabase.rpc('fire_counter_order_v5', {
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

    const { data, error } = await supabase.rpc('fire_counter_order_v5', args as FireArgs);
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

  if (intent.kind === 'payment' || intent.kind === 'cash_payment') {
    let orderId = orderIdByRoot.get(intent.root_client_uuid);
    if (orderId === undefined) {
      // Fire rejoué dans un run précédent — replay idempotent pour retrouver
      // l'order_id (voir note ci-dessus : court-circuit avant validation).
      const { data, error } = await supabase.rpc('fire_counter_order_v5', {
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

    // p_payments (ADR-015) pour le format courant, p_payment pour le legacy :
    // la RPC rejette explicitement les deux ensemble (check_violation).
    const tenderArgs =
      intent.kind === 'payment'
        ? { p_payments: intent.payments as unknown as Json }
        : { p_payment: intent.payment as unknown as Json };

    const { error } = await supabase.rpc('pay_existing_order_v16', {
      p_order_id: orderId,
      ...tenderArgs,
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
    // Lot 5 — mesure du rattrapage (spec §7.5) : durée du drain loggée pour
    // chiffrer la resynchronisation en boutique.
    const startedAt = performance.now();
    const orderIdByRoot = new Map<string, string>();
    let replayed = 0;
    let quarantined = 0;
    /** Intents déjà emportés par une cascade (D3) — sautés sans être rejoués. */
    const skipped = new Set<string>();

    for (const intent of pending) {
      if (skipped.has(intent.id)) continue;

      try {
        await replayOne(intent, orderIdByRoot);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const code = errorCodeOf(err);
        logger.warn('offline_replay.intent_failed', {
          kind: intent.kind, id: intent.id, code, err: message,
        });
        // Trace opérationnelle : une vente encaissée qui ne se resynchronise
        // pas est un signal comptable — jamais silencieux (A4).
        emitPaymentFailure(intent, message);

        if (!DEFINITIVE_ERROR_CODES.has(code ?? '')) {
          // Échec transitoire (ADR-018 D1) : le drain s'arrête, l'ordre de la
          // file est préservé, on retentera au prochain déclencheur.
          logger.warn('offline_replay.aborted', {
            replayed,
            failed: pending.length - replayed - quarantined,
            duration_ms: Math.round(performance.now() - startedAt),
          });
          return {
            replayed,
            failed: pending.length - replayed - quarantined,
            error: message,
            ...(quarantined > 0 ? { quarantined } : {}),
          };
        }

        // Échec définitif : l'intent sort de la file avec tout ce qui dépend de
        // lui (D3), et le drain CONTINUE — c'est le point de l'ADR-018 : ne
        // jamais laisser un refus bloquer des encaissements déjà perçus.
        const root = rootOf(intent);
        const victims =
          root === null
            ? [intent]
            : [
                intent,
                ...pending.filter(
                  (p) => p.seq > intent.seq && !skipped.has(p.id) && rootOf(p) === root,
                ),
              ];

        await quarantineIntents(victims.map((v) => ({ intent: v, code, reason: message })));

        for (const victim of victims) {
          skipped.add(victim.id);
          quarantined += 1;
          emitPosEvent('offline_intent_quarantined', {
            ...(amountOf(victim) !== null ? { amount: amountOf(victim) } : {}),
            reason: message,
            order_number_snap: victim.local_number,
            payload: {
              offline_replay: true,
              idempotency_key: victim.id,
              kind: victim.kind,
              code,
              // Distingue la cause du dommage collatéral pour la régularisation.
              cascaded: victim.id !== intent.id,
            },
          });
        }

        logger.warn('offline_replay.quarantined', {
          kind: intent.kind, id: intent.id, code, cascade: victims.length - 1,
        });
        continue;
      }
      await removeIntents([intent.id]);
      replayed += 1;
    }

    logger.info('offline_replay.done', {
      replayed,
      quarantined,
      duration_ms: Math.round(performance.now() - startedAt),
    });
    return { replayed, failed: 0, ...(quarantined > 0 ? { quarantined } : {}) };
  } finally {
    replaying = false;
  }
}
