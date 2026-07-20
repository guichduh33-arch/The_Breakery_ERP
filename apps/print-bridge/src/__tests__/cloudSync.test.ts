// apps/print-bridge/src/__tests__/cloudSync.test.ts
// Spec 006x lot 2 — push heartbeat agrégé hub → EF lan-heartbeat-batch.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startCloudSync, type CloudSyncHandle } from '../hub/cloudSync.js';

const URL_ = 'https://x.supabase.co/functions/v1/lan-heartbeat-batch';

function okResponse(bodyJson: unknown): Response {
  return { ok: true, status: 200, json: () => Promise.resolve(bodyJson) } as unknown as Response;
}

describe('startCloudSync', () => {
  let handle: CloudSyncHandle | null = null;

  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => {
    handle?.stop();
    handle = null;
    vi.useRealTimers();
  });

  it('POSTs deduped device codes with the secret in x-hub-secret', async () => {
    const fetchFn = vi.fn().mockResolvedValue(okResponse({ touched: ['POS-1'], unknown: ['GHOST'] }));
    handle = startCloudSync({
      presentCodes: () => ['POS-1', 'POS-1', 'GHOST'],
      url: URL_, secret: 's3cret', fetchFn,
    });
    await handle.tick();

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(URL_);
    expect((init.headers as Record<string, string>)['x-hub-secret']).toBe('s3cret');
    expect(JSON.parse(init.body as string)).toEqual({ device_codes: ['POS-1', 'GHOST'] });

    const status = handle.status();
    expect(status.last_result).toBe('ok');
    expect(status.last_pushed).toEqual(['POS-1']);
    expect(status.last_unknown).toEqual(['GHOST']);
    expect(status.last_push_at).not.toBeNull();
  });

  it('skips the POST entirely when no device is on the bus', async () => {
    const fetchFn = vi.fn();
    handle = startCloudSync({ presentCodes: () => [], url: URL_, secret: 's', fetchFn });
    await handle.tick();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('records an http error without throwing, then recovers', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 401, json: () => Promise.resolve({}) })
      .mockResolvedValueOnce(okResponse({ touched: ['POS-1'], unknown: [] }));
    handle = startCloudSync({ presentCodes: () => ['POS-1'], url: URL_, secret: 'bad', fetchFn });

    await handle.tick();
    expect(handle.status().last_result).toBe('error');
    expect(handle.status().last_error).toBe('http_401');

    await handle.tick();
    expect(handle.status().last_result).toBe('ok');
    expect(handle.status().last_error).toBeNull();
  });

  it('records a network error (internet down) without throwing', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('fetch failed'));
    handle = startCloudSync({ presentCodes: () => ['POS-1'], url: URL_, secret: 's', fetchFn });
    await handle.tick();
    expect(handle.status().last_result).toBe('error');
    expect(handle.status().last_error).toBe('fetch failed');
  });

  it('ticks on its interval and stops after stop()', async () => {
    const fetchFn = vi.fn().mockResolvedValue(okResponse({ touched: [], unknown: [] }));
    handle = startCloudSync({
      presentCodes: () => ['POS-1'], url: URL_, secret: 's', fetchFn, intervalMs: 10_000,
    });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    handle.stop();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });
});
