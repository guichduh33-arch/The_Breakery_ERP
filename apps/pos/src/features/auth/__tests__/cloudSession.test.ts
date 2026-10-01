import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/supabase', () => ({ supabaseUrl: 'https://example.invalid' }));
vi.mock('@/lib/queryClient', () => ({ queryClient: { invalidateQueries: vi.fn() } }));
const { ping } = vi.hoisted(() => ({ ping: vi.fn() }));
vi.mock('@/features/lan/hooks/useCloudPing', () => ({ pingCloud: ping }));
import { useAuthStore } from '@/stores/authStore';
import { useCloudStatusStore } from '@/features/lan/cloudStatusStore';
import { startCloudSession } from '../cloudSession';
const originalValidate = useAuthStore.getState().validateSession;
let stop: (() => void) | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  ping.mockClear();
  ping.mockResolvedValue(false);
  useCloudStatusStore.setState({ cloudOnline: false });
  useAuthStore.setState({ validateSession: originalValidate, isAuthenticated: true, sessionToken: 'token', bootstrapStatus: 'ready', cloudValidated: false, lockReason: null });
});
afterEach(() => { stop?.(); vi.restoreAllMocks(); vi.useRealTimers(); });
describe('revalidation coordonnée', () => {
  it('WAN revenu : un seul probe, cloud fermé jusqu’au résultat valide', async () => {
    let resolve!: () => void;
    const validate = vi.spyOn(useAuthStore.getState(), 'validateSession').mockImplementation(() => new Promise<void>((r) => { resolve = r; }));
    stop = startCloudSession();
    await vi.advanceTimersByTimeAsync(1);
    expect(validate).not.toHaveBeenCalled();
    useCloudStatusStore.getState().setCloudOnline(true);
    vi.advanceTimersByTime(30_000);
    expect(validate).toHaveBeenCalledOnce();
    expect(useAuthStore.getState().cloudValidated).toBe(false);
    resolve();
  });
  it('reprend depuis une page sans ping dédié après confirmation de santé', async () => {
    ping.mockResolvedValue(true);
    const validate = vi.spyOn(useAuthStore.getState(), 'validateSession').mockResolvedValue(undefined);
    stop = startCloudSession();
    await vi.advanceTimersByTimeAsync(1);
    expect(ping).toHaveBeenCalledOnce();
    expect(validate).toHaveBeenCalledOnce();
    expect(useAuthStore.getState().cloudValidated).toBe(false);
  });
});
