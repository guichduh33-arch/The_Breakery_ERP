// packages/utils/src/__tests__/env.test.ts
import { describe, it, expect } from 'vitest';
import { parseAppEnv } from '../env';

describe('parseAppEnv', () => {
  it('parses valid app env', () => {
    const env = parseAppEnv({
      VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
      VITE_SUPABASE_ANON_KEY: 'anon-key',
      VITE_SENTRY_DSN_POS: 'https://example@sentry.io/1',
    });
    expect(env.VITE_SUPABASE_URL).toBe('http://127.0.0.1:54321');
  });

  it('throws on missing required', () => {
    expect(() => parseAppEnv({})).toThrow(/SUPABASE_URL/);
  });

  it('allows empty Sentry DSN (dev)', () => {
    const env = parseAppEnv({
      VITE_SUPABASE_URL: 'http://x',
      VITE_SUPABASE_ANON_KEY: 'k',
    });
    expect(env.VITE_SENTRY_DSN_POS).toBeUndefined();
  });
});
