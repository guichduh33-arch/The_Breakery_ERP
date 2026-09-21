import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Sentry from '@sentry/react';
import { initSentry } from '../sentry';

vi.mock('@sentry/react', () => ({ init: vi.fn() }));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe('POS error reporting', () => {
  it('does nothing without a DSN', () => {
    vi.stubEnv('VITE_SENTRY_DSN_POS', '');
    initSentry();
    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it('collects only sanitized errors without replay, traces, sessions or attachments', () => {
    vi.stubEnv('VITE_SENTRY_DSN_POS', 'https://public@example.com/1');
    initSentry();
    const options = vi.mocked(Sentry.init).mock.calls[0]?.[0];
    expect(options).toMatchObject({ tracesSampleRate: 0, replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 0, enableLogs: false, maxBreadcrumbs: 0,
      dataCollection: { httpBodies: [], userInfo: false, cookies: false } });
    const integrations = options?.integrations;
    expect(typeof integrations).toBe('function');
    if (typeof integrations !== 'function') throw new Error('Missing integration filter');
    expect(integrations([{ name: 'GlobalHandlers' }, { name: 'BrowserSession' },
      { name: 'Breadcrumbs' }, { name: 'Replay' }, { name: 'BrowserTracing' }]))
      .toEqual([{ name: 'GlobalHandlers' }]);
    const hint = { attachments: [{ filename: 'secret.txt', data: 'private' }] };
    const event = options?.beforeSend?.({ type: undefined, message: 'PIN 1234' }, hint);
    expect(hint.attachments).toEqual([]);
    expect(event).not.toHaveProperty('message');
  });
});
