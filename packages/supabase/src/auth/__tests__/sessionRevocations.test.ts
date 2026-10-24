import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSessionRevocations } from '../sessionRevocations.js';
function storageFixture() {
  const data = new Map<string,string>();
  const storage = { getItem: vi.fn((key: string) => data.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { data.set(key,value); }),
    removeItem: vi.fn((key: string) => { data.delete(key); }), clear: () => data.clear(),
    key: (index: number) => [...data.keys()][index] ?? null, get length() { return data.size; } } satisfies Storage;
  return { storage, data };
}
const environment = 'https://example.test';
const key = `auth:pending-logouts:${encodeURIComponent(environment)}`;
let fixture: ReturnType<typeof storageFixture>;
beforeEach(() => { fixture = storageFixture(); });
afterEach(() => { vi.useRealTimers(); });
const create = (send = vi.fn<(token: string) => Promise<void>>().mockResolvedValue(undefined), env = environment) =>
  createSessionRevocations({ environment: env, storageKey: 'auth', send, storage: () => fixture.storage });
describe('révocation différée sur la persistance d’auth existante', () => {
  it('ferme la seule ancienne identité et ne persiste que le token opaque', () => {
    fixture.data.set('auth',JSON.stringify({ state: { sessionToken: 'opaque', authSnapshot: { access_token: 'jwt' }, user: 'Alice' } }));
    fixture.data.set('cart','keep'); fixture.data.set('outbox','keep');
    const queue = create(); queue.enqueue('opaque');
    expect(fixture.data.get('auth')).toBeUndefined();
    expect(fixture.data.get(key)).toBe('["opaque"]');
    expect(fixture.data.get('cart')).toBe('keep'); expect(fixture.data.get('outbox')).toBe('keep');
    expect(queue.getSnapshot()).toMatchObject({ pending: 1, storageError: false });
  });
  it('recharge après ACK perdu et révoque exactement le même token', async () => {
    const send = vi.fn().mockRejectedValue(new Error('ACK lost'));
    const first = create(send); first.enqueue('opaque'); await first.retry();
    expect(first.getSnapshot().pending).toBe(1);
    const nextSend = vi.fn().mockResolvedValue(undefined); const next = create(nextSend);
    expect(next.getSnapshot().pending).toBe(1); await next.retry();
    expect(nextSend).toHaveBeenCalledExactlyOnceWith('opaque');
    expect(next.getSnapshot()).toMatchObject({ pending: 0, storageError: false });
    expect(fixture.data.get(key)).toBe('[]');
  });
  it('n’efface jamais l’identité d’un nouvel opérateur', async () => {
    fixture.data.set('auth',JSON.stringify({ state: { sessionToken: 'operator-B' } }));
    const queue = create(); queue.enqueue('operator-A'); await queue.retry();
    expect(JSON.parse(fixture.data.get('auth')!)).toEqual({ state: { sessionToken: 'operator-B' } });
  });
  it('sérialise les retries et intègre une seconde déconnexion pendant le réseau', async () => {
    let done!: () => void;
    const send = vi.fn().mockImplementationOnce(() => new Promise<void>((resolve) => { done=resolve; })).mockResolvedValue(undefined);
    const queue = create(send); queue.enqueue('A'); const first=queue.retry();
    expect(queue.retry()).toBe(first); queue.enqueue('B'); done(); await first;
    expect(send.mock.calls).toEqual([['A'],['B']]); expect(queue.getSnapshot().pending).toBe(0);
  });
  it('ne mélange jamais les cibles Supabase', async () => {
    const first=create(); first.enqueue('dev-token');
    const send=vi.fn().mockResolvedValue(undefined); const other=create(send,'https://production.test');
    await other.retry(); expect(send).not.toHaveBeenCalled();
    expect(first.getSnapshot().pending).toBe(1);
  });
  it('signale le quota, conserve le token en RAM et retente après réparation', async () => {
    fixture.storage.setItem.mockImplementation(() => { throw new Error('Quota'); });
    const send=vi.fn().mockRejectedValue(new Error('offline')); const queue=create(send); queue.enqueue('opaque');
    expect(queue.getSnapshot()).toMatchObject({ pending: 1, storageError: true });
    fixture.storage.setItem.mockImplementation((name,value) => { fixture.data.set(name,value); });
    await queue.retry(); expect(fixture.data.get(key)).toBe('["opaque"]');
    send.mockResolvedValue(undefined); await queue.retry(); expect(queue.getSnapshot().pending).toBe(0);
  });
  it('préserve un journal corrompu sans envoyer son contenu', async () => {
    fixture.data.set(key,'{"bearer":"do-not-send"}'); const send=vi.fn(); const queue=create(send);
    await queue.retry(); expect(send).not.toHaveBeenCalled();
    expect(queue.getSnapshot().storageError).toBe(true); expect(fixture.data.get(key)).toContain('do-not-send');
  });
  it('réveille le retry sur online puis détache son listener', async () => {
    const send=vi.fn().mockRejectedValue(new Error('offline')); const queue=create(send); queue.enqueue('opaque');
    const target=new EventTarget(); const stop=queue.start(target); await queue.retry();
    send.mockResolvedValue(undefined); target.dispatchEvent(new Event('online')); await queue.retry();
    expect(queue.getSnapshot().pending).toBe(0); stop(); send.mockClear();
    target.dispatchEvent(new Event('online')); expect(send).not.toHaveBeenCalled();
  });
  it('reprend après une panne cloud sans événement online et arrête le timer au démontage', async () => {
    vi.useFakeTimers();
    const send = vi.fn().mockRejectedValue(new Error('Supabase 503'));
    const queue = create(send); queue.enqueue('operator-A');
    const stop = queue.start(new EventTarget()); await queue.retry();
    expect(queue.getSnapshot().pending).toBe(1);
    fixture.data.set('auth', JSON.stringify({ state: { sessionToken: 'operator-B' } }));
    send.mockResolvedValue(undefined);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(send.mock.calls).toEqual([['operator-A'], ['operator-A']]);
    expect(queue.getSnapshot().pending).toBe(0);
    const persisted = JSON.parse(fixture.data.get('auth')!) as { state: { sessionToken: string } };
    expect(persisted.state.sessionToken).toBe('operator-B');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(send).toHaveBeenCalledTimes(2);
    stop(); queue.enqueue('operator-C');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(send).toHaveBeenCalledTimes(2);
  });
  it('ne double pas un envoi lent pendant les relances temporisées', async () => {
    vi.useFakeTimers();
    let done!: () => void;
    const send = vi.fn().mockImplementation(() => new Promise<void>((resolve) => { done = resolve; }));
    const queue = create(send); queue.enqueue('opaque');
    const stop = queue.start(new EventTarget());
    await vi.advanceTimersByTimeAsync(45_000);
    expect(send).toHaveBeenCalledExactlyOnceWith('opaque');
    done(); await queue.retry(); stop();
    expect(queue.getSnapshot().pending).toBe(0);
  });
});
