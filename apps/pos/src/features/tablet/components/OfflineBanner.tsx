// apps/pos/src/features/tablet/components/OfflineBanner.tsx
//
// Session 13 / Phase 4.D — Tablet polish.
//
// Slim banner that mounts above the menu grid when the tablet has lost
// network connectivity. Surfaces the time of the last successful sync so
// the waiter knows whether the cached menu is fresh enough to keep using.

import { useEffect, useState, type JSX } from 'react';
import { WifiOff } from 'lucide-react';

export interface OfflineBannerProps {
  /** When false the banner is shown ; when true the banner unmounts. */
  isOnline: boolean;
  /** Date of last successful sync, or null when no cache exists yet. */
  lastSync: Date | null;
}

function formatRelative(then: Date): string {
  const diffMs = Date.now() - then.getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'less than a minute ago';
  if (minutes === 1) return '1 minute ago';
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours === 1) return '1 hour ago';
  return `${hours} hours ago`;
}

export function OfflineBanner({ isOnline, lastSync }: OfflineBannerProps): JSX.Element | null {
  // Re-render once a minute so the relative time stays fresh.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (isOnline) return undefined;
    const handle = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(handle);
  }, [isOnline]);

  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="tablet-offline-banner"
      className="flex items-center gap-3 border-b border-warning/30 bg-warning-soft px-4 py-2 text-sm text-warning"
    >
      <WifiOff className="h-4 w-4 shrink-0" aria-hidden />
      <span className="font-semibold uppercase tracking-widest text-xs">Offline</span>
      <span className="text-text-secondary">
        {lastSync !== null
          ? `Showing cached menu — last synced ${formatRelative(lastSync)}.`
          : 'No connection. Menu may be incomplete.'}
      </span>
    </div>
  );
}
