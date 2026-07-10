// apps/pos/src/features/loyalty/components/LoyaltyPointsLine.tsx
import { Star } from 'lucide-react';
import { earnPointsFor } from '@breakery/domain';

interface LoyaltyPointsLineProps {
  total: number;
  /**
   * Full points multiplier (tier × category). S72 audit: previously omitted, so
   * the cart always showed bronze-rate points regardless of the customer's tier
   * — and a different number from the payment screen. Defaults to 1.0.
   */
  multiplier?: number;
}

export function LoyaltyPointsLine({ total, multiplier = 1.0 }: LoyaltyPointsLineProps) {
  const points = earnPointsFor(total, multiplier);
  if (points === 0) return null;
  return (
    <div className="flex items-center justify-between text-xs text-text-secondary">
      <span className="flex items-center gap-1">
        <Star className="h-3 w-3 text-gold" aria-hidden />
        Points to earn
      </span>
      <span className="font-mono text-gold font-semibold">{points} pts</span>
    </div>
  );
}
