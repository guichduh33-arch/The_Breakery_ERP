// apps/pos/src/features/kds/components/KdsEmptyState.tsx
//
// Local empty-state for the KDS queue. Kept in `apps/pos` because no
// generic <EmptyState/> exists in @breakery/ui yet (its design will likely
// land with session 4 holds/floor plan).
//
// Design Wave C (2026-07-07) — up-scaled to be read at a glance from 2-3 m
// across the kitchen: a large icon, a headline in display type, and a calm
// "all caught up" sub-line so an empty board reads as intentional, not broken.

import { ChefHat } from 'lucide-react';

interface KdsEmptyStateProps {
  message: string;
}

export function KdsEmptyState({ message }: KdsEmptyStateProps) {
  return (
    <div
      className="col-span-full h-full grid place-items-center text-text-muted"
      data-testid="kds-empty"
    >
      <div className="text-center space-y-5">
        <ChefHat className="h-24 w-24 mx-auto opacity-40" aria-hidden />
        <p className="font-display text-3xl md:text-4xl text-text-secondary">
          {message}
        </p>
        <p className="text-lg uppercase tracking-[0.3em] text-text-muted">
          Kitchen all caught up
        </p>
      </div>
    </div>
  );
}
