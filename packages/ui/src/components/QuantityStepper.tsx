import { Minus, Plus } from 'lucide-react';
import { memo, useCallback, type JSX } from 'react';
import { cn } from '../lib/cn.js';

export interface QuantityStepperProps {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  className?: string;
}

// D7 (session 8 perf-debt): React.memo + useCallback so the cart row doesn't
// re-render this stepper (and trigger DOM diffs on its two buttons) when
// unrelated cart state changes. All three handlers (decrement, increment,
// manual click) are stable across renders given the same value/min/max/onChange.
function QuantityStepperInner({
  value,
  onChange,
  min = 0,
  max = 999,
  className,
}: QuantityStepperProps): JSX.Element {
  const handleDecrement = useCallback(
    () => onChange(Math.max(min, value - 1)),
    [onChange, min, value],
  );
  const handleIncrement = useCallback(
    () => onChange(Math.min(max, value + 1)),
    [onChange, max, value],
  );

  return (
    <div className={cn('inline-flex items-center gap-2', className)}>
      <button
        type="button"
        aria-label="Decrease"
        className="h-8 w-8 rounded-md bg-bg-input border border-border-subtle hover:bg-bg-overlay disabled:opacity-50"
        onClick={handleDecrement}
        disabled={value <= min}
      >
        <Minus className="h-4 w-4 mx-auto" aria-hidden />
      </button>
      <span className="min-w-[2rem] text-center font-mono tabular-nums">{value}</span>
      <button
        type="button"
        aria-label="Increase"
        className="h-8 w-8 rounded-md bg-bg-input border border-border-subtle hover:bg-bg-overlay disabled:opacity-50"
        onClick={handleIncrement}
        disabled={value >= max}
      >
        <Plus className="h-4 w-4 mx-auto" aria-hidden />
      </button>
    </div>
  );
}

export const QuantityStepper = memo(QuantityStepperInner);
