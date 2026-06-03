import { useState } from 'react';
import { Lock } from 'lucide-react';
import { FullScreenModal, NumpadPin } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore';

/**
 * Shown over the whole POS when authStore.isLocked is true. The cashier (or a
 * colleague) re-enters a PIN to resume. The session token, cart, and shift are
 * never cleared — login() re-issues the JWT and unlock() drops the gate.
 */
export function TerminalLockedOverlay() {
  const user = useAuthStore((s) => s.user);
  const login = useAuthStore((s) => s.login);
  const unlock = useAuthStore((s) => s.unlock);
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(pin: string) {
    if (!user) return;
    setError(null);
    setIsVerifying(true);
    try {
      await login(user.id, pin);
      unlock();
    } catch {
      setError('Incorrect PIN');
    } finally {
      setIsVerifying(false);
    }
  }

  return (
    <FullScreenModal open onOpenChange={() => { /* gate — cannot dismiss */ }} title="Resume terminal">
      <div className="m-auto w-full max-w-sm space-y-6 text-center">
        <div className="grid place-items-center">
          <div className="h-16 w-16 rounded-full bg-gold-soft border border-gold grid place-items-center">
            <Lock className="h-7 w-7 text-gold" aria-hidden />
          </div>
        </div>
        <div className="space-y-1">
          <h2 className="font-serif text-2xl">Terminal locked</h2>
          <p className="text-text-secondary text-sm">{user?.full_name ?? 'Cashier'} — enter your PIN to resume</p>
        </div>
        <NumpadPin onSubmit={(pin) => { void handleSubmit(pin); }} isLoading={isVerifying} error={error} />
      </div>
    </FullScreenModal>
  );
}
