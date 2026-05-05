// apps/pos/src/features/kds/hooks/useAgeTimer.ts
//
// Tiny tick-every-second hook that re-renders consumers so age timers stay
// fresh without anyone owning a setInterval per card.

import { useEffect, useState } from 'react';

export function useAgeTimer(periodMs = 1_000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => {
      setNow(Date.now());
    }, periodMs);
    return () => {
      window.clearInterval(id);
    };
  }, [periodMs]);

  return now;
}
