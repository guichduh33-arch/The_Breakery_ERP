// apps/pos/src/features/tablet/components/OrderTypeToggle.tsx
//
// Design audit 2026-07-07 (Tablet B2/I5) — the accessible 44px order-type
// toggle (role=tablist, focus-visible ring, min-h-11) extracted from
// features/tablet/TabletOrderPage so the ROUTED page (pages/tablet) stops
// re-implementing it with 27-30px raw <button>s.

import type { JSX, ReactNode } from 'react';
import { cn } from '@breakery/ui';

export function OrderTypeToggle({
  value,
  onChange,
}: {
  value: 'dine_in' | 'take_out';
  onChange: (next: 'dine_in' | 'take_out') => void;
}): JSX.Element {
  return (
    <div
      role="tablist"
      aria-label="Order type"
      className="inline-flex rounded-md border border-border-subtle overflow-hidden"
    >
      <ToggleTab
        active={value === 'dine_in'}
        onClick={() => onChange('dine_in')}
        testId="tablet-order-type-dine-in"
      >
        Dine in
      </ToggleTab>
      <ToggleTab
        active={value === 'take_out'}
        onClick={() => onChange('take_out')}
        testId="tablet-order-type-take-out"
      >
        Take out
      </ToggleTab>
    </div>
  );
}

function ToggleTab({
  active,
  onClick,
  children,
  testId,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  testId: string;
}): JSX.Element {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      data-testid={testId}
      className={cn(
        'min-h-11 px-5 text-sm font-semibold uppercase tracking-wide',
        'transition-colors duration-fast motion-reduce:transition-none',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold focus-visible:outline-offset-2',
        active
          ? 'bg-gold text-bg-base'
          : 'bg-transparent text-text-secondary hover:text-text-primary hover:bg-bg-overlay',
      )}
    >
      {children}
    </button>
  );
}
