import { Delete } from 'lucide-react';
import { memo, useCallback, type JSX } from 'react';
import { cn } from '../lib/cn.js';

export interface NumpadProps {
  value: string;
  onChange: (next: string) => void;
  maxLength?: number;
  className?: string;
}

interface NumpadKey {
  label: string;
  type: 'digit' | 'clear' | 'back';
}

const KEYS: NumpadKey[] = [
  { label: '1', type: 'digit' }, { label: '2', type: 'digit' }, { label: '3', type: 'digit' },
  { label: '4', type: 'digit' }, { label: '5', type: 'digit' }, { label: '6', type: 'digit' },
  { label: '7', type: 'digit' }, { label: '8', type: 'digit' }, { label: '9', type: 'digit' },
  { label: 'C', type: 'clear' }, { label: '0', type: 'digit' }, { label: 'Back', type: 'back' },
];

// D7 (session 8 perf-debt): React.memo skips re-renders when value/onChange/
// maxLength/className are reference-stable. The internal `handle` callback is
// memoised via useCallback so we don't re-create the per-button onClick on
// every render — important because the buttons array is rebuilt regardless.
function NumpadInner({ value, onChange, maxLength, className }: NumpadProps): JSX.Element {
  const handle = useCallback(
    (key: NumpadKey) => {
      if (key.type === 'clear') return onChange('');
      if (key.type === 'back') return onChange(value.slice(0, -1));
      if (maxLength !== undefined && value.length >= maxLength) return;
      onChange(value + key.label);
    },
    [value, maxLength, onChange],
  );

  return (
    <div className={cn('grid grid-cols-3 gap-3', className)} role="group" aria-label="Numpad">
      {KEYS.map((k) => {
        const ariaLabel = k.type === 'clear' ? 'Clear' : k.type === 'back' ? 'Backspace' : k.label;
        return (
          <button
            key={k.label}
            type="button"
            onClick={() => handle(k)}
            aria-label={ariaLabel}
            className={cn(
              'h-touch-comfy rounded-md text-2xl font-semibold transition-colors active:scale-95 motion-reduce:transition-none motion-reduce:active:scale-100',
              // Keyboard focus ring on a money-path surface (design audit 2026-07-08, T5).
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold',
              // Only Clear ("C") is destructive-red; Backspace is neutral —
              // a backspace is not a destructive action (design audit 2026-07-08, T14).
              k.type === 'clear'
                ? 'bg-red-soft border border-red text-red hover:bg-red/30'
                : k.type === 'back'
                  ? 'bg-bg-overlay border border-border-subtle text-text-secondary hover:bg-surface-4'
                  : 'bg-bg-input border border-border-subtle text-text-primary hover:bg-bg-overlay',
            )}
          >
            {k.type === 'back' ? <Delete className="h-6 w-6 mx-auto" aria-hidden /> : k.label}
          </button>
        );
      })}
    </div>
  );
}

export const Numpad = memo(NumpadInner);
