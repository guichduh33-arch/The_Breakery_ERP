// apps/pos/src/pages/Login.tsx
//
// Session 14 / Phase 2.C — POS Login page rebuilt per ref `215219.jpg`
// ("STAFF PIN ACCESS"), puis relookée en écran scindé (session live
// 2026-08-29) : panneau de marque (surface-0, filet or) à gauche — 45 % de
// la largeur —, colonne PIN à droite ; sous 860 px le panneau devient un
// bandeau au-dessus de la colonne.
//
// Wiring is preserved : we still call `useAuthStore.login(userId, pin)`
// and route to /pos (waiter → /tablet/order) on success.
//
// Vague 0 / Tâche 3 (S58) : the picker used to be hardcoded to 2 seed
// accounts (`SEED_USERS`) — any employee created in the BackOffice was
// invisible here and could never sign in. It now consumes
// `useLoginUsers()` (→ `list_login_users_v1`, anon-callable pre-auth RPC).
// PIN length is also now EXACTLY 6 digits everywhere (was a stale "4-6"
// copy while `create_user_v1` accepted 4-8 — the two were out of sync).
//
// Notes:
//  - Dots indicator is purely visual ; auto-submit fires when length ===
//    PIN_LENGTH. There is no Sign In button : it could never be pressed
//    (auto-submit always fired first), so a status line replaces it.
//  - SWITCH chip opens the picker without losing already-typed digits ;
//    selecting another user resets the PIN buffer for safety.
//  - Critique 2026-08-14 P2 — no arbitrary default user : preselecting
//    users[0] + auto-submit let a reflex-typed PIN lock a colleague's account
//    (15 min). The picker opens until a user is chosen ; the last successful
//    login on this terminal is remembered and preselected instead.
//  - We intentionally do NOT use `NumpadVirtual` here because the screenshot
//    shows a custom layout (no "C" / "Cancel" buttons, only backspace) and
//    the auto-submit-on-length-6 ergonomic. Re-using NumpadVirtual would
//    force a Cancel button we don't want here.

import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
import { useNavigate } from 'react-router-dom';
import { Delete } from 'lucide-react';
import { BrandLogo, Button, SectionLabel, cn } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore';
import { useLoginUsers, type LoginUser } from '@/features/auth/hooks/useLoginUsers';

const PIN_MAX = 6;
/** Dernier utilisateur connecté avec succès sur CE terminal (localStorage). */
const LAST_USER_KEY = 'pos:last_login_user';

function initialOf(displayName: string): string {
  return displayName.trim().charAt(0).toUpperCase() || '?';
}

function friendlyError(err: string): string {
  switch (err) {
    case 'invalid_pin':         return 'Wrong PIN. Try again.';
    case 'invalid_credentials': return 'Wrong PIN. Try again.';
    case 'account_locked':      return 'Account locked. Try in 15 min.';
    case 'rate_limited':        return 'Too many attempts. Wait a moment.';
    case 'user_inactive':       return 'User inactive.';
    case 'user_not_found':      return 'User not found.';
    case 'invalid_pin_format':  return 'PIN must be 6 digits.';
    case 'network_timeout':     return 'Network slow — try again.';
    default:                    return 'Sign in failed — check the connection and try again.';
  }
}

export default function LoginPage(): JSX.Element {
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);
  const error = useAuthStore((s) => s.error);
  const setError = useAuthStore((s) => s.setError);
  const isLoading = useAuthStore((s) => s.isLoading);

  const { data: users, isLoading: usersLoading, isError: usersError, refetch: refetchUsers, isFetching: usersFetching } = useLoginUsers();

  const [selectedUser, setSelectedUser] = useState<LoginUser | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pin, setPin] = useState('');

  // Preselect ONLY the last user who signed in on this terminal — never an
  // arbitrary users[0] (a reflex-typed PIN would auto-submit on a colleague's
  // account and can lock it for 15 min). No memory → the picker stays open.
  useEffect(() => {
    if (selectedUser !== null || !users || users.length === 0) return;
    let lastId: string | null = null;
    try { lastId = localStorage.getItem(LAST_USER_KEY); } catch { /* storage unavailable */ }
    const last = lastId ? users.find((u) => u.id === lastId) : undefined;
    if (last) setSelectedUser(last);
  }, [users, selectedUser]);

  const submitPin = useCallback(
    (rawPin: string) => {
      if (!selectedUser) return;
      setError(null);
      void login(selectedUser.id, rawPin)
        .then(() => {
          try { localStorage.setItem(LAST_USER_KEY, selectedUser.id); } catch { /* storage unavailable */ }
          const { user } = useAuthStore.getState();
          const dest = user?.role_code === 'waiter' ? '/tablet/order' : '/pos';
          void navigate(dest, { replace: true });
        })
        .catch(() => { /* error surfaced via authStore.error */ });
    },
    [selectedUser, setError, login, navigate],
  );

  const handleDigit = useCallback((d: string) => {
    setPin((prev) => (prev.length >= PIN_MAX ? prev : prev + d));
  }, []);

  const handleBackspace = useCallback(() => {
    setPin((prev) => prev.slice(0, -1));
  }, []);

  // Auto-submit when 6 digits typed — matches PIN_LENGTH spec.
  useEffect(() => {
    if (pin.length === PIN_MAX && !isLoading) {
      submitPin(pin);
    }
  }, [pin, isLoading, submitPin]);

  // Clear PIN when error surfaces (so user can retype) and on user switch.
  useEffect(() => {
    if (error) setPin('');
  }, [error]);

  const errorCopy = error ? friendlyError(error) : null;

  const switchUser = useCallback((u: LoginUser) => {
    setSelectedUser(u);
    setPin('');
    setError(null);
    setPickerOpen(false);
  }, [setError]);

  // Dot count : show MAX dots, fill the first N.
  const dots = useMemo(() => Array.from({ length: PIN_MAX }), []);

  return (
    <div className="theme-pos min-h-dvh bg-bg-base grid min-[860px]:grid-cols-[45%_1fr]">
      {/* Panneau de marque — surface-0 (le cran le plus profond), filet or
          décoratif ; l'or MÈNE l'œil, il ne remplit pas (arbitrage 2026-08-24). */}
      <aside className="flex flex-col items-center justify-center gap-6 bg-surface-0 border-b border-border-subtle p-6 min-[860px]:border-b-0 min-[860px]:border-r min-[860px]:p-10">
        <BrandLogo size="xl" showTagline />
        <div className="w-[72px] border-t border-border-gold opacity-60" aria-hidden />
        <p className="text-text-muted text-xs uppercase tracking-[0.2em]">Point of sale</p>
      </aside>
      <main aria-labelledby="login-heading" className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm flex flex-col items-center gap-6">
          <div className="text-center space-y-1.5">
            <h1 id="login-heading" className="font-semibold text-2xl tracking-[0.18em] text-text-primary">
              STAFF PIN ACCESS
            </h1>
            <p className="text-text-secondary text-sm">Enter your 6-digit PIN</p>
          </div>
          {usersLoading ? (
            <p className="text-text-secondary text-sm" data-testid="login-users-loading">Loading staff…</p>
          ) : usersError ? (
            <div className="flex flex-col items-center gap-2" data-testid="login-users-error">
              <p className="text-danger-as-text text-sm text-center">Could not load staff list. Check your connection.</p>
              <Button variant="secondary" size="md" onClick={() => { void refetchUsers(); }} disabled={usersFetching}>
                {usersFetching ? 'Retrying…' : 'Retry'}
              </Button>
            </div>
          ) : !users || users.length === 0 ? (
            <p className="text-text-secondary text-sm" data-testid="login-users-empty">No active staff found.</p>
          ) : pickerOpen || !selectedUser ? (
            <div className="w-full space-y-1">
              <SectionLabel as="div">{selectedUser ? 'Switch user' : 'Who is signing in?'}</SectionLabel>
              {users.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => switchUser(u)}
                  className={cn(
                    'w-full flex items-center gap-3 rounded-md px-3 py-2 text-left transition-colors',
                    'hover:bg-bg-overlay focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold',
                    u.id === selectedUser?.id ? 'bg-bg-overlay' : '',
                  )}
                >
                  <span aria-hidden className="h-8 w-8 grid place-items-center rounded-full bg-gold-soft text-gold font-display text-sm">
                    {initialOf(u.display_name)}
                  </span>
                  <span className="flex-1 text-sm text-text-primary truncate">{u.display_name}</span>
                  <span className="text-xs uppercase tracking-widest text-text-muted">{u.role}</span>
                </button>
              ))}
              {selectedUser && (
                <button
                  type="button"
                  onClick={() => setPickerOpen(false)}
                  className="w-full text-xs uppercase tracking-widest text-text-muted py-1 hover:text-text-primary"
                >
                  Cancel
                </button>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <div aria-hidden className="h-11 w-11 grid place-items-center rounded-full border-2 border-gold-soft bg-bg-elevated">
                <span className="font-display text-lg text-gold">{initialOf(selectedUser.display_name)}</span>
              </div>
              <span className="text-sm text-text-primary">
                Welcome, <span className="font-semibold">{selectedUser.display_name}</span>
              </span>
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                className="text-xs uppercase tracking-widest text-text-muted bg-bg-input border border-border-subtle rounded-md px-2 py-0.5 hover:text-text-primary hover:border-gold focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold"
              >
                Switch
              </button>
            </div>
          )}
          <div className="flex justify-center gap-3" aria-label="PIN progress" role="status">
            <span className="sr-only">{pin.length} of {PIN_MAX} digits entered</span>
            {dots.map((_, i) => (
              <span
                key={i}
                aria-hidden
                data-testid={`login-pin-dot-${i}`}
                className={cn(
                  'h-3 w-3 rounded-full border transition-colors',
                  i < pin.length ? 'bg-gold border-gold' : 'bg-transparent border-border-strong',
                )}
              />
            ))}
          </div>
          {errorCopy && (
            <p role="alert" className="text-danger-as-text text-sm text-center -mt-2">{errorCopy}</p>
          )}
          <div className="grid grid-cols-3 gap-3 w-full" role="group" aria-label="PIN numpad">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => handleDigit(d)}
                disabled={isLoading || !selectedUser}
                className="h-20 rounded-lg bg-bg-input border border-border-subtle text-text-primary text-xl font-semibold transition-colors hover:bg-bg-overlay focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold disabled:opacity-50"
                aria-label={d}
              >
                {d}
              </button>
            ))}
            <span aria-hidden />
            <button
              type="button"
              onClick={() => handleDigit('0')}
              disabled={isLoading || !selectedUser}
              className="h-20 rounded-lg bg-bg-input border border-border-subtle text-text-primary text-xl font-semibold transition-colors hover:bg-bg-overlay focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold disabled:opacity-50"
              aria-label="0"
            >
              0
            </button>
            <button
              type="button"
              onClick={handleBackspace}
              disabled={isLoading || pin.length === 0}
              className="h-20 rounded-lg bg-bg-input border border-border-subtle text-text-primary transition-colors hover:bg-bg-overlay focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold disabled:opacity-50 grid place-items-center"
              aria-label="Backspace"
            >
              <Delete className="h-5 w-5" aria-hidden />
            </button>
          </div>
          <p aria-live="polite" data-testid="login-signing-in-status" className="h-5 text-sm text-text-secondary">{isLoading ? 'Signing in…' : ' '}</p>
        </div>
      </main>
    </div>

  );
}
