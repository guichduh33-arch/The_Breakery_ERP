// apps/backoffice/src/features/inventory/components/LowStockBadge.tsx
//
// Tiny visual hint rendered when a product dips strictly below its
// configured minimum. Threshold === 0 disables tracking, in which case
// the badge is never rendered.

import { Badge } from '@breakery/ui';

export interface LowStockBadgeProps {
  currentStock:       number;
  minStockThreshold:  number;
}

export function LowStockBadge({ currentStock, minStockThreshold }: LowStockBadgeProps) {
  if (minStockThreshold <= 0)            return null;
  if (currentStock >= minStockThreshold) return null;
  return (
    <Badge variant="destructive" className="ml-2 text-[10px] uppercase tracking-widest">
      Low stock
    </Badge>
  );
}
