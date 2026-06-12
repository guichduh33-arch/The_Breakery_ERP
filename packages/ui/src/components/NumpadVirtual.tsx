// packages/ui/src/components/NumpadVirtual.tsx
//
// NumpadVirtual — full virtual numpad with mode-specific keys + submit.
//
// Session 14 / Phase 1.A — generalizes NumpadPin (PIN-only) to cover the
// three modes seen in the screenshots:
//
//   mode='pin'     6 dots above, no decimal, masked input. Submit = "Verify".
//                  refs: 11-shift-open-pin-modal.jpg
//
//   mode='cash'    raw value shown above, decimal key enabled, large keys.
//                  Submit = "Confirm". refs: 12-shift-open-cash-modal-numpad.jpg
//
//   mode='numeric' raw value shown above, decimal disabled, smaller padding.
//                  Submit = "OK". For quantity / weight entry.
//
// Style: large tactile buttons (h-touch-large), rounded-lg, dark theme by
// default; auto-themes under .theme-backoffice via tokens. Action keys
// (clear / back) are red-soft to distinguish from digits at a glance.
//
// Internal state lives here — caller only receives the final submitted value.

import { Check, Delete } from 'lucide-react';
import { memo, useCallback, useMemo, useState, type JSX } from 'react';
import { cn } from '../lib/cn.js';
import { Button } from '../primitives/Button.js';

export type NumpadMode = 'pin' | 'cash' | 'numeric';

export interface NumpadVirtualProps {
  /** Mode controls layout, mask, and decimal availability. */
  mode?: NumpadMode;
  /** Submit handler — fires when user presses the submit button. */
  onSubmit: (value: string) => void;
  /** Optional cancel handler — when present, renders a Cancel button. */
  onCancel?: () => void;
  /** Optional initial value (controlled-by-parent reset would re-mount). */
  initialValue?: string;
  /** Maximum digit count. Default: 6 for pin, undefined for others. */
  maxLength?: number;
  /** Auto-submit when the value reaches maxLength (mode 'pin' only). Opt-in. */
  autoSubmitAtMaxLength?: boolean;
  /** Loading state — disables submit + shows "Verifying..." copy in pin mode. */
  isLoading?: boolean;
  /** Error message shown below the keypad in danger color. */
  error?: string | null;
  /** Override the submit button label. */
  submitLabel?: string;
  /** Override the cancel button label. */
  cancelLabel?: string;
  /** Wrapper className. */
  className?: string;
}

interface KeyDef {
  label: string;
  type: 'digit' | 'clear' | 'back' | 'decimal';
  className?: string;
}

const DIGIT_ROWS: ReadonlyArray<ReadonlyArray<KeyDef>> = [
  [
    { label: '1', type: 'digit' },
    { label: '2', type: 'digit' },
    { label: '3', type: 'digit' },
  ],
  [
    { label: '4', type: 'digit' },
    { label: '5', type: 'digit' },
    { label: '6', type: 'digit' },
  ],
  [
    { label: '7', type: 'digit' },
    { label: '8', type: 'digit' },
    { label: '9', type: 'digit' },
  ],
];

function buildKeys(mode: NumpadMode): KeyDef[] {
  const bottomRow: KeyDef[] =
    mode === 'cash'
      ? [
          { label: 'C', type: 'clear' },
          { label: '0', type: 'digit' },
          { label: '.', type: 'decimal' },
        ]
      : [
          { label: 'C', type: 'clear' },
          { label: '0', type: 'digit' },
          { label: '←', type: 'back' },
        ];
  return [...DIGIT_ROWS.flat(), ...bottomRow];
}

function NumpadVirtualInner({
  mode = 'numeric',
  onSubmit,
  onCancel,
  initialValue = '',
  maxLength,
  autoSubmitAtMaxLength,
  isLoading,
  error,
  submitLabel,
  cancelLabel = 'Cancel',
  className,
}: NumpadVirtualProps): JSX.Element {
  const [value, setValue] = useState(initialValue);
  const effectiveMaxLength = maxLength ?? (mode === 'pin' ? 6 : undefined);
  const keys = useMemo(() => buildKeys(mode), [mode]);

  const handleKey = useCallback(
    (key: KeyDef) => {
      if (key.type === 'clear') return setValue('');
      if (key.type === 'back') return setValue((v) => v.slice(0, -1));
      if (key.type === 'decimal') {
        return setValue((v) => (v.includes('.') ? v : v === '' ? '0.' : `${v}.`));
      }
      // digit — computed from the rendered `value` (not a functional updater)
      // so the auto-submit side-effect below stays OUT of the state updater
      // (StrictMode double-invokes updaters). Each tap is its own event →
      // its own render, so `value` is always fresh here.
      if (effectiveMaxLength !== undefined && value.length >= effectiveMaxLength) return;
      const next = value + key.label;
      setValue(next);
      // Session 43 / P2-10 — opt-in auto-submit on the last PIN digit.
      if (
        autoSubmitAtMaxLength &&
        mode === 'pin' &&
        effectiveMaxLength !== undefined &&
        next.length === effectiveMaxLength
      ) {
        onSubmit(next);
      }
    },
    [effectiveMaxLength, value, autoSubmitAtMaxLength, mode, onSubmit],
  );

  const handleSubmit = useCallback(() => onSubmit(value), [onSubmit, value]);
  const handleCancel = useCallback(() => {
    setValue('');
    onCancel?.();
  }, [onCancel]);

  const canSubmit = useMemo(() => {
    if (isLoading) return false;
    if (mode === 'pin' && effectiveMaxLength !== undefined) {
      return value.length === effectiveMaxLength;
    }
    return value.length > 0;
  }, [isLoading, mode, effectiveMaxLength, value]);

  const submitText =
    submitLabel ??
    (isLoading
      ? mode === 'pin'
        ? 'Verifying...'
        : 'Submitting...'
      : mode === 'pin'
        ? 'Verify'
        : mode === 'cash'
          ? 'Confirm'
          : 'OK');

  return (
    <div className={cn('flex flex-col gap-6', className)} role="group" aria-label="Numpad">
      {/* Value display */}
      {mode === 'pin' && effectiveMaxLength !== undefined ? (
        <div className="flex justify-center gap-2" aria-label="PIN dots">
          {Array.from({ length: effectiveMaxLength }).map((_, i) => (
            <div
              key={i}
              className={cn(
                'h-3 w-3 rounded-full border border-border-strong',
                i < value.length && 'bg-gold border-gold',
              )}
            />
          ))}
        </div>
      ) : (
        <div
          aria-label="Entered value"
          className="text-center font-mono tabular-nums text-3xl text-text-primary min-h-[2.5rem]"
        >
          {value || <span className="text-text-muted">0</span>}
        </div>
      )}

      {/* Keypad */}
      <div className="grid grid-cols-3 gap-3">
        {keys.map((k) => {
          const isAction = k.type === 'clear' || k.type === 'back';
          const ariaLabel =
            k.type === 'clear' ? 'Clear' : k.type === 'back' ? 'Backspace' : k.label;
          return (
            <button
              key={k.label}
              type="button"
              onClick={() => handleKey(k)}
              aria-label={ariaLabel}
              className={cn(
                'h-touch-large rounded-lg text-2xl font-semibold transition-colors duration-fast motion-reduce:transition-none active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold',
                isAction
                  ? 'bg-red-soft border border-red text-red hover:bg-red/30'
                  : 'bg-bg-input border border-border-subtle text-text-primary hover:bg-bg-overlay',
              )}
            >
              {k.type === 'back' ? (
                <Delete className="h-6 w-6 mx-auto" aria-hidden />
              ) : (
                k.label
              )}
            </button>
          );
        })}
      </div>

      {error && (
        <p role="alert" className="text-danger text-sm text-center">
          {error}
        </p>
      )}

      <div className="flex gap-3 justify-center">
        {onCancel !== undefined && (
          <Button variant="secondary" onClick={handleCancel} disabled={isLoading}>
            {cancelLabel}
          </Button>
        )}
        <Button variant="gold" disabled={!canSubmit} onClick={handleSubmit}>
          <span className="inline-flex items-center gap-2">
            {!isLoading && mode === 'numeric' && <Check className="h-4 w-4" aria-hidden />}
            {submitText}
          </span>
        </Button>
      </div>
    </div>
  );
}

export const NumpadVirtual = memo(NumpadVirtualInner);
