import { useState } from 'react';
import { Lock } from 'lucide-react';
import { FullScreenModal, NumpadPin } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore';

/**
 * Shown over the whole POS when authStore.isLocked is true. The cashier (or a
 * colleague) re-enters a PIN to resume. The session token, cart, and shift are
 * never cleared — login() re-issues the JWT and unlock() drops the gate.
 *
 * Two copies for two reasons (critique 2026-08-14 P1): a manual/idle lock says
 * "Terminal locked"; a dead server session (401-storm watchdog) says so
 * honestly instead of pretending the terminal was parked on purpose.
 */
export function TerminalLockedOverlay() {
  const user = useAuthStore((s) => s.user);
  const login = useAuthStore((s) => s.login);
  const unlock = useAuthStore((s) => s.unlock);
  const lockReason = useAuthStore((s) => s.lockReason);
  const expired = lockReason === 'session_expired';
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // NumpadPin (packages/ui) only clears its internal buffer on its "Cancel"
  // button, so after a wrong PIN the 6-digit buffer stays full and "Verify"
  // would just re-submit the same wrong PIN. Bumping this counter on failure
  // remounts NumpadPin (via key) and resets its buffer to empty.
  const [attempt, setAttempt] = useState(0);

  async function handleSubmit(pin: string) {
    if (!user) return;
    setError(null);
    setIsVerifying(true);
    try {
      await login(user.id, pin);
      unlock();
    } catch {
      setError('Incorrect PIN');
      setAttempt((n) => n + 1);
    } finally {
      setIsVerifying(false);
    }
  }

  return (
    <FullScreenModal open onOpenChange={() => { /* gate — cannot dismiss */ }} title={expired ? 'Session expired' : 'Resume terminal'}>
      <div className="m-auto w-full max-w-sm space-y-6 text-center">
        <div className="grid place-items-center">
          <div className="h-16 w-16 rounded-full bg-gold-soft border border-gold grid place-items-center">
            <Lock className="h-7 w-7 text-gold" aria-hidden />
          </div>
        </div>
        <div className="space-y-1">
          <h2 className="font-semibold text-2xl">{expired ? 'Session expired' : 'Terminal locked'}</h2>
          <p className="text-text-secondary text-sm">
            {expired
              ? `The server signed this session out. ${user?.full_name ?? 'Cashier'} — enter your PIN to resume; the order and shift are untouched.`
              : `${user?.full_name ?? 'Cashier'} — enter your PIN to resume`}
          </p>
        </div>
        <NumpadPin key={attempt} onSubmit={(pin) => { void handleSubmit(pin); }} isLoading={isVerifying} error={error} />
      </div>
    </FullScreenModal>
  );
}
