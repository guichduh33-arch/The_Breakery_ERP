// packages/ui/src/components/PinVerificationModal.tsx
//
// Reusable modal for manager PIN verification with optional permission check.
// The verifyFn is injected to keep this component free of Supabase imports.
// On success: calls onVerified(userId) then closes. On failure: toasts error
// and clears the PIN so the user can retry.
//
// Spec ref: docs/superpowers/specs/2026-05-06-session-6-discounts-multi-modifiers-loyalty-mult-spec.md §4.2

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useState, type JSX } from 'react';
import { toast } from 'sonner';
import { cn } from '../lib/cn.js';
import { Button } from '../primitives/Button.js';
import { FullScreenModal } from './FullScreenModal.js';
import { NumpadPin } from './NumpadPin.js';

const SR_ONLY = 'absolute -m-px h-px w-px overflow-hidden whitespace-nowrap border-0 p-0';

export type VerifyResult =
  | { ok: true; userId: string }
  | { ok: false; error: 'wrong_pin' | 'permission_missing' | 'account_locked' | 'unknown' };

export interface PinVerificationModalProps {
  open: boolean;
  onClose: () => void;
  /** Called with manager userId on successful PIN verification. */
  onVerified: (userId: string) => void;
  /** e.g. 'sales.discount'. Forwarded to the verifyFn. */
  requiredPermission?: string;
  /**
   * Injected verification function — UI does NOT call Supabase directly.
   * The caller wires this to the auth-verify-pin Edge Function.
   */
  verifyFn: (pin: string, requiredPermission?: string) => Promise<VerifyResult>;
}

const ERROR_MESSAGES = {
  wrong_pin: 'Wrong PIN',
  permission_missing: 'User lacks permission',
  // S38 — lockout from RPCs with in-arg PIN validation (SEC-06/07)
  account_locked: 'Compte verrouillé 15 min — trop de tentatives erronées.',
  unknown: 'Verification failed',
} as const satisfies Record<string, string>;

export function PinVerificationModal({
  open,
  onClose,
  onVerified,
  requiredPermission,
  verifyFn,
}: PinVerificationModalProps): JSX.Element {
  const [isLoading, setIsLoading] = useState(false);
  const [pinKey, setPinKey] = useState(0); // increment to force NumpadPin reset

  function handleOpenChange(o: boolean): void {
    if (!o) {
      setPinKey((k) => k + 1);
      setIsLoading(false);
      onClose();
    }
  }

  async function handleSubmit(pin: string): Promise<void> {
    setIsLoading(true);
    try {
      const result = await verifyFn(pin, requiredPermission);
      if (result.ok) {
        onVerified(result.userId);
        handleOpenChange(false);
      } else {
        toast.error(ERROR_MESSAGES[result.error] ?? ERROR_MESSAGES.unknown);
        setPinKey((k) => k + 1); // clear PIN
      }
    } catch {
      toast.error(ERROR_MESSAGES.unknown);
      setPinKey((k) => k + 1);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <FullScreenModal open={open} onOpenChange={handleOpenChange} accessibleTitle="Manager verification">
      <DialogPrimitive.Title asChild>
        <span className={cn(SR_ONLY)}>Manager verification</span>
      </DialogPrimitive.Title>
      <DialogPrimitive.Description asChild>
        <span className={cn(SR_ONLY)}>Enter manager PIN to authorize this action.</span>
      </DialogPrimitive.Description>

      <header className="h-14 px-6 flex items-center justify-between border-b border-border-subtle bg-bg-elevated">
        <h2 className="font-serif text-xl">Authorize</h2>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
          <X className="h-5 w-5" aria-hidden />
        </Button>
      </header>

      <div className="flex-1 flex flex-col items-center justify-center gap-6 p-6">
        <p className="text-sm text-text-secondary">Enter manager PIN to authorize discount</p>

        <NumpadPin
          key={pinKey}
          onSubmit={(pin) => void handleSubmit(pin)}
          isLoading={isLoading}
        />
      </div>
    </FullScreenModal>
  );
}
