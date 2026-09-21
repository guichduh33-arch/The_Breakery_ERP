import { describe, expect, it } from 'vitest';
import { sanitizeSentryEvent } from '../sentryPrivacy.js';

describe('Sentry privacy boundary', () => {
  it('drops untrusted payloads but keeps a useful technical stack', () => {
    const event = {
      event_id: 'a'.repeat(32), timestamp: 123,
      message: 'PIN 1234', user: { email: 'client@example.com' },
      request: { headers: { Authorization: 'Bearer secret' }, data: 'payment' },
      extra: { nested: { token: 'secret' } }, contexts: { customer: 'client' },
      breadcrumbs: [{ message: 'payment details' }], tags: { pin: '1234' },
      exception: { values: [{ type: 'TypeError', value: 'client@example.com', stacktrace: {
        frames: [{ filename: 'https://user:secret@host/assets/index-Ab12.js?token=secret#pin',
          lineno: 15, colno: 9, in_app: true, vars: { password: 'secret' },
          pre_context: ['customer data'], function: 'customer@example.com' }],
      } }] },
    };
    const result = sanitizeSentryEvent(event);
    expect(result.exception.values[0]).toEqual({ type: 'TypeError',
      value: 'Application error (details withheld)',
      stacktrace: { frames: [{ filename: 'index-Ab12.js', lineno: 15, colno: 9, in_app: true }] },
    });
    expect(Object.keys(result).sort()).toEqual(['event_id', 'exception', 'level', 'platform', 'timestamp', 'type']);
    expect(JSON.stringify(result)).not.toMatch(/secret|1234|client|customer|payment/);
    expect(event.request.headers.Authorization).toBe('Bearer secret');
  });

  it('rejects custom exception names and filenames that can contain user data', () => {
    const result = sanitizeSentryEvent({ event_id: 'secret', timestamp: NaN,
      exception: { values: [{ type: 'Customer secret', stacktrace: { frames: [
        { filename: 'https://host/customer@example.com', lineno: Infinity },
        { filename: 'http://[invalid' }, {},
      ] } }] },
    });
    expect(result.exception.values[0]?.type).toBe('Error');
    expect(result.exception.values[0]?.stacktrace.frames).toEqual([{}, {}, {}]);
    expect(result).not.toHaveProperty('event_id');
    expect(result).not.toHaveProperty('timestamp');
  });

  it('handles reports without an exception', () => {
    expect(sanitizeSentryEvent({}).exception.values[0]?.value).toBe('Application error (details withheld)');
  });
});
