import { describe, expect, it } from 'vitest';
import { sessionRejection, type SessionPolicyInput } from '../../functions/_shared/session-policy';

const NOW = Date.parse('2026-09-09T12:00:00Z');
function session(minutes: number, idleMinutes: number, ageHours = 2): SessionPolicyInput {
  return { created_at: new Date(NOW-ageHours*3600000).toISOString(),
    last_activity_at: new Date(NOW-idleMinutes*60000).toISOString(), ended_at: null,
    session_timeout_minutes: minutes, permissions_snapshot: ['orders.read'] };
}
describe('politique des sessions', () => {
  it.each([5,30,120])('respecte exactement %i minutes d’inactivité', (minutes) => {
    expect(sessionRejection(session(minutes,minutes-0.001), NOW)).toBeNull();
    expect(sessionRejection(session(minutes,minutes), NOW)).toBe('session_timeout');
  });
  it('ne termine pas une session active après 60 minutes', () => {
    expect(sessionRejection(session(5,0.1,2), NOW)).toBeNull();
  });
  it('refuse une session de 24 h malgré activité récente', () => {
    expect(sessionRejection(session(120,0,24), NOW)).toBe('session_expired');
  });
  it('refuse les sessions anciennes sans snapshot', () => {
    expect(sessionRejection({ ...session(30,0), permissions_snapshot: null }, NOW)).toBe('session_snapshot_required');
    expect(sessionRejection({ ...session(30,0), session_timeout_minutes: null }, NOW)).toBe('session_snapshot_required');
  });
  it('accepte un snapshot de permissions vide', () => {
    expect(sessionRejection({ ...session(30,0), permissions_snapshot: [] }, NOW)).toBeNull();
  });
  it('ne ressuscite pas une session terminée', () => {
    expect(sessionRejection({ ...session(30,0), ended_at: new Date(NOW).toISOString() }, NOW)).toBe('session_expired');
  });
  it('refuse des horodatages invalides', () => {
    expect(sessionRejection({ ...session(30,0), last_activity_at: 'invalid' }, NOW)).toBe('session_expired');
  });
});
