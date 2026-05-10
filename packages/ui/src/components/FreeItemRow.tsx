// packages/ui/src/components/FreeItemRow.tsx
// Spec ref: docs/superpowers/specs/2026-05-07-session-8-promotions-engine-spec.md
import type { JSX } from 'react';
import { Gift } from 'lucide-react';

export interface FreeItemRowProps {
  productName: string;
  promotionName: string;
}

export function FreeItemRow({ productName, promotionName }: FreeItemRowProps): JSX.Element {
  return (
    <div className="flex items-center justify-between p-2 rounded bg-green/20 border border-green/30">
      <div className="flex items-center gap-2">
        <Gift className="h-4 w-4 text-green" />
        <div>
          <div className="font-medium">{productName}</div>
          <div className="text-xs text-text-secondary">{promotionName}</div>
        </div>
      </div>
      <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-green text-white">FREE</span>
    </div>
  );
}
