// Spec ref: docs/superpowers/specs/2026-05-06-session-7-customer-categories-combos-spec.md §4.2
import type { JSX } from 'react';
import type { CustomerCategory } from '@breakery/domain';
import { cn } from '../lib/cn.js';

export type { CustomerCategory };

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
          'bg-bg-overlay text-text-secondary',
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
