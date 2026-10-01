// apps/pos/src/stores/authStore.ts
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import {
  loginWithPin,
  getSession,
  logoutSession,
  setSupabaseAccessToken,
  setSupabaseCloudEnabled,
  type LoginResponse,
  type PermissionCode,
  hasPermission as has,
} from '@breakery/supabase';
import { safeStorage, logger } from '@breakery/utils';
import { supabaseUrl } from '../lib/supabase.js';
import { isSameTabReload, localSessionFromServer, localSessionValid, type LocalSession } from '@/features/auth/localSession';
import { useCloudStatusStore } from '@/features/lan/cloudStatusStore';

export interface AuthUser {
  id: string;
  full_name: string;
  role_code: string;
  employee_code: string;
}

/**
 * Boot-time rehydration lifecycle. `isAuthenticated` + `sessionToken` survive a
 * reload (persisted), but `permissions` and the PIN bearer (`_accessToken` in
 * the supabase client, a module variable) do NOT. They must be restored from
 * `auth-get-session` before any query fires — otherwise every Supabase request
 * goes out with only the anon key and 401s (the reload bug + retry storm).
 *
 * pending → loading → ready | error. On `error` (backend unreachable) the
 * session is KEPT so a retry can recover without a fresh PIN login.
 */
export type BootstrapStatus = 'pending' | 'loading' | 'ready' | 'error';

interface AuthState {
  localSession: LocalSession | null;
  cloudValidated: boolean;
  suspendCloud: () => void;
  recordLocalActivity: () => void;
  user: AuthUser | null;
  sessionToken: string | null;
  permissions: string[];
  isAuthenticated: boolean;
  // Le verrou survit au reload ; seul un PIN vérifié en ligne permet la reprise.
  isLocked: boolean;
  // Why the gate is up. 'manual' covers the Lock button and the idle timeout ;
  // 'session_expired' is raised by the 401-storm watchdog when the server no
  // longer honors the PIN session — the overlay copy tells the cashier the
  // session died instead of pretending the terminal was parked on purpose.
  lockReason: 'manual' | 'session_expired' | null;
  isLoading: boolean;
  error: string | null;
  bootstrapStatus: BootstrapStatus;
  // Session 19 / Phase 3.A — populated by validateSession() from the role row.
  // null until the first auth-get-session round-trip lands (e.g. fresh login
  // before the rehydrate fires). Treat null/0 as "no idle logout".
  sessionTimeoutMinutes: number | null;
  // Backlog 401 — expiry (epoch seconds) of the PIN JWT currently injected in
  // the fetch wrapper. Drives the proactive refresh timer (sessionRefresh.ts).
  // NOT persisted: a reload goes through bootstrap(), which re-mints anyway.
  // null when the EF predates the re-mint field — the reactive watchdog
  // (sessionDeathWatch) then remains the only net.
  authExpiresAt: number | null;

  login: (userId: string, pin: string) => Promise<void>;
  logout: () => Promise<void>;
  bootstrap: () => Promise<void>;
  lock: (reason?: 'manual' | 'session_expired') => void;
  unlock: () => void;
  validateSession: () => Promise<void>;
  hasPermission: (code: PermissionCode) => boolean;
  setError: (msg: string | null) => void;
}

const STORAGE_KEY = 'breakery-pos-auth';
let authGeneration = 0;
interface SessionFlight { token: string; generation: number; requestedAt: number; promise: ReturnType<typeof getSession> }
let activeFlight: SessionFlight | null = null;
/** Bootstrap, StrictMode et refresh partagent la même réponse réseau. */
function sessionFlight(token: string): SessionFlight {
  if (activeFlight?.token === token && activeFlight.generation === authGeneration) return activeFlight;
  const flight: SessionFlight = { token, generation: authGeneration, requestedAt: Date.now(), promise: getSession(supabaseUrl, token) };
  activeFlight = flight;
  const finish = (): void => { if (activeFlight === flight) activeFlight = null; };
  void flight.promise.then(finish, finish);
  return flight;
}
// Le shell monte des observateurs avant BootGate : fermer avant leurs effets.
// bootstrap sans session réouvre immédiatement les surfaces anonymes/kiosk.
setSupabaseCloudEnabled(false);

const asyncStorage = {
  getItem: (name: string) => safeStorage.get(name),
  setItem: (name: string, value: string) => safeStorage.set(name, value),
  removeItem: (name: string) => safeStorage.remove(name),
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      localSession: null,
      cloudValidated: false,
      sessionToken: null,
      permissions: [],
      isAuthenticated: false,
      isLocked: false,
      lockReason: null,
      isLoading: false,
      error: null,
      bootstrapStatus: 'pending',
      sessionTimeoutMinutes: null,
      authExpiresAt: null,

      async login(userId, pin) {
        authGeneration += 1;
        const requestedAt = Date.now();
        if (navigator.onLine === false) throw new Error('Connect to the server to sign in');
        set({ isLoading: true, error: null });
        try {
          const res: LoginResponse = await loginWithPin(supabaseUrl, {
            user_id: userId,
            pin,
            device_type: 'pos',
          });
          // Session 13 (task 25-003) — drop client PIN fallback.
          // The PIN flow mints an HS256 JWT that GoTrue (ES256-only on modern
          // Supabase CLI) refuses to validate via `auth.setSession`. We inject
          // the bearer token directly via the custom-fetch wrapper. NO
          // `supabase.auth.setSession()` here, NO `signOut()` in logout.
          setSupabaseAccessToken(res.auth.access_token);
          setSupabaseCloudEnabled(true);
          set({
            cloudValidated: true,
            localSession: localSessionFromServer(res.session_clock, res.session_timeout_minutes, res.session.token, res.user.id, res.permissions, requestedAt),
            user: res.user,
            sessionToken: res.session.token,
            permissions: res.permissions,
            sessionTimeoutMinutes: res.session_timeout_minutes ?? 30,
            isAuthenticated: true,
            isLoading: false,
            bootstrapStatus: 'ready',
            authExpiresAt: res.auth.expires_at,
          });
          logger.info('login.success', { user_id: res.user.id });
        } catch (err: unknown) {
          // Session 13 (task 25-004) — error redaction. The EF already
          // collapses identity-mode failures to `invalid_credentials`. Show
          // that generically ; never echo internal error codes to the user.
          const e = err as { details?: { error?: string }; message?: string };
          const rawError = e.details?.error ?? e.message ?? 'login_failed';
          const userFacing =
            rawError === 'rate_limited' || rawError === 'account_locked'
              ? rawError
              : 'invalid_credentials';
          set({ error: userFacing, isLoading: false });
          logger.warn('login.failed', { reason: rawError });
          throw err;
        }
      },

      async logout() {
        authGeneration += 1;
        const token = get().sessionToken;
        if (token) {
          try { await logoutSession(supabaseUrl, token); } catch { /* ignore */ }
        }
        // Drop the client-side bearer (counterpart to setSupabaseAccessToken on login).
        setSupabaseAccessToken(null);
        setSupabaseCloudEnabled(true);
        set({
          localSession: null,
          cloudValidated: false,
          user: null,
          sessionToken: null,
          permissions: [],
          isAuthenticated: false,
          isLocked: false,
          lockReason: null,
          error: null,
          // Terminal state — bootstrap is "done" (router → /login). Never leave
          // it loading/error after a sign-out.
          bootstrapStatus: 'ready',
          sessionTimeoutMinutes: null,
          authExpiresAt: null,
        });
      },

      /**
       * Boot-time rehydration. Call once on app mount. If a PIN session was
       * persisted, restore the bearer (lost on reload — it lives in a module
       * variable, not storage) AND re-fetch permissions before any query fires.
       * The shell must stay behind the 'loading' gate until this resolves, or
       * every Supabase request 401s with only the anon key.
       */
      async bootstrap() {
        const { sessionToken, isAuthenticated } = get();
        if (!sessionToken || !isAuthenticated) {
          setSupabaseCloudEnabled(true);
          // No PIN session (fresh load, or kiosk/display/tablet surfaces that
          // use their own token) — nothing to restore.
          set({ bootstrapStatus: 'ready' });
          return;
        }
        if (get().lockReason === 'session_expired') { set({ bootstrapStatus: 'ready' }); return; }
        get().suspendCloud();
        if (!isSameTabReload()) set({ localSession: null });
        set({ bootstrapStatus: 'loading', error: null });
        const flight = sessionFlight(sessionToken);
        try {
          const session = await flight.promise;
          if (get().sessionToken !== sessionToken || authGeneration !== flight.generation) return;
          if (session.auth) {
            // Restore the PIN bearer so RLS-protected queries stop 401-ing.
            setSupabaseAccessToken(session.auth.access_token);
          }
          setSupabaseCloudEnabled(true);
          set({
            cloudValidated: true,
            localSession: localSessionFromServer(session.session_clock, session.session_timeout_minutes, sessionToken, session.id, session.permissions, flight.requestedAt),
            user: { id: session.id, full_name: session.full_name, role_code: session.role_code, employee_code: session.employee_code },
            permissions: session.permissions,
            isAuthenticated: true,
            sessionTimeoutMinutes: session.session_timeout_minutes,
            bootstrapStatus: 'ready',
            authExpiresAt: session.auth?.expires_at ?? null,
          });
          logger.info('bootstrap.rehydrated', { user_id: session.id, perms: session.permissions.length });
        } catch (err: unknown) {
          const e = err as { status?: number };
          if (get().sessionToken !== sessionToken || authGeneration !== flight.generation) return;
          if (e.status === 401 || e.status === 403 || e.status === 404) {
            get().lock('session_expired');
            set({ bootstrapStatus: 'ready' });
          } else {
            const current = get();
            const networkFailure = e.status === undefined || e.status >= 500;
            if (networkFailure && isSameTabReload() && !current.isLocked
              && localSessionValid(current.localSession, sessionToken, current.user?.id)) {
              set({ permissions: current.localSession.permissions, bootstrapStatus: 'ready', error: null });
              useCloudStatusStore.getState().setCloudOnline(false);
              return;
            }
            if (current.isLocked) { set({ bootstrapStatus: 'ready' }); return; }
            // Backend unreachable — keep the session for retry, surface an error
            // screen instead of silently degrading to an empty/anon state.
            logger.error('bootstrap.failed', { status: e.status ?? 'network' });
            set({ bootstrapStatus: 'error', error: 'backend_unreachable' });
          }
        }
      },

      suspendCloud: () => { setSupabaseCloudEnabled(false); set({ cloudValidated: false }); },
      recordLocalActivity: () => {
        const s = get();
        if (s.isLocked || !s.isAuthenticated || !s.localSession) return;
        if (!localSessionValid(s.localSession, s.sessionToken, s.user?.id)) { get().lock(); return; }
        const now = Date.now();
        set({ localSession: { ...s.localSession, lastActivityAt: now, observedAt: now } });
      },
      lock: (reason = 'manual') => {
        authGeneration += 1;
        if (reason === 'session_expired') get().suspendCloud();
        set({ isLocked: true, lockReason: reason, bootstrapStatus: 'ready' });
      },
      unlock: () => set({ isLocked: false, lockReason: null }),

      async validateSession() {
        const token = get().sessionToken;
        if (!token || get().lockReason === 'session_expired') return;
        get().suspendCloud();
        const flight = sessionFlight(token);
        try {
          const session = await flight.promise;
          if (get().sessionToken !== token || authGeneration !== flight.generation || !useCloudStatusStore.getState().cloudOnline) return;
          if (session.auth) {
            // Keep the bearer fresh (re-minted by the EF) on every re-probe.
            setSupabaseAccessToken(session.auth.access_token);
          }
          setSupabaseCloudEnabled(true);
          set({
            cloudValidated: true,
            bootstrapStatus: 'ready',
            localSession: localSessionFromServer(session.session_clock, session.session_timeout_minutes, token, session.id, session.permissions, flight.requestedAt),
            user: { id: session.id, full_name: session.full_name, role_code: session.role_code, employee_code: session.employee_code },
            permissions: session.permissions,
            isAuthenticated: true,
            // Session 19 / Phase 3.A — refreshed per `auth-get-session` round-trip.
            sessionTimeoutMinutes: session.session_timeout_minutes,
            authExpiresAt: session.auth?.expires_at ?? null,
          });
        } catch (err: unknown) {
          const e = err as { status?: number };
          if (get().sessionToken !== token || authGeneration !== flight.generation) return;
          if (e.status === 401 || e.status === 403 || e.status === 404) {
            // The server no longer honors this PIN session. Do NOT logout():
            // that would silently dump the cashier to /login and lose the
            // operating context. Lock the terminal with the session-expired
            // copy instead — cart and shift survive, and the overlay's re-PIN
            // mints a fresh session via login().
            logger.warn('session.expired', { via: 'validateSession' });
            get().lock('session_expired');
          } else {
            // Network error : keep local session
            logger.warn('validateSession.transient_error');
          }
        }
      },

      hasPermission(code) {
        // SUPER_ADMIN (Owner) is an all-access role server-side too — this
        // front-side bypass just removes the dependency on the perms list being
        // fully hydrated (fixes SUPER_ADMIN being blocked on /pos/reports). RLS
        // still governs data access.
        if (get().user?.role_code === 'SUPER_ADMIN') return true;
        return has(get().permissions, code);
      },

      setError(msg) { set({ error: msg }); },
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => asyncStorage),
      partialize: (state) => ({
        user: state.user,
        sessionToken: state.sessionToken,
        isAuthenticated: state.isAuthenticated,
        sessionTimeoutMinutes: state.sessionTimeoutMinutes,
        localSession: state.localSession,
        isLocked: state.isLocked,
        lockReason: state.lockReason,
      }),
    },
  ),
);
