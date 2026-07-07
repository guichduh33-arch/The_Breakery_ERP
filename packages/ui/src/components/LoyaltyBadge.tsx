import type { JSX } from 'react';
import type { LoyaltyTier } from '@breakery/domain';
import { cn } from '../lib/cn.js';

export interface LoyaltyBadgeProps {
  tier: LoyaltyTier;
  points: number;
}

// Theme-aware tier tints (design audit 2026-07-07, DS I-2) — the previous
// light-locked Tailwind pairs (amber-100/slate-200/violet-100) washed out on
// the POS luxe-dark surfaces. Semantic tokens render under both themes.
const TIER_CLASSES: Record<LoyaltyTier, string> = {
  bronze: 'bg-warning-soft text-warning',
  silver: 'bg-bg-overlay text-text-secondary',
  gold: 'bg-gold-soft text-gold',
  platinum: 'bg-info-soft text-info',
};

const TIER_LABELS: Record<LoyaltyTier, string> = {
  bronze: 'Bronze',
  silver: 'Silver',
  gold: 'Gold',
  platinum: 'Platinum',
};

export function LoyaltyBadge({ tier, points }: LoyaltyBadgeProps): JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold',
        TIER_CLASSES[tier],
      )}
    >
      <span>{TIER_LABELS[tier]}</span>
      <span className="font-mono">{points.toLocaleString()} pts</span>
    </span>
  );
}
