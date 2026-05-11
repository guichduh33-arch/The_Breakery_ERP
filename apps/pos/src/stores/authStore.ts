// apps/pos/src/stores/authStore.ts
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

interface AuthState {
  user: AuthUser | null;
  sessionToken: string | null;
  permissions: string[];
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;

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

      async login(userId, pin) {
        set({ isLoading: true, error: null });
        try {
          const res: LoginResponse = await loginWithPin(supabaseUrl, {
            user_id: userId,
            pin,
            device_type: 'pos',
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
          });
          logger.info('login.success', { user_id: res.user.id });
        } catch (err: unknown) {
          const e = err as { details?: { error?: string }; message?: string };
          set({ error: e.details?.error ?? e.message ?? 'login_failed', isLoading: false });
          logger.warn('login.failed', { reason: e.details?.error ?? e.message });
          throw err;
        }
      },

      async logout() {
        const token = get().sessionToken;
        if (token) {
          try { await logoutSession(supabaseUrl, token); } catch { /* ignore */ }
        }
        await supabase.auth.signOut().catch((_err: unknown) => { /* ignore sign out error */ });
        set({ user: null, sessionToken: null, permissions: [], isAuthenticated: false, error: null });
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
