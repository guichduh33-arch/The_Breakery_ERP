// packages/utils/src/env.ts
import { z } from 'zod';

const AppEnvSchema = z.object({
  VITE_SUPABASE_URL: z.string().url(),
  VITE_SUPABASE_ANON_KEY: z.string().min(1),
  VITE_SENTRY_DSN_POS: z.string().url().optional().or(z.literal('').transform(() => undefined)),
  VITE_SENTRY_DSN_BACKOFFICE: z.string().url().optional().or(z.literal('').transform(() => undefined)),
});

export type AppEnv = z.infer<typeof AppEnvSchema>;

// D13 (session 8 perf-debt): cache the last successful parse keyed by the
// stringified input. POS/Backoffice re-import this at every Vite hot-reload
// in dev and at every render that touches env in prod; on a cache hit we skip
// the zod safeParse entirely and return the previously parsed object (same
// reference — callers that compare by reference benefit too).
let _cachedKey: string | null = null;
let _cachedValue: AppEnv | null = null;

export function parseAppEnv(input: Record<string, string | undefined>): AppEnv {
  const key = JSON.stringify(input);
  if (_cachedKey === key && _cachedValue !== null) return _cachedValue;

  const result = AppEnvSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  _cachedKey = key;
  _cachedValue = result.data;
  return result.data;
}
