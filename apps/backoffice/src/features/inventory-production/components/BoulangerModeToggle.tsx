// apps/backoffice/src/features/inventory-production/components/BoulangerModeToggle.tsx
//
// Session 15 / Phase 5.B — Toggle switch for baker's percentage mode on a
// recipe editor (spec §D13).
//
// Pure UI : props in, callback out, no data fetching. The contextual warning
// is shown inline depending on the *current* value (ON → "switching back to
// absolute mode preserves last-known absolute qtys" ; OFF → "turning on will
// require re-entering rows as percentages of flour").

import type { JSX } from 'react';
import { cn } from '@breakery/ui';

export interface BoulangerModeToggleProps {
  value:     boolean;
  onChange:  (next: boolean) => void;
  disabled?: boolean;
}

export function BoulangerModeToggle({
  value,
  onChange,
  disabled = false,
}: BoulangerModeToggleProps): JSX.Element {
  const warningOn =
    "Baker's mode treats all quantities as percentages of flour. Existing rows need to be re-entered as percentages.";
  const warningOff =
    'Switching back to absolute mode preserves the absolute qtys computed via the last target flour qty.';

  return (
    <div className="flex flex-col gap-1" data-testid="baker-mode-toggle">
      <div className="flex items-center gap-2">
        <span className="text-xs uppercase tracking-widest text-text-secondary">
          Baker&rsquo;s mode
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={value}
          aria-label="Toggle baker's percentage mode"
          data-testid="baker-mode-switch"
          disabled={disabled}
          onClick={() => onChange(!value)}
          className={cn(
            'relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-fast',
            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold',
            'disabled:cursor-not-allowed disabled:opacity-50',
            value ? 'bg-green' : 'bg-bg-overlay border border-border-subtle',
          )}
        >
          <span
            className={cn(
              'inline-block h-4 w-4 rounded-full bg-white shadow transition-transform duration-fast',
              value ? 'translate-x-6' : 'translate-x-1',
            )}
          />
        </button>
        <span
          className={cn(
            'text-xs font-semibold uppercase tracking-widest',
            value ? 'text-green' : 'text-text-muted',
          )}
          data-testid="baker-mode-state"
        >
          {value ? 'ON' : 'OFF'}
        </span>
      </div>
      <p
        className="text-xs text-text-secondary max-w-md"
        role="note"
        data-testid="baker-mode-warning"
      >
        {value ? warningOff : warningOn}
      </p>
    </div>
  );
}

export default BoulangerModeToggle;
