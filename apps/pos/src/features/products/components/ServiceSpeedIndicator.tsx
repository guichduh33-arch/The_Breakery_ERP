// apps/pos/src/features/products/components/ServiceSpeedIndicator.tsx
//
// Session 13 / Phase 4.A — small "kitchen rhythm" badge for the POS header.
// Reads the current hour's order-count + avg fulfillment via useServiceSpeed,
// renders a 3-state badge:
//   - idle  : no orders this hour
//   - good  : avg ≤ 4 min OR no signal yet
//   - busy  : avg > 4 min  ≤ 8 min
//   - slow  : avg > 8 min
//
// Visibility : managers+ only (`reports.read` permission). The PIN-auth POS
// permission list already includes `reports.read` for MANAGER / ADMIN /
// SUPER_ADMIN roles.

import type { JSX } from 'react';
import { Activity } from 'lucide-react';
import { Badge, cn } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore';
import { useServiceSpeed } from '../hooks/useServiceSpeed';

type Tone = 'idle' | 'good' | 'busy' | 'slow';

interface ToneMeta {
  label: string;
  className: string;
}

const TONES: Record<Tone, ToneMeta> = {
  idle: { label: 'Idle',  className: 'bg-bg-input text-text-secondary border-border-subtle' },
  good: { label: 'Good',  className: 'bg-success-soft text-success border-success/40' },
  busy: { label: 'Busy',  className: 'bg-warning-soft text-warning border-warning/40' },
  slow: { label: 'Slow',  className: 'bg-danger-soft  text-danger  border-danger/40'  },
};

function toneFor(orderCount: number, avgSec: number | null): Tone {
  if (orderCount === 0) return 'idle';
  if (avgSec === null) return 'good'; // no signal yet but orders flowing
  if (avgSec <= 240) return 'good';
  if (avgSec <= 480) return 'busy';
  return 'slow';
}

function formatSeconds(s: number): string {
  if (s < 60) return `${Math.round(s)}s`;
  const m = Math.floor(s / 60);
  const sec = Math.round(s - m * 60);
  return sec === 0 ? `${m}m` : `${m}m ${sec}s`;
}

export function ServiceSpeedIndicator(): JSX.Element | null {
  const hasReportsRead = useAuthStore((s) => s.hasPermission('reports.read'));
  const speed = useServiceSpeed(hasReportsRead);

  // Hide entirely for cashiers — the badge is a manager-only situational
  // awareness tool. The hook short-circuits the network roundtrip too.
  if (!hasReportsRead) return null;

  // Loading + error: render a neutral placeholder rather than nothing so the
  // header layout doesn't reflow.
  if (speed.isLoading) {
    return (
      <span
        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-border-subtle bg-bg-input text-text-secondary text-xs"
        data-testid="service-speed-indicator"
        data-tone="loading"
        aria-label="Service speed loading"
      >
        <Activity className="h-3 w-3" aria-hidden />
        <span>—</span>
      </span>
    );
  }
  if (speed.isError || !speed.data) {
    return (
      <span
        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-danger/40 bg-danger-soft text-danger text-xs"
        data-testid="service-speed-indicator"
        data-tone="error"
        title={speed.error instanceof Error ? speed.error.message : 'unknown'}
      >
        <Activity className="h-3 w-3" aria-hidden />
        <span>n/a</span>
      </span>
    );
  }

  const { orderCount, avgFulfillmentSeconds } = speed.data;
  const tone = toneFor(orderCount, avgFulfillmentSeconds);
  const meta = TONES[tone];
  const avgLabel = avgFulfillmentSeconds !== null
    ? formatSeconds(avgFulfillmentSeconds)
    : '—';

  return (
    <Badge
      variant="outline"
      data-testid="service-speed-indicator"
      data-tone={tone}
      className={cn('gap-1.5 text-xs font-medium', meta.className)}
      aria-label={`Service speed: ${meta.label}. ${orderCount} orders this hour, avg ${avgLabel}.`}
    >
      <Activity className="h-3 w-3" aria-hidden />
      <span>{meta.label}</span>
      <span className="text-text-secondary" aria-hidden>·</span>
      <span aria-hidden>{orderCount} orders</span>
      {avgFulfillmentSeconds !== null && (
        <>
          <span className="text-text-secondary" aria-hidden>·</span>
          <span aria-hidden>{avgLabel}</span>
        </>
      )}
    </Badge>
  );
}

// Exported for unit tests — pure helpers, no IO.
export const __test__ = { toneFor, formatSeconds };
