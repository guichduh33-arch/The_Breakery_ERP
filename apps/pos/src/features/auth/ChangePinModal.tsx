// apps/pos/src/features/auth/ChangePinModal.tsx
// Session 19 / Phase 3.C — Self-change PIN modal (Thread C).
// Session 21 / Phase 1.C.4 — UX polish (DEV-S19-3.C-01..03).
//
// 3 steps : 'current' → 'new' → 'confirm'.
//   1. Current PIN  — collected, will be verified server-side by the EF
//                     (wrong current PIN → toast + reset to step 1).
//   2. New PIN      — live weak hint via `evaluatePinStrength` from
//                     `@breakery/utils` (warn-only per D13).
//   3. Confirm PIN  — must match step 2 ; mismatch → toast + reset to step 2
//                     (S21: was step 1, now step 2 — DEV-S19-3.C-03).
//
// On submit success : toast "PIN updated." (+ weak warning if EF returns
// `weak: true`). EF response is read as the extended shape from Phase 2.B
// (`{ ok, weak, weak_reason? }`) — D14/D16 (BO + POS surfaces both consume
// the same `weak` flag from the shared util).
//
// Implementation note : reuses `NumpadPin` from `@breakery/ui` (collection-only
// 6-digit pad with `onSubmit(pin)` callback). The other `PinPad` in
// `apps/pos/src/features/auth/PinPad.tsx` is verification-only (hits
// `auth-verify-pin` directly) and cannot be reused as a collection-only step.
// `NumpadPin` is the canonical primitive for collect-then-confirm flows
// (already used by `RefundOrderModal` for manager PIN).
// DEV-S21-1.C.4-01 : spec requested swap NumpadPin→PinPad (DEV-S19-3.C-01)
// but PinPad is wired to auth-verify-pin EF and cannot collect a new PIN —
// NumpadPin remains the correct primitive. Deviation recorded in INDEX §10.

import { useState, type JSX } from 'react';
import { X } from 'lucide-react';
import { toast } from 'sonner';

import {
  CenterModal,
  DialogTitle,
  DialogDescription,
  NumpadPin,
  Button,
} from '@breakery/ui';
import { evaluatePinStrength } from '@breakery/utils';

import { useChangePin } from './hooks/useChangePin';

type Step = 'current' | 'new' | 'confirm';

export interface ChangePinModalProps {
  open: boolean;
  onClose: () => void;
  userId: string;
}

const STEP_TITLE: Record<Step, string> = {
  current: 'Enter current PIN',
  new: 'Enter new PIN',
  confirm: 'Confirm new PIN',
};

const STEP_DESCRIPTION: Record<Step, string> = {
  current: 'Type your existing 6-digit PIN to authorize the change.',
  new: 'Choose a new 6-digit PIN. Avoid sequences (123456) and repetitions (111111).',
  confirm: 'Re-enter your new PIN to confirm.',
};

export function ChangePinModal({ open, onClose, userId }: ChangePinModalProps): JSX.Element {
  const [step, setStep] = useState<Step>('current');
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  // Force re-mount of NumpadPin between steps to clear its internal state.
  const [padKey, setPadKey] = useState(0);

  const change = useChangePin();

  // Live evaluation of what the user is about to commit at step 2.
  // We only show the hint once a full 6-digit PIN is candidate ; while
  // typing the partial value, NumpadPin holds it internally and we'd need
  // its value to evaluate live. To keep this self-contained, we evaluate
  // the last committed value of `newPin` (set on step-2 submit) — for
  // truly live feedback we would lift state up from NumpadPin. The hint
  // visible on step 2 is therefore relevant when the user re-enters
  // (after a mismatch) ; it's also relevant when the EF's success toast
  // surfaces the same reason. This is consistent with D13 (warn-only).
  const newStrength = evaluatePinStrength(newPin);

  function reset(): void {
    setStep('current');
    setCurrentPin('');
    setNewPin('');
    setPadKey((k) => k + 1);
    change.reset();
  }

  /** S21 / 1.C.4-c : on mismatch, go back to step 2 (re-enter new PIN) rather
   * than step 1 (re-verify old PIN). The old PIN is still valid — no need to
   * ask again. We keep `newPin` so the weak-hint at step 2 can still render
   * if the previous choice was weak. DEV-S19-3.C-03. */
  function resetToNew(): void {
    // Keep newPin so step-2 weak hint shows for previously committed weak PIN.
    setStep('new');
    setPadKey((k) => k + 1);
    change.reset();
  }

  function close(): void {
    reset();
    onClose();
  }

  function handlePadSubmit(pin: string): void {
    if (pin.length !== 6) {
      // NumpadPin already disables submit when pin.length !== maxLength,
      // but be defensive.
      return;
    }

    if (step === 'current') {
      setCurrentPin(pin);
      setStep('new');
      setPadKey((k) => k + 1);
      return;
    }

    if (step === 'new') {
      setNewPin(pin);
      setStep('confirm');
      setPadKey((k) => k + 1);
      return;
    }

    // step === 'confirm'
    if (pin !== newPin) {
      toast.error('PINs do not match. Please re-enter your new PIN.');
      resetToNew(); // S21: was reset() (→ step 1), now resetToNew() (→ step 2)
      return;
    }

    change.mutate(
      { userId, currentPin, newPin },
      {
        onSuccess: (res) => {
          const baseMsg = 'PIN updated.';
          const fullMsg =
            res.weak && res.weak_reason
              ? `${baseMsg} Warning : this PIN is weak (${res.weak_reason}). Consider a stronger one next time.`
              : baseMsg;
          toast.success(fullMsg);
          close();
        },
        onError: (e: Error) => {
          if (e.message === 'invalid_current_pin') {
            toast.error('Current PIN is wrong.');
          } else if (e.message === 'rate_limited') {
            toast.error('Too many attempts. Try again in a minute.');
          } else {
            toast.error(`Change failed : ${e.message}`);
          }
          reset();
        },
      },
    );
  }

  return (
    <CenterModal
      open={open}
      onOpenChange={(o) => { if (!o) close(); }}
      className="w-[min(420px,92vw)]"
      data-testid="change-pin-modal"
    >
      <header className="px-5 py-4 flex items-center justify-between border-b border-border-subtle">
        <div className="min-w-0">
          <DialogTitle className="font-serif text-lg leading-tight">
            {STEP_TITLE[step]}
          </DialogTitle>
          <DialogDescription className="text-text-secondary text-xs mt-1">
            Step {step === 'current' ? 1 : step === 'new' ? 2 : 3} of 3
          </DialogDescription>
        </div>
        <button
          type="button"
          aria-label="Close"
          onClick={close}
          className="text-text-secondary hover:text-text-primary"
        >
          <X className="h-5 w-5" aria-hidden />
        </button>
      </header>

      <div className="px-5 py-4 space-y-4">
        <p className="text-sm text-text-secondary">{STEP_DESCRIPTION[step]}</p>

        <NumpadPin
          key={padKey}
          maxLength={6}
          onSubmit={handlePadSubmit}
          isLoading={change.isPending}
        />

        {/* S21 / 1.C.4-b: show weak-hint at step 2 (new PIN entry) only —
            not at step 3 (confirm). This surfaces the feedback while the user
            is choosing, not after confirmation. DEV-S19-3.C-02.
            On first entry newPin is '' (hint hidden). On re-entry after mismatch
            the hint shows if the previously committed PIN was weak. */}
        {step === 'new' && newPin.length === 6 && newStrength.weak && (
          <p
            className="text-xs italic text-amber-warn text-center"
            data-testid="pin-weak-hint"
          >
            Weak PIN ({newStrength.reason}). Consider a stronger one.
          </p>
        )}
      </div>

      <footer className="px-5 py-3 flex items-center justify-end border-t border-border-subtle">
        <Button
          variant="ghost"
          onClick={close}
          data-testid="change-pin-cancel"
          disabled={change.isPending}
        >
          Cancel
        </Button>
      </footer>
    </CenterModal>
  );
}
