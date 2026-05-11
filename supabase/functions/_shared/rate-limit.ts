// supabase/functions/_shared/rate-limit.ts
// Rate limiter in-memory simple (LRU). Suffit pour single-instance Edge Function.

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
const MAX_KEYS = 1000;
const PURGE_SAMPLE_RATE = 0.05;   // D9 — 5% of keys probed per new-bucket insert
const PURGE_SAMPLE_CAP = 50;      // D9 — hard cap to avoid latency spike on a full map

// D9 — Opportunistic stale-bucket purge.
// Edge Function instances are stateless across cold starts, so a setInterval
// would either leak across boots or never fire on cold ones. Instead, every
// time we set a new bucket we sweep a small random sample for stale entries.
// Worst-case cost : 50 Map.get + 50 Map.delete (both O(1)) per insert ≈ <1ms.
function purgeSampleStale(now: number): void {
  if (buckets.size === 0) return;
  const keys = Array.from(buckets.keys());
  const sampleSize = Math.min(PURGE_SAMPLE_CAP, Math.ceil(keys.length * PURGE_SAMPLE_RATE));
  for (let i = 0; i < sampleSize; i++) {
    const idx = Math.floor(Math.random() * keys.length);
    const k = keys[idx];
    if (k === undefined) continue;
    const b = buckets.get(k);
    if (b && b.resetAt < now) buckets.delete(k);
  }
}

export function checkRateLimit(key: string, maxPerMinute = 20): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const windowMs = 60_000;
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt < now) {
    // D9 — sweep stale entries before paying the FIFO eviction cost
    purgeSampleStale(now);
    if (buckets.size >= MAX_KEYS) {
      // Simple eviction : remove oldest
      const firstKey = buckets.keys().next().value;
      if (firstKey !== undefined) buckets.delete(firstKey);
    }
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSec: 0 };
  }

  if (bucket.count >= maxPerMinute) {
    return { allowed: false, retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000) };
  }

  bucket.count++;
  return { allowed: true, retryAfterSec: 0 };
}

export function getClientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]?.trim() ?? 'unknown';
  return req.headers.get('x-real-ip') ?? 'unknown';
}
