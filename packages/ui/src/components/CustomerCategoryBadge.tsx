// TODO: switch to @breakery/domain once customerCategories is exported from domain index
// Spec ref: docs/superpowers/specs/2026-05-06-session-7-customer-categories-combos-spec.md §4.2
import type { JSX } from 'react';
import { cn } from '../lib/cn.js';

export interface CustomerCategory {
  id: string;
  name: string;
  slug: string;
  color: string | null;
  icon: string | null;
  price_modifier_type: 'retail' | 'wholesale' | 'discount_percentage' | 'custom';
  discount_percentage: number;
  loyalty_enabled: boolean;
  points_multiplier: number;
  is_default: boolean;
}

export interface CustomerCategoryBadgeProps {
  category: CustomerCategory | null;
  className?: string;
}

const FALLBACK_COLOR = '#64748B';

export function CustomerCategoryBadge({
  category,
  className,
}: CustomerCategoryBadgeProps): JSX.Element {
  if (category === null) {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold',
          'bg-slate-100 text-slate-600',
          className,
        )}
      >
        <span aria-hidden>•</span>
        <span>Retail</span>
      </span>
    );
  }

  const color = category.color ?? FALLBACK_COLOR;
  const alpha20 = `${color}33`;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold',
        className,
      )}
      style={{ backgroundColor: alpha20, color }}
    >
      <span aria-hidden>{category.icon ?? '•'}</span>
      <span>{category.name}</span>
    </span>
  );
}
