// packages/domain/src/lan/messageDedup.ts
//
// Session 13 / Phase 5.A — Bounded message-id dedup ring with TTL.
//
// The LAN hybrid transport (D4) means a same-origin POS + hub can see the
// same envelope twice (once via BroadcastChannel, once via Realtime). The
// audit P1 finding in `docs/audit/08-operations-lan-audit.md` §1.1
// requires : *"`processMessage()` maintains a Set<string> of the last 200
// message IDs, TTL 5s"*.
//
// This is the pure, IO-free implementation. Both `lanHub.ts` and
// `lanClient.ts` instantiate one ring each and call `.seen(message.id)`
// before dispatching ; if it returns `true` the message is dropped
// silently (with a debug breadcrumb).
//
// Properties :
//   * O(1) `seen()` (Set + ordered insertion FIFO eviction)
//   * Memory-bounded (default 200 entries → ~10 KB on V8)
//   * TTL-pruned : `seen()` opportunistically drops entries older than `ttlMs`
//   * Deterministic : no wall-clock dependency at construction time (clock is injected per-call via `Date.now`)

/** Internal record kept per id. */
interface DedupEntry {
  id: string;
  insertedAt: number;
}

export interface MessageDedupOptions {
  /** Maximum number of ids retained at any time. Default 200. */
  maxSize?: number;
  /** Entries older than `ttlMs` are pruned on each `seen()` call. Default 5000ms. */
  ttlMs?: number;
  /** Clock override for deterministic tests. Defaults to `Date.now`. */
  now?: () => number;
}

export class MessageDedup {
  private readonly entries: Map<string, DedupEntry>;
  private readonly maxSize: number;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private droppedDuplicates = 0;

  constructor(opts: MessageDedupOptions = {}) {
    this.entries = new Map();
    this.maxSize = opts.maxSize ?? 200;
    this.ttlMs = opts.ttlMs ?? 5_000;
    this.now = opts.now ?? Date.now;
  }

  /** Returns true if `id` has been seen within the TTL window. Records the
   * id otherwise. Prunes expired entries opportunistically. */
  seen(id: string): boolean {
    this.prune();

    const existing = this.entries.get(id);
    if (existing !== undefined) {
      this.droppedDuplicates += 1;
      return true;
    }

    // Insert + enforce size cap (FIFO eviction).
    this.entries.set(id, { id, insertedAt: this.now() });
    if (this.entries.size > this.maxSize) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    return false;
  }

  /** Prunes expired entries. Idempotent. */
  prune(): void {
    const cutoff = this.now() - this.ttlMs;
    // Map preserves insertion order — entries before cutoff are at the
    // front, so we can break on the first non-expired entry.
    for (const [id, entry] of this.entries) {
      if (entry.insertedAt < cutoff) {
        this.entries.delete(id);
      } else {
        break;
      }
    }
  }

  /** Current number of cached ids (post-prune). Useful for tests + metrics. */
  size(): number {
    this.prune();
    return this.entries.size;
  }

  /** Number of duplicate drops since construction. Reset via `resetStats()`. */
  droppedCount(): number {
    return this.droppedDuplicates;
  }

  /** Clears every cached id. Reset duplicate counter too. */
  clear(): void {
    this.entries.clear();
    this.droppedDuplicates = 0;
  }

  /** Reset metrics only ; keep cached ids. */
  resetStats(): void {
    this.droppedDuplicates = 0;
  }
}
