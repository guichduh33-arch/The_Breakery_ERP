// apps/backoffice/src/pages/Login.tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { NumpadPin, FullScreenModal } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore.js';
import { UserPicker } from '@/features/auth/UserPicker.js';

export default function LoginPage() {
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);
  const error = useAuthStore((s) => s.error);
  const setError = useAuthStore((s) => s.setError);
  const isLoading = useAuthStore((s) => s.isLoading);

  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  async function handleSubmit(pin: string) {
    if (!selectedUserId) return;
    setError(null);
    try {
      await login(selectedUserId, pin);
      navigate('/backoffice', { replace: true });
    } catch {
      // error in store
    }
  }

  return (
    <div className="min-h-screen grid place-items-center bg-bg-base p-8">
      <div className="space-y-8">
        <div className="text-center space-y-2">
          <h1 className="font-serif text-4xl">The Breakery</h1>
          <p className="text-text-secondary text-sm uppercase tracking-widest">Backoffice</p>
        </div>

        {!selectedUserId ? (
          <UserPicker onSelect={setSelectedUserId} />
        ) : (
          <FullScreenModal open onOpenChange={(open) => { if (!open) setSelectedUserId(null); }}>
            <div className="m-auto bg-bg-overlay rounded-xl p-8 max-w-sm shadow-modal">
              <h2 className="font-serif text-2xl text-center mb-2">Enter PIN</h2>
              <p className="text-text-secondary text-sm text-center mb-6">6 digits</p>
              <NumpadPin
                onSubmit={(pin) => { void handleSubmit(pin); }}
                isLoading={isLoading}
                error={error ? friendlyError(error) : null}
              />
            </div>
          </FullScreenModal>
        )}
      </div>
    </div>
  );
}

function friendlyError(err: string): string {
  switch (err) {
    case 'invalid_pin':         return 'Wrong PIN. Try again.';
    case 'account_locked':      return 'Account locked. Try in 15 min.';
    case 'rate_limited':        return 'Too many attempts. Wait a moment.';
    case 'user_inactive':       return 'User inactive.';
    case 'user_not_found':      return 'User not found.';
    case 'invalid_pin_format':  return 'PIN must be 6 digits.';
    default:                    return 'Login failed.';
  }
}
