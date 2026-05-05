// apps/pos/src/features/kds/components/KdsEmptyState.tsx
//
// Local empty-state for the KDS queue. Kept in `apps/pos` because no
// generic <EmptyState/> exists in @breakery/ui yet (its design will likely
// land with session 4 holds/floor plan).

import { ChefHat } from 'lucide-react';

interface KdsEmptyStateProps {
  message: string;
}

export function KdsEmptyState({ message }: KdsEmptyStateProps) {
  return (
    <div className="col-span-full h-full grid place-items-center text-text-muted">
      <div className="text-center space-y-3">
        <ChefHat className="h-12 w-12 mx-auto opacity-50" aria-hidden />
        <p className="text-sm uppercase tracking-widest">{message}</p>
      </div>
    </div>
  );
}
