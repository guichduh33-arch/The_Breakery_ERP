import { useState, type JSX } from 'react';
import { cn } from '../lib/cn.js';
import { Button } from '../primitives/Button.js';
import { Numpad } from './Numpad.js';

export interface NumpadPinProps {
  onSubmit: (pin: string) => void;
  maxLength?: number;
  isLoading?: boolean;
  error?: string | null;
}

export function NumpadPin({ onSubmit, maxLength = 6, isLoading, error }: NumpadPinProps): JSX.Element {
  const [pin, setPin] = useState('');
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
        <Button variant="secondary" onClick={() => setPin('')}>Cancel</Button>
        <Button
          variant="gold"
          disabled={pin.length < 4 || isLoading}
          onClick={() => onSubmit(pin)}
        >
          {isLoading ? 'Verifying...' : 'Verify'}
        </Button>
      </div>
    </div>
  );
}
