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

interface AuthState {
  user: AuthUser | null;
  sessionToken: string | null;
  permissions: string[];
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  // Session 19 / Phase 3.A — populated by validateSession() from the role row.
  // null until the first auth-get-session round-trip lands (e.g. fresh login
  // before the rehydrate fires). Treat null/0 as "no idle logout".
  sessionTimeoutMinutes: number | null;

  login: (userId: string, pin: string) => Promise<void>;
  logout: () => Promise<void>;
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
      isLoading: false,
      error: null,
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
          error: null,
          sessionTimeoutMinutes: null,
        });
      },

      async validateSession() {
        const token = get().sessionToken;
        if (!token) return;
        try {
          const session = await getSession(supabaseUrl, token);
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
