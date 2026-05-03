// supabase/functions/_shared/rate-limit.ts
// Rate limiter in-memory simple (LRU). Suffit pour single-instance Edge Function.

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
const MAX_KEYS = 1000;

export function checkRateLimit(key: string, maxPerMinute = 20): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const windowMs = 60_000;
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt < now) {
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
