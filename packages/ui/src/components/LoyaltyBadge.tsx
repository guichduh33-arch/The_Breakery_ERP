import type { JSX } from 'react';
import type { LoyaltyTier } from '@breakery/domain';
import { cn } from '../lib/cn.js';

export interface LoyaltyBadgeProps {
  tier: LoyaltyTier;
  points: number;
}

const TIER_CLASSES: Record<LoyaltyTier, string> = {
  bronze: 'bg-amber-100 text-amber-800',
  silver: 'bg-slate-200 text-slate-700',
  gold: 'bg-gold-soft text-gold',
  platinum: 'bg-violet-100 text-violet-800',
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
