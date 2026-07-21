// apps/pos/src/features/lan/offlineOutbox.ts
//
// Spec 006x lot 4 — outbox durable des INTENTIONS métier prises en mode
// OFFLINE (fire caisse, envoi tablette, encaissement cash différé). Modèle
// répliqué de l'outbox d'audit (features/audit/outbox.ts) : write-first,
// IndexedDB en prod / localStorage en fallback (jsdom, hôtes exotiques),
// même API async des deux côtés.
//
// Chaque intent porte la clé d'idempotence D'ORIGINE (client_uuid RPC ou
// idempotency_key paiement) : le replay (offlineReplay.ts) rejoue les RPCs
// EXISTANTES avec ces clés — un double replay est un no-op serveur (§4.3).
// Un record n'est supprimé qu'après l'ack serveur : « no loss, no duplicate ».

import { logger } from '@breakery/utils';
import type { BusModifierLine } from './busTopics';

/** Ligne d'items au format attendu par fire_counter_order_v4 p_items. */
export interface OfflineFireItem {
  product_id: string;
  quantity: number;
  unit_price: number;
  modifiers: BusModifierLine[];
  combo_components?: { product_id: string; quantity: number }[];
  /** Remise de ligne AUTORISÉE EN LIGNE avant la coupure (le PIN a été validé
   *  à l'application) — rejouée telle quelle, l'authorizer regagné serveur. */
  discount_amount?: number;
}

interface OfflineIntentBase {
  /** Clé primaire = clé d'idempotence rejouée au serveur. */
  id: string;
  /** Ordre de replay strict par terminal (séquence locale monotone). */
  seq: number;
  created_at: string;
}

/** Fire caisse offline — rejoué vers fire_counter_order_v4 (même client_uuid). */
export interface OfflineFireIntent extends OfflineIntentBase {
  kind: 'fire';
  /** client_uuid RACINE de la commande locale (= id du 1ᵉʳ fire). Un append
   *  offline garde son propre id (idempotence RPC) mais pointe la racine —
   *  le replay le convertit en p_order_id une fois la racine rejouée. */
  root_client_uuid: string;
  local_number: string;
  session_id: string;
  order_type: string;
  table_number: string | null;
  items: OfflineFireItem[];
  /** user_profiles.id du manager ayant autorisé une remise de ligne (capturé
   *  online avant la coupure) — p_discount_authorized_by au replay. */
  discount_authorized_by?: string;
}

/** Encaissement CASH offline — rejoué vers pay_existing_order_v13
 *  (p_idempotency_key d'origine + p_offline_replay, arbitrage A4). */
export interface OfflineCashPaymentIntent extends OfflineIntentBase {
  kind: 'cash_payment';
  /** Racine de la commande locale à payer (fire intent). */
  root_client_uuid: string;
  local_number: string;
  payment: { method: 'cash'; amount: number; cash_received: number; change_given: number };
  /** Client attaché AVANT la coupure — p_customer_id au replay (les points
   *  fidélité sont résolus serveur, jamais calculés offline). */
  customer_id?: string;
}

/** Envoi tablette offline — rejoué vers create_tablet_order_v4 (même client_uuid). */
export interface OfflineTabletOrderIntent extends OfflineIntentBase {
  kind: 'tablet_order';
  local_number: string;
  waiter_id: string;
  table_number: string;
  order_type: string;
  notes: string | null;
  items: unknown[]; // buildSubmitPayload().p_items — format wire de la RPC.
}

export type OfflineIntent = OfflineFireIntent | OfflineCashPaymentIntent | OfflineTabletOrderIntent;

const DB_NAME = 'breakery-pos-offline';
const STORE = 'outbox';
const LS_KEY = 'pos:offline_outbox';
const SEQ_KEY = 'breakery-offline-intent-seq';

const hasIDB = typeof indexedDB !== 'undefined' && indexedDB !== null;

/** Séquence locale monotone (localStorage) — ordonne le replay par terminal. */
export function nextIntentSeq(storage: Pick<Storage, 'getItem' | 'setItem'> | null = null): number {
  const s = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
  if (s === null) return Date.now();
  try {
    const next = Number(s.getItem(SEQ_KEY) ?? '0') + 1;
    s.setItem(SEQ_KEY, String(next));
    return next;
  } catch {
    return Date.now();
  }
}

// ── IndexedDB backend ──────────────────────────────────────────────────────

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexeddb_open_failed'));
  });
  return dbPromise;
}

function idbTx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('indexeddb_tx_failed'));
      }),
  );
}

// ── localStorage backend ───────────────────────────────────────────────────

function lsRead(): OfflineIntent[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as OfflineIntent[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function lsWrite(records: OfflineIntent[]): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(records));
  } catch (err) {
    logger.warn('offline_outbox.ls_write_failed', { err: String(err) });
  }
}

// ── Public API (backend-agnostic) ──────────────────────────────────────────

/** Append durable — AVANT le publish bus (spec §4.3 : écrit PUIS publie).
 *  Idempotent sur id. */
export async function enqueueIntent(intent: OfflineIntent): Promise<void> {
  if (hasIDB) {
    await idbTx('readwrite', (s) => s.put(intent));
    return;
  }
  const all = lsRead();
  if (all.some((r) => r.id === intent.id)) return;
  all.push(intent);
  lsWrite(all);
}

/** Tous les intents en attente, ordre de replay (seq croissante). */
export async function getPendingIntents(): Promise<OfflineIntent[]> {
  const all = hasIDB
    ? await idbTx<OfflineIntent[]>('readonly', (s) => s.getAll() as IDBRequest<OfflineIntent[]>)
    : lsRead();
  return all.sort((a, b) => a.seq - b.seq);
}

/** Drop après ack serveur (rejoué ou replay idempotent). */
export async function removeIntents(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  if (hasIDB) {
    await Promise.all(ids.map((id) => idbTx('readwrite', (s) => s.delete(id))));
    return;
  }
  lsWrite(lsRead().filter((r) => !ids.includes(r.id)));
}

/** Purge des intents d'une commande locale (void AVANT tout replay : la
 *  commande n'a jamais existé en DB, rien à rejouer). Best effort. */
export async function removeIntentsByRoot(rootClientUuid: string): Promise<void> {
  const pending = await getPendingIntents();
  const ids = pending
    .filter((r) => r.kind !== 'tablet_order' && r.root_client_uuid === rootClientUuid)
    .map((r) => r.id);
  await removeIntents(ids);
}

/** Backlog (indicateur UI / panneau hub). */
export async function pendingIntentCount(): Promise<number> {
  if (hasIDB) return idbTx<number>('readonly', (s) => s.count());
  return lsRead().length;
}
