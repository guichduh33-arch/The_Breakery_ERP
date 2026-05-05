// apps/pos/src/features/loyalty/components/LoyaltyPointsLine.tsx
import { Star } from 'lucide-react';
import { earnPointsFor } from '@breakery/domain';

interface LoyaltyPointsLineProps {
  total: number;
}

export function LoyaltyPointsLine({ total }: LoyaltyPointsLineProps) {
  const points = earnPointsFor(total);
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
