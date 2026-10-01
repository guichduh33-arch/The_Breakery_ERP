import { afterEach, describe, expect, it, vi } from 'vitest';
import { isSameTabReload, localSessionFromServer, localSessionValid } from '../localSession';
const now = Date.parse('2026-09-30T12:00:00Z');
const clock = { server_now: new Date(now).toISOString(), created_at: new Date(now - 60_000).toISOString(), last_activity_at: new Date(now - 30_000).toISOString() };
afterEach(() => vi.unstubAllGlobals());
describe('snapshot de session local', () => {
  it('conserve temps absolu et inactivité sans remise à zéro', () => {
    const snapshot = localSessionFromServer(clock, 5, 'token', 'user', ['sales.create'], now)!;
    expect(snapshot.lastActivityAt).toBe(now - 30_000);
    expect(snapshot.expiresAt).toBe(now - 60_000 + 86_400_000);
    expect(localSessionValid(snapshot, 'token', 'user', now + 269_999)).toBe(true);
    expect(localSessionValid(snapshot, 'token', 'user', now + 270_000)).toBe(false);
    expect(localSessionValid({ ...snapshot, lastActivityAt: snapshot.expiresAt - 1 }, 'token', 'user', snapshot.expiresAt)).toBe(false);
  });
  it('refuse legacy, mauvais acteur/token et horloge reculée', () => {
    expect(localSessionFromServer(undefined, 30, 'token', 'user', [], now)).toBeNull();
    expect(localSessionFromServer(clock, 0, 'token', 'user', [], now)).toBeNull();
    const snapshot = localSessionFromServer(clock, 30, 'token', 'user', [], now)!;
    expect(localSessionValid(snapshot, 'other', 'user', now)).toBe(false);
    expect(localSessionValid(snapshot, 'token', 'other', now)).toBe(false);
    expect(localSessionValid(snapshot, 'token', 'user', now - 1)).toBe(false);
  });
  it.each(['navigate', 'back_forward', 'prerender'])('refuse navigation %s même avec storage existant', (type) => {
    vi.stubGlobal('performance', { getEntriesByType: () => [{ type }] });
    expect(isSameTabReload()).toBe(false);
  });
  it('exige reload sans opener', () => {
    vi.stubGlobal('performance', { getEntriesByType: () => [{ type: 'reload' }] });
    expect(isSameTabReload()).toBe(true);
    vi.stubGlobal('opener', {});
    expect(isSameTabReload()).toBe(false);
  });
});
