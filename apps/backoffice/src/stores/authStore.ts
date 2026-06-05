// apps/backoffice/src/stores/authStore.ts
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import {
  loginWithPin,
  getSession,
  logoutSession,
  type LoginResponse,
  type PermissionCode,
  hasPermission as has,
} from '@breakery/supabase';
import { safeStorage, logger } from '@breakery/utils';
import { supabase, supabaseUrl } from '../lib/supabase.js';

interface AuthUser {
  id: string;
  full_name: string;
  role_code: string;
  employee_code: string;
}

/**
 * Boot-time rehydration lifecycle. `isAuthenticated` + `sessionToken` survive a
 * reload via the persisted store, but `permissions` and the Supabase bearer do
 * NOT — they must be re-fetched from `auth-get-session` before the router/sidebar
 * render. Deriving navigation from a not-yet-loaded (empty) permission list is
 * exactly the bug this state machine prevents.
 *
 * - `pending` : initial; bootstrap() has not run yet.
 * - `loading` : auth-get-session round-trip in flight.
 * - `ready`   : permissions + bearer restored (or no persisted session to restore).
 * - `error`   : backend unreachable / 5xx — keep the session, show a retry screen
 *               instead of silently degrading the nav.
 */
export type BootstrapStatus = 'pending' | 'loading' | 'ready' | 'error';

interface AuthState {
  user: AuthUser | null;
  sessionToken: string | null;
  permissions: string[];
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  bootstrapStatus: BootstrapStatus;
  // Session 19 / Phase 3.A — populated by validateSession() from the role row.
  // null until the first auth-get-session round-trip lands. Treat null/0 as
  // "no idle logout".
  sessionTimeoutMinutes: number | null;
  login: (userId: string, pin: string) => Promise<void>;
  logout: () => Promise<void>;
  bootstrap: () => Promise<void>;
  validateSession: () => Promise<void>;
  hasPermission: (code: PermissionCode) => boolean;
  setError: (msg: string | null) => void;
}

const STORAGE_KEY = 'breakery-backoffice-auth';

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
            device_type: 'backoffice',
          });
          await supabase.auth.setSession({
            access_token: res.auth.access_token,
            refresh_token: res.auth.refresh_token,
          });
          set({
            user: res.user,
            sessionToken: res.session.token,
            permissions: res.permissions,
            isAuthenticated: true,
            isLoading: false,
            bootstrapStatus: 'ready',
          });
          logger.info('login.success', { user_id: res.user.id, app: 'backoffice' });
        } catch (err: unknown) {
          const e = err as { details?: { error?: string }; message?: string };
          set({ error: e.details?.error ?? e.message ?? 'login_failed', isLoading: false });
          throw err;
        }
      },

      async logout() {
        const token = get().sessionToken;
        if (token) {
          try { await logoutSession(supabaseUrl, token); } catch { /* ignore */ }
        }
        await supabase.auth.signOut().catch((_err: unknown) => { /* ignore signOut error */ });
        set({
          user: null,
          sessionToken: null,
          permissions: [],
          isAuthenticated: false,
          error: null,
          // A logout is a terminal, known state — bootstrap is "done" (the router
          // will route to /login). Never leave it 'loading'/'error' or the shell
          // would hang on a spinner/error screen after sign-out.
          bootstrapStatus: 'ready',
          sessionTimeoutMinutes: null,
        });
      },

      /**
       * Boot-time rehydration. Call once on app mount. If a session was persisted
       * (isAuthenticated + sessionToken), re-fetch the role's permissions AND
       * restore the Supabase bearer (lost on reload because persistSession=false)
       * before flipping to 'ready'. The router/sidebar must stay behind the
       * 'loading' gate until this resolves — otherwise guards redirect on an
       * empty permission list (the reload bug).
       */
      async bootstrap() {
        const { sessionToken, isAuthenticated } = get();
        if (!sessionToken || !isAuthenticated) {
          // Nothing to restore — the router will bounce to /login on its own.
          set({ bootstrapStatus: 'ready' });
          return;
        }
        set({ bootstrapStatus: 'loading', error: null });
        try {
          const session = await getSession(supabaseUrl, sessionToken);
          if (session.auth) {
            // Restore the PostgREST bearer so RLS-protected queries stop 401-ing
            // ("permission denied for table products"). Mirrors login().
            await supabase.auth.setSession({
              access_token: session.auth.access_token,
              refresh_token: session.auth.refresh_token,
            });
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
            // Session genuinely revoked/expired — clear it; router → /login.
            await get().logout();
          } else {
            // Backend unreachable / 5xx / network. Keep the persisted session so
            // a retry can recover, and surface an explicit error screen instead
            // of degrading the nav to an empty-permissions state.
            logger.error('bootstrap.failed', { status: e.status ?? 'network' });
            set({ bootstrapStatus: 'error', error: 'backend_unreachable' });
          }
        }
      },

      async validateSession() {
        const token = get().sessionToken;
        if (!token) return;
        try {
          const session = await getSession(supabaseUrl, token);
          if (session.auth) {
            await supabase.auth.setSession({
              access_token: session.auth.access_token,
              refresh_token: session.auth.refresh_token,
            });
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
          if (e.status === 401) await get().logout();
          // else: transient — keep local session, do not degrade nav.
        }
      },

      hasPermission(code) {
        // SUPER_ADMIN (Owner) is an intentional all-access role: the server also
        // grants it every permission, so this front-side bypass only removes a
        // dependency on the perms list being fully hydrated. RLS still governs
        // data access server-side.
        if (get().user?.role_code === 'SUPER_ADMIN') return true;
        return has(get().permissions, code);
      },

      setError(msg) { set({ error: msg }); },
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => asyncStorage),
      partialize: (s) => ({ user: s.user, sessionToken: s.sessionToken, isAuthenticated: s.isAuthenticated }),
    },
  ),
);
