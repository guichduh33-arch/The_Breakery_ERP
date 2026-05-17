// apps/pos/src/pages/Login.tsx
//
// Session 14 / Phase 2.C — POS Login page rebuilt per ref `215219.jpg`
// ("STAFF PIN ACCESS"). Centered dark card with the illustrated BrandLogo
// (croissant + wordmark + tagline), user picker, PIN dot indicators,
// virtual numpad and a gold "SIGN IN" CTA.
//
// Wiring is preserved : we still call `useAuthStore.login(userId, pin)`
// and route to /pos (waiter → /tablet/order) on success. The PIN length
// stays 6 (PIN spec D6 session 1).
//
// Notes:
//  - Dots indicator is purely visual ; auto-submit fires when length ===
//    PIN_LENGTH so the SIGN IN button is mostly a fallback for shorter PINs.
//    We keep it always-clickable when length ∈ [4,6] for ergonomics —
//    matches the "4-6 digit PIN" sub-copy on the screenshot.
//  - SWITCH chip opens the picker without losing already-typed digits ;
//    selecting another user resets the PIN buffer for safety.
//  - We intentionally do NOT use `NumpadVirtual` here because the screenshot
//    shows a custom layout (no "C" / "Cancel" buttons, only backspace) and
//    the auto-submit-on-length-6 ergonomic. Re-using NumpadVirtual would
//    force a Cancel button we don't want here.

import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
import { useNavigate } from 'react-router-dom';
import { Delete } from 'lucide-react';
import { BrandLogo, Button, SectionLabel, cn } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore';

const PIN_MIN = 4;
const PIN_MAX = 6;

interface SeedUser {
  id: string;
  full_name: string;
  role_label: string;
  initial: string;
}

// Same seed as the historical UserPicker — replaced when
// `list_login_users()` RPC ships (session 2 backlog).
const SEED_USERS: SeedUser[] = [
  { id: '00000000-0000-0000-0000-000000000001', full_name: 'Mamat (Owner)', role_label: 'Owner', initial: 'M' },
  { id: '00000000-0000-0000-0000-000000000002', full_name: 'Test Cashier',  role_label: 'Cashier', initial: 'T' },
];

function friendlyError(err: string): string {
  switch (err) {
    case 'invalid_pin':         return 'Wrong PIN. Try again.';
    case 'invalid_credentials': return 'Wrong PIN. Try again.';
    case 'account_locked':      return 'Account locked. Try in 15 min.';
    case 'rate_limited':        return 'Too many attempts. Wait a moment.';
    case 'user_inactive':       return 'User inactive.';
    case 'user_not_found':      return 'User not found.';
    case 'invalid_pin_format':  return 'PIN must be 4-6 digits.';
    case 'network_timeout':     return 'Network slow — try again.';
    default:                    return 'Sign in failed.';
  }
}

export default function LoginPage(): JSX.Element {
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);
  const error = useAuthStore((s) => s.error);
  const setError = useAuthStore((s) => s.setError);
  const isLoading = useAuthStore((s) => s.isLoading);

  const [selectedUser, setSelectedUser] = useState<SeedUser>(SEED_USERS[0]!);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pin, setPin] = useState('');

  const submitPin = useCallback(
    (rawPin: string) => {
      setError(null);
      void login(selectedUser.id, rawPin)
        .then(() => {
          const { user } = useAuthStore.getState();
          const dest = user?.role_code === 'waiter' ? '/tablet/order' : '/pos';
          navigate(dest, { replace: true });
        })
        .catch(() => { /* error surfaced via authStore.error */ });
    },
    [selectedUser.id, setError, login, navigate],
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

  const canSubmit = pin.length >= PIN_MIN && !isLoading;
  const errorCopy = error ? friendlyError(error) : null;

  const switchUser = useCallback((u: SeedUser) => {
    setSelectedUser(u);
    setPin('');
    setError(null);
    setPickerOpen(false);
  }, [setError]);

  // Dot count : show MAX dots, fill the first N.
  const dots = useMemo(() => Array.from({ length: PIN_MAX }), []);

  return (
    <div className="theme-pos min-h-screen grid place-items-center bg-bg-base p-6">
      <main
        aria-labelledby="login-heading"
        className="w-full max-w-sm rounded-2xl border border-border-subtle bg-bg-elevated shadow-modal p-8 flex flex-col items-center gap-6"
      >
        {/* Brand */}
        <BrandLogo size="lg" showTagline />

        {/* Heading */}
        <div className="text-center space-y-1.5">
          <h1
            id="login-heading"
            className="font-display text-2xl tracking-[0.18em] text-text-primary"
          >
            STAFF PIN ACCESS
          </h1>
          <p className="text-text-secondary text-sm">Enter your 4-6 digit PIN</p>
        </div>

        {/* User picker chip */}
        {pickerOpen ? (
          <div className="w-full space-y-2 rounded-md border border-border-subtle bg-bg-input p-3">
            <SectionLabel as="div">Switch user</SectionLabel>
            {SEED_USERS.map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() => switchUser(u)}
                className={cn(
                  'w-full flex items-center gap-3 rounded-md px-3 py-2 text-left transition-colors',
                  'hover:bg-bg-overlay focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold',
                  u.id === selectedUser.id ? 'bg-bg-overlay' : '',
                )}
              >
                <span
                  aria-hidden
                  className="h-8 w-8 grid place-items-center rounded-full bg-gold-soft text-gold font-display text-sm"
                >
                  {u.initial}
                </span>
                <span className="flex-1 text-sm text-text-primary truncate">{u.full_name}</span>
                <span className="text-[10px] uppercase tracking-widest text-text-muted">{u.role_label}</span>
              </button>
            ))}
            <button
              type="button"
              onClick={() => setPickerOpen(false)}
              className="w-full text-xs uppercase tracking-widest text-text-muted py-1 hover:text-text-primary"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <div
              aria-hidden
              className="h-14 w-14 grid place-items-center rounded-full border-2 border-gold-soft bg-bg-elevated"
            >
              <span className="font-display text-xl text-gold">{selectedUser.initial}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-text-primary">
                Welcome, <span className="font-semibold">{selectedUser.full_name}</span>
              </span>
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                className="text-[10px] uppercase tracking-widest text-text-muted bg-bg-input border border-border-subtle rounded-md px-2 py-0.5 hover:text-text-primary hover:border-gold focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold"
              >
                Switch
              </button>
            </div>
          </div>
        )}

        {/* PIN dots */}
        <div className="flex justify-center gap-3" aria-label="PIN dots" role="status">
          {dots.map((_, i) => (
            <span
              key={i}
              data-testid={`login-pin-dot-${i}`}
              className={cn(
                'h-3 w-3 rounded-full border transition-colors',
                i < pin.length
                  ? 'bg-gold border-gold'
                  : 'bg-transparent border-border-strong',
              )}
            />
          ))}
        </div>

        {/* Error */}
        {errorCopy && (
          <p role="alert" className="text-danger text-sm text-center -mt-2">
            {errorCopy}
          </p>
        )}

        {/* Numpad — no Cancel/Verify buttons inline ; uses SIGN IN below */}
        <div className="grid grid-cols-3 gap-3 w-full" role="group" aria-label="PIN numpad">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => handleDigit(d)}
              disabled={isLoading}
              className="h-14 rounded-lg bg-bg-input border border-border-subtle text-text-primary text-xl font-semibold transition-colors hover:bg-bg-overlay focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold disabled:opacity-50"
              aria-label={d}
            >
              {d}
            </button>
          ))}
          <span aria-hidden />
          <button
            type="button"
            onClick={() => handleDigit('0')}
            disabled={isLoading}
            className="h-14 rounded-lg bg-bg-input border border-border-subtle text-text-primary text-xl font-semibold transition-colors hover:bg-bg-overlay focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold disabled:opacity-50"
            aria-label="0"
          >
            0
          </button>
          <button
            type="button"
            onClick={handleBackspace}
            disabled={isLoading || pin.length === 0}
            className="h-14 rounded-lg bg-bg-input border border-border-subtle text-text-primary transition-colors hover:bg-bg-overlay focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold disabled:opacity-50 grid place-items-center"
            aria-label="Backspace"
          >
            <Delete className="h-5 w-5" aria-hidden />
          </button>
        </div>

        {/* SIGN IN */}
        <Button
          variant="gold"
          size="lg"
          className="w-full uppercase tracking-widest font-semibold"
          disabled={!canSubmit}
          onClick={() => submitPin(pin)}
          data-testid="login-sign-in-btn"
        >
          {isLoading ? 'Signing in…' : 'Sign In'}
        </Button>

        {/* Email-login link — placeholder route ; click-through is wired to /login/email
            which is not yet implemented (Session 14 phase 2.C scope = PIN UX only). */}
        <button
          type="button"
          onClick={() => navigate('/login/email')}
          className="text-text-secondary text-sm underline-offset-2 hover:text-text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold rounded"
        >
          Switch to Email Login
        </button>
      </main>
    </div>
  );
}
