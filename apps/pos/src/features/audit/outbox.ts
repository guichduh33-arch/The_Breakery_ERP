// apps/pos/src/features/audit/outbox.ts
//
// S72 Lot 2 — durable client outbox for the POS operational audit journal.
// Events are queued write-first so emission NEVER blocks the caisse flow and
// survives an offline span or a restart. The queue is flushed to
// `record_pos_events_v1`, which dedups on (client_event_id, occurred_at) — so
// "no loss, no duplicate" holds: we only drop an event after the server acks it,
// and a re-sent event is a server-side no-op.
//
// Storage backend is picked once at load:
//   • IndexedDB when available (browser)  — async, non-blocking, high capacity.
//   • localStorage fallback (jsdom/tests, exotic hosts) — durable, synchronous.
// Both expose the same async API. IndexedDB is the production path; the
// localStorage path is what CI exercises (jsdom has no indexedDB).

import { logger } from '@breakery/utils';
import type { PosEventEnvelope } from './emitPosEvent';

/** One queued record: the envelope keyed by its client_event_id. */
export interface OutboxRecord {
  id: string; // = client_event_id (primary key)
  event: PosEventEnvelope;
}

const DB_NAME = 'breakery-pos-audit';
const STORE = 'outbox';
const LS_KEY = 'pos:event_outbox';

const hasIDB = typeof indexedDB !== 'undefined' && indexedDB !== null;

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

function lsRead(): OutboxRecord[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as OutboxRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function lsWrite(records: OutboxRecord[]): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(records));
  } catch (err) {
    logger.warn('pos_events.outbox.ls_write_failed', { err: String(err) });
  }
}

// ── Public API (backend-agnostic) ──────────────────────────────────────────

/** Append one event to the durable queue. Idempotent on client_event_id. */
export async function enqueueEvent(event: PosEventEnvelope): Promise<void> {
  const record: OutboxRecord = { id: event.client_event_id, event };
  if (hasIDB) {
    await idbTx('readwrite', (s) => s.put(record));
    return;
  }
  const all = lsRead();
  if (all.some((r) => r.id === record.id)) return; // dedup
  all.push(record);
  lsWrite(all);
}

/** Read every pending record, oldest first (by device_seq then occurred_at). */
export async function getPendingEvents(limit = 500): Promise<OutboxRecord[]> {
  const all = hasIDB
    ? await idbTx<OutboxRecord[]>('readonly', (s) => s.getAll() as IDBRequest<OutboxRecord[]>)
    : lsRead();
  all.sort((a, b) => {
    const sa = a.event.device_seq ?? 0;
    const sb = b.event.device_seq ?? 0;
    if (sa !== sb) return sa - sb;
    return a.event.occurred_at.localeCompare(b.event.occurred_at);
  });
  return all.slice(0, limit);
}

/** Drop records the server has acked (inserted or deduped). */
export async function removeEvents(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  if (hasIDB) {
    await Promise.all(ids.map((id) => idbTx('readwrite', (s) => s.delete(id))));
    return;
  }
  const keep = lsRead().filter((r) => !ids.includes(r.id));
  lsWrite(keep);
}

/** Count of queued events (for an offline / backlog indicator). */
export async function pendingCount(): Promise<number> {
  if (hasIDB) return idbTx<number>('readonly', (s) => s.count());
  return lsRead().length;
}
