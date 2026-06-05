// apps/pos/src/stores/authStore.ts
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import {
  loginWithPin,
  getSession,
  logoutSession,
  setSupabaseAccessToken,
  type LoginResponse,
  type PermissionCode,
  hasPermission as has,
} from '@breakery/supabase';
import { safeStorage, logger } from '@breakery/utils';
import { supabaseUrl } from '../lib/supabase.js';

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
  user: AuthUser | null;
  sessionToken: string | null;
  permissions: string[];
  isAuthenticated: boolean;
  // Session 35 / Task A1 — manual "Lock Terminal" gate. Pauses the POS behind
  // an overlay without dropping the PIN-JWT session, cart or shift. NOT
  // persisted (see partialize) so a page reload always starts unlocked.
  isLocked: boolean;
  isLoading: boolean;
  error: string | null;
  bootstrapStatus: BootstrapStatus;
  // Session 19 / Phase 3.A — populated by validateSession() from the role row.
  // null until the first auth-get-session round-trip lands (e.g. fresh login
  // before the rehydrate fires). Treat null/0 as "no idle logout".
  sessionTimeoutMinutes: number | null;

  login: (userId: string, pin: string) => Promise<void>;
  logout: () => Promise<void>;
  bootstrap: () => Promise<void>;
  lock: () => void;
  unlock: () => void;
  validateSession: () => Promise<void>;
  hasPermission: (code: PermissionCode) => boolean;
  setError: (msg: string | null) => void;
}

const STORAGE_KEY = 'breakery-pos-auth';

const asyncStorage = {
  getItem: (name: string) => safeStorage.get(name),
  setItem: (name: string, value: string) => safeStorage.set(name, value),
  removeItem: (name: string) => safeStorage.remove(name),
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      sessionToken: null,
      permissions: [],
      isAuthenticated: false,
      isLocked: false,
      isLoading: false,
      error: null,
      bootstrapStatus: 'pending',
      sessionTimeoutMinutes: null,

      async login(userId, pin) {
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
          set({
            user: res.user,
            sessionToken: res.session.token,
            permissions: res.permissions,
            isAuthenticated: true,
            isLoading: false,
            bootstrapStatus: 'ready',
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
        const token = get().sessionToken;
        if (token) {
          try { await logoutSession(supabaseUrl, token); } catch { /* ignore */ }
        }
        // Drop the client-side bearer (counterpart to setSupabaseAccessToken on login).
        setSupabaseAccessToken(null);
        set({
          user: null,
          sessionToken: null,
          permissions: [],
          isAuthenticated: false,
          isLocked: false,
          error: null,
          // Terminal state — bootstrap is "done" (router → /login). Never leave
          // it loading/error after a sign-out.
          bootstrapStatus: 'ready',
          sessionTimeoutMinutes: null,
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
          // No PIN session (fresh load, or kiosk/display/tablet surfaces that
          // use their own token) — nothing to restore.
          set({ bootstrapStatus: 'ready' });
          return;
        }
        set({ bootstrapStatus: 'loading', error: null });
        try {
          const session = await getSession(supabaseUrl, sessionToken);
          if (session.auth) {
            // Restore the PIN bearer so RLS-protected queries stop 401-ing.
            setSupabaseAccessToken(session.auth.access_token);
          }
          set({
            user: { id: session.id, full_name: session.full_name, role_code: session.role_code, employee_code: session.employee_code },
            permissions: session.permissions,
            isAuthenticated: true,
            sessionTimeoutMinutes: session.session_timeout_minutes,
            bootstrapStatus: 'ready',
          });
          logger.info('bootstrap.rehydrated', { user_id: session.id, perms: session.permissions.length });
        } catch (err: unknown) {
          const e = err as { status?: number };
          if (e.status === 401) {
            await get().logout();
          } else {
            // Backend unreachable — keep the session for retry, surface an error
            // screen instead of silently degrading to an empty/anon state.
            logger.error('bootstrap.failed', { status: e.status ?? 'network' });
            set({ bootstrapStatus: 'error', error: 'backend_unreachable' });
          }
        }
      },

      lock: () => set({ isLocked: true }),
      unlock: () => set({ isLocked: false }),

      async validateSession() {
        const token = get().sessionToken;
        if (!token) return;
        try {
          const session = await getSession(supabaseUrl, token);
          if (session.auth) {
            // Keep the bearer fresh (re-minted by the EF) on every re-probe.
            setSupabaseAccessToken(session.auth.access_token);
          }
          set({
            user: { id: session.id, full_name: session.full_name, role_code: session.role_code, employee_code: session.employee_code },
            permissions: session.permissions,
            isAuthenticated: true,
            // Session 19 / Phase 3.A — refreshed per `auth-get-session` round-trip.
            sessionTimeoutMinutes: session.session_timeout_minutes,
          });
        } catch (err: unknown) {
          const e = err as { status?: number };
          if (e.status === 401) {
            await get().logout();
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
      }),
    },
  ),
);
