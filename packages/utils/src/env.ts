// packages/utils/src/env.ts
import { z } from 'zod';

const AppEnvSchema = z.object({
  VITE_SUPABASE_URL: z.string().url(),
  VITE_SUPABASE_ANON_KEY: z.string().min(1),
  VITE_SENTRY_DSN_POS: z.string().url().optional().or(z.literal('').transform(() => undefined)),
  VITE_SENTRY_DSN_BACKOFFICE: z.string().url().optional().or(z.literal('').transform(() => undefined)),
});

export type AppEnv = z.infer<typeof AppEnvSchema>;

export function parseAppEnv(input: Record<string, string | undefined>): AppEnv {
  const result = AppEnvSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  return result.data;
}
