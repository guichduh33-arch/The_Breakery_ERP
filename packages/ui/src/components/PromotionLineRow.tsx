// packages/ui/src/components/PromotionLineRow.tsx
// Spec ref: docs/superpowers/specs/2026-05-07-session-8-promotions-engine-spec.md
import type { JSX } from 'react';
import { Tag } from 'lucide-react';
import { cn } from '../lib/cn.js';
import { Currency } from './Currency.js';

export interface PromotionLineRowProps {
  name: string;
  discount_amount: number;
  subtitle?: string;
  className?: string;
}

export function PromotionLineRow({
  name,
  discount_amount,
  subtitle,
  className = '',
}: PromotionLineRowProps): JSX.Element {
  return (
    <div className={cn('flex items-center justify-between text-green', className)}>
      <div className="flex items-center gap-2">
        <Tag className="h-4 w-4" />
        <div>
          <div className="text-sm">Promo: {name}</div>
          {subtitle && <div className="text-xs text-text-secondary">{subtitle}</div>}
        </div>
      </div>
      <span className="text-sm font-mono">
        −<Currency amount={discount_amount} />
      </span>
    </div>
  );
}
