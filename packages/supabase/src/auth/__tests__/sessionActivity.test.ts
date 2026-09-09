import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startSessionActivity } from '../sessionActivity';

describe('activité de session', () => {
  let target: EventTarget;
  let stop: () => void;
  let session: { sessionToken: string; isAuthenticated: boolean; isLocked: boolean };
  let online: boolean;
  const send = vi.fn<(token: string) => Promise<void>>();
  const expired = vi.fn();
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(0); vi.clearAllMocks();
    target = new EventTarget(); online = true;
    session = { sessionToken: 'token', isAuthenticated: true, isLocked: false };
    send.mockResolvedValue(undefined);
    stop = startSessionActivity({ getSession: () => session, send, onExpired: expired, target, isOnline: () => online });
  });
  afterEach(() => { stop(); vi.useRealTimers(); });
  const activity = () => { target.dispatchEvent(new Event('keydown')); };
  it('ne produit aucun heartbeat sans événement', async () => {
    await vi.advanceTimersByTimeAsync(2*3600000);
    expect(send).not.toHaveBeenCalled();
  });
  it('limite les événements continus à une écriture par minute', async () => {
    activity();
    await vi.advanceTimersByTimeAsync(10000); activity(); activity();
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(50000);
    expect(send).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(3600000);
    expect(send).toHaveBeenCalledTimes(2);
  });
  it('annule le heartbeat en attente quand le terminal est verrouillé', async () => {
    activity(); await vi.advanceTimersByTimeAsync(1000); activity();
    session.isLocked = true;
    await vi.advanceTimersByTimeAsync(120000); activity();
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('ne rejoue pas une activité hors ligne au retour du réseau', async () => {
    online = false; activity(); await vi.advanceTimersByTimeAsync(120000);
    online = true; await vi.advanceTimersByTimeAsync(120000);
    expect(send).not.toHaveBeenCalled();
    activity(); await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('conserve l’état local sur panne réseau sans retry caché', async () => {
    send.mockRejectedValueOnce(new Error('offline')); activity();
    await vi.advanceTimersByTimeAsync(120000);
    expect(send).toHaveBeenCalledTimes(1); expect(expired).not.toHaveBeenCalled();
    expect(session.sessionToken).toBe('token');
  });
  it('signale une expiration seulement pour la session encore courante', async () => {
    send.mockRejectedValueOnce(Object.assign(new Error('expired'), { status: 401 }));
    activity(); await vi.advanceTimersByTimeAsync(0);
    expect(expired).toHaveBeenCalledOnce();
  });
  it('reste actif pendant plus d’une heure sans accélérer la fréquence', async () => {
    for (let minute=0; minute<65; minute++) { activity(); await vi.advanceTimersByTimeAsync(60000); }
    expect(send).toHaveBeenCalledTimes(65);
  });
  it('retire les listeners et timers au démontage', async () => {
    stop(); activity(); await vi.advanceTimersByTimeAsync(120000);
    expect(send).not.toHaveBeenCalled();
  });
});
