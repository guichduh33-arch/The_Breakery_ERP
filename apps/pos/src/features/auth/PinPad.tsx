// apps/pos/src/features/auth/PinPad.tsx
// Session 13 / Phase 1.B — task 25-004 (generic error messages).
//
// 6-digit PIN entry pad. Renders a numpad + masked display. Submits to
// `useAuthPin.verify` which hits the EF directly. Error states surface a
// SINGLE generic message ("invalid_credentials" → "Identifiants invalides")
// regardless of whether the failure was user_not_found / invalid_pin /
// permission_denied — to avoid leaking which factor the attacker got wrong.

import { useCallback, useEffect, useState } from 'react';
import { Delete } from 'lucide-react';

import { Button } from '@breakery/ui';

import { useAuthPin } from './hooks/useAuthPin';

export interface PinPadProps {
  userId: string;
  onSuccess?: () => void;
  onCancel?: () => void;
}

const PIN_LENGTH = 6;

// Single generic copy for the user. We intentionally do NOT distinguish
// between "user_not_found", "invalid_pin", "permission_denied" — the EF
// already collapses to `invalid_credentials`, and the UI follows suit.
function uiErrorFor(code: string | null): string | null {
  if (!code) return null;
  if (code === 'rate_limited') return 'Trop de tentatives. Réessaye dans une minute.';
  if (code === 'account_locked') return 'Compte verrouillé. Contacte un manager.';
  return 'Identifiants invalides.';
}

export function PinPad({ userId, onSuccess, onCancel }: PinPadProps) {
  const [pin, setPin] = useState('');
  const { status, error, verify, reset } = useAuthPin();

  const appendDigit = useCallback((d: string) => {
    setPin((prev) => (prev.length < PIN_LENGTH ? prev + d : prev));
  }, []);
  const backspace = useCallback(() => {
    setPin((prev) => prev.slice(0, -1));
    if (status === 'error') reset();
  }, [status, reset]);
  const clear = useCallback(() => {
    setPin('');
    if (status === 'error') reset();
  }, [status, reset]);

  // Auto-submit when PIN_LENGTH reached.
  useEffect(() => {
    if (pin.length !== PIN_LENGTH) return;
    void (async () => {
      await verify(userId, pin);
    })();
  }, [pin, userId, verify]);

  useEffect(() => {
    if (status === 'success') {
      onSuccess?.();
    }
    if (status === 'error') {
      // Clear the field on error so the user can retry without manual backspace.
      setPin('');
    }
  }, [status, onSuccess]);

  const isBusy = status === 'verifying';
  const uiError = uiErrorFor(error);

  return (
    <div className="flex flex-col items-center gap-4 w-full max-w-xs">
      <h2 className="text-text-secondary text-sm uppercase tracking-wide">Saisis ton PIN</h2>

      <div
        aria-label="PIN entry display"
        className="flex gap-2"
      >
        {Array.from({ length: PIN_LENGTH }).map((_, i) => (
          <div
            key={i}
            data-testid={`pin-dot-${i}`}
            className={`w-3 h-3 rounded-full border ${i < pin.length ? 'bg-text-primary' : 'bg-transparent'}`}
          />
        ))}
      </div>

      {uiError && (
        <p role="alert" className="text-sm text-red-fg text-center">{uiError}</p>
      )}

      <div className="grid grid-cols-3 gap-2 w-full">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <Button
            key={d}
            variant="secondary"
            size="lg"
            disabled={isBusy}
            onClick={() => appendDigit(d)}
            className="aspect-square text-2xl"
          >
            {d}
          </Button>
        ))}
        <Button variant="ghost" size="lg" onClick={clear} disabled={isBusy} className="aspect-square">
          C
        </Button>
        <Button
          variant="secondary"
          size="lg"
          disabled={isBusy}
          onClick={() => appendDigit('0')}
          className="aspect-square text-2xl"
        >
          0
        </Button>
        <Button
          variant="ghost"
          size="lg"
          onClick={backspace}
          disabled={isBusy}
          className="aspect-square"
          aria-label="Backspace"
        >
          <Delete className="h-6 w-6" aria-hidden />
        </Button>
      </div>

      {onCancel && (
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={isBusy}>
          Annuler
        </Button>
      )}
    </div>
  );
}
