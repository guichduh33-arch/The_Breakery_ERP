import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Sentry from '@sentry/react';

vi.mock('@sentry/react', () => ({ init: vi.fn() }));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); vi.resetModules(); });

describe('Back-office error reporting', () => {
  async function initialize(dsn: string) {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-only');
    vi.stubEnv('VITE_SENTRY_DSN_BACKOFFICE', dsn);
    const { initSentry } = await import('../sentry.js');
    initSentry();
  }

  it('does nothing without a DSN', async () => {
    await initialize('');
    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it('removes all private payloads and disables additional telemetry', async () => {
    await initialize('https://public@example.com/1');
    const options = vi.mocked(Sentry.init).mock.calls[0]?.[0];
    expect(options).toMatchObject({ tracesSampleRate: 0, replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 0, enableLogs: false, maxBreadcrumbs: 0 });
    const hint = { attachments: [{ filename: 'secret.txt', data: 'private' }] };
    expect(options?.beforeSend?.({ type: undefined, user: { email: 'private@example.com' } }, hint))
      .not.toHaveProperty('user');
    expect(hint.attachments).toEqual([]);
    const integrations = options?.integrations;
    if (typeof integrations !== 'function') throw new Error('Missing integration filter');
    expect(integrations([{ name: 'GlobalHandlers' }, { name: 'BrowserSession' }, { name: 'Breadcrumbs' }]))
      .toEqual([{ name: 'GlobalHandlers' }]);
  });
});
