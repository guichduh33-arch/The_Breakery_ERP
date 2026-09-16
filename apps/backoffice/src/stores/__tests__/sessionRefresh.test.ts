import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ validate: vi.fn(), subscribe: vi.fn(), getState: vi.fn() }));
vi.mock('../authStore.js', () => ({ useAuthStore: { getState: mock.getState, subscribe: mock.subscribe } }));
import { startSessionRefresh } from '../sessionRefresh.js';

describe('refresh JWT du back-office', () => {
  let stop: (() => void) | undefined;
  let state: { isAuthenticated: boolean; sessionToken: string | null; authSnapshot: { expires_at: number }; validateSession: typeof mock.validate };
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(0); vi.clearAllMocks();
    state = { isAuthenticated: true, sessionToken: 'token', authSnapshot: { expires_at: 3600 }, validateSession: mock.validate };
    mock.getState.mockImplementation(() => state);
    mock.subscribe.mockReturnValue(vi.fn());
    mock.validate.mockImplementation(() => {
      state.authSnapshot = { expires_at: Date.now() / 1000 + 3600 };
      return Promise.resolve();
    });
  });
  afterEach(() => { stop?.(); vi.useRealTimers(); });
  it('garde un JWT valide au-delà de 60 minutes et renouvelle avec dix minutes de marge', async () => {
    stop = startSessionRefresh();
    await vi.advanceTimersByTimeAsync(49 * 60_000);
    expect(mock.validate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(16 * 60_000);
    expect(mock.validate).toHaveBeenCalledOnce();
    expect(state.authSnapshot.expires_at).toBeGreaterThan(Date.now() / 1000);
    await vi.advanceTimersByTimeAsync(35 * 60_000);
    expect(mock.validate).toHaveBeenCalledTimes(2);
  });
  it('réessaie après une panne transitoire sans boucle rapide', async () => {
    mock.validate.mockResolvedValue(undefined);
    stop = startSessionRefresh();
    await vi.advanceTimersByTimeAsync(51 * 60_000);
    expect(mock.validate).toHaveBeenCalledTimes(2);
  });
  it('ne renouvelle plus après logout ou démontage', async () => {
    stop = startSessionRefresh();
    state.isAuthenticated = false; state.sessionToken = null;
    const listener = mock.subscribe.mock.calls[0]?.[0] as (next: typeof state, previous: typeof state) => void;
    listener(state, { ...state, isAuthenticated: true });
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(mock.validate).not.toHaveBeenCalled();
    stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});
