import { memo, useCallback, useState, type JSX } from 'react';
import { cn } from '../lib/cn.js';
import { Button } from '../primitives/Button.js';
import { Numpad } from './Numpad.js';

export interface NumpadPinProps {
  onSubmit: (pin: string) => void;
  /**
   * Exact PIN length. Session 1 expects 6 digits exact (see addendum, decision PIN).
   * The submit button stays disabled until `pin.length === maxLength`.
   */
  maxLength?: number;
  isLoading?: boolean;
  error?: string | null;
}

// D7 (session 8 perf-debt): React.memo skips re-renders when the parent's
// onSubmit/error/isLoading refs don't change. Cancel + submit handlers are
// useCallback-ed so the inner Numpad memo isn't voided by fresh refs each
// render. setPin from useState is already stable.
function NumpadPinInner({ onSubmit, maxLength = 6, isLoading, error }: NumpadPinProps): JSX.Element {
  const [pin, setPin] = useState('');

  const handleCancel = useCallback(() => setPin(''), []);
  const handleSubmit = useCallback(() => onSubmit(pin), [onSubmit, pin]);

  return (
    <div className="space-y-6">
      <div className="flex justify-center gap-2" aria-label="PIN dots">
        {Array.from({ length: maxLength }).map((_, i) => (
          <div
            key={i}
            className={cn(
              'h-3 w-3 rounded-full border border-border-strong',
              i < pin.length && 'bg-gold border-gold',
            )}
          />
        ))}
      </div>
      <Numpad value={pin} onChange={setPin} maxLength={maxLength} />
      {error && <p className="text-red text-sm text-center">{error}</p>}
      <div className="flex gap-3 justify-center">
        <Button variant="secondary" onClick={handleCancel}>Cancel</Button>
        <Button
          variant="gold"
          disabled={pin.length !== maxLength || isLoading}
          onClick={handleSubmit}
        >
          {isLoading ? 'Verifying...' : 'Verify'}
        </Button>
      </div>
    </div>
  );
}

export const NumpadPin = memo(NumpadPinInner);
