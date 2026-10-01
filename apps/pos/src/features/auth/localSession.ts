import type { LoginResponse } from '@breakery/supabase';

export interface LocalSession {
  version: 1;
  token: string;
  userId: string;
  permissions: string[];
  expiresAt: number;
  lastActivityAt: number;
  observedAt: number;
  idleMs: number;
}
/** Les échéances viennent du serveur ; aucune restauration ne crée d'activité. */
export function localSessionFromServer(clock: LoginResponse['session_clock'], minutes: number | null | undefined,
  token: string, userId: string, permissions: string[], now = Date.now()): LocalSession | null {
  if (!clock || !Number.isInteger(minutes) || minutes === null || minutes === undefined || minutes < 5 || minutes > 480) return null;
  if (![clock.server_now, clock.created_at, clock.last_activity_at].every((value) => typeof value === 'string')) return null;
  const server = Date.parse(clock.server_now); const created = Date.parse(clock.created_at); const activity = Date.parse(clock.last_activity_at);
  if (![server, created, activity].every(Number.isFinite) || created > server || activity > server
    || !Array.isArray(permissions) || !permissions.every((p) => typeof p === 'string')) return null;
  return { version: 1, token, userId, permissions: [...permissions], expiresAt: now + 86_400_000 - (server - created),
    lastActivityAt: now - (server - activity), observedAt: now, idleMs: minutes * 60_000 };
}
export function localSessionValid(value: LocalSession | null, token: string | null, userId: string | undefined, now = Date.now()): value is LocalSession {
  return Boolean(value?.version === 1 && value.token === token && value.userId === userId
    && Array.isArray(value.permissions) && value.permissions.every((p) => typeof p === 'string')
    && [value.expiresAt, value.lastActivityAt, value.observedAt, value.idleMs].every(Number.isFinite)
    && value.idleMs >= 300_000 && value.idleMs <= 28_800_000 && now >= value.observedAt
    && now >= value.lastActivityAt && now < value.expiresAt && now - value.lastActivityAt < value.idleMs);
}
/** Un onglet créé/copied-opener ou restauré par navigation ne constitue pas un reload. */
export function isSameTabReload(): boolean {
  const navigation = performance.getEntriesByType?.('navigation')[0] as PerformanceNavigationTiming | undefined;
  return navigation?.type === 'reload' && !window.opener;
}
