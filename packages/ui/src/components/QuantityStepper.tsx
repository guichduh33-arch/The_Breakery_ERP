import { Minus, Plus } from 'lucide-react';
import type { JSX } from 'react';
import { cn } from '../lib/cn.js';

export interface QuantityStepperProps {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  className?: string;
}

export function QuantityStepper({
  value,
  onChange,
  min = 0,
  max = 999,
  className,
}: QuantityStepperProps): JSX.Element {
  return (
    <div className={cn('inline-flex items-center gap-2', className)}>
      <button
        type="button"
        aria-label="Decrease"
        className="h-8 w-8 rounded-md bg-bg-input border border-border-subtle hover:bg-bg-overlay disabled:opacity-50"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
      >
        <Minus className="h-4 w-4 mx-auto" aria-hidden />
      </button>
      <span className="min-w-[2rem] text-center font-mono tabular-nums">{value}</span>
      <button
        type="button"
        aria-label="Increase"
        className="h-8 w-8 rounded-md bg-bg-input border border-border-subtle hover:bg-bg-overlay disabled:opacity-50"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
      >
        <Plus className="h-4 w-4 mx-auto" aria-hidden />
      </button>
    </div>
  );
}
