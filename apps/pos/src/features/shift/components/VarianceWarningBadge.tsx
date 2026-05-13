// apps/pos/src/features/shift/components/VarianceWarningBadge.tsx
// Session 13 / Phase 3.C — Inline pill shown when |variance| exceeds the
// configured threshold (business_config.shift_variance_threshold_abs/_pct).

import type { JSX } from 'react';

export interface VarianceWarningBadgeProps {
  variance:        number;
  expectedCash:    number;
  thresholdAbs:    number;
  thresholdPct:    number;
}

export function shouldShowWarning(
  variance: number,
  expectedCash: number,
  thresholdAbs: number,
  thresholdPct: number,
): boolean {
  const abs = Math.abs(variance);
  if (abs >= thresholdAbs) return true;
  if (expectedCash > 0 && abs / expectedCash >= thresholdPct) return true;
  return false;
}

export function VarianceWarningBadge({
  variance,
  expectedCash,
  thresholdAbs,
  thresholdPct,
}: VarianceWarningBadgeProps): JSX.Element | null {
  if (!shouldShowWarning(variance, expectedCash, thresholdAbs, thresholdPct)) return null;
  const sign = variance > 0 ? 'OVER' : 'SHORT';
  return (
    <span
      role="status"
      data-testid="variance-warning-badge"
      className="inline-flex items-center gap-1 rounded-full bg-red/15 text-red px-2 py-0.5 text-xs uppercase tracking-wide font-medium"
    >
      {sign} threshold
    </span>
  );
}
