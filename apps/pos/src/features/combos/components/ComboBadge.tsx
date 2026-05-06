// apps/pos/src/features/combos/components/ComboBadge.tsx
import { cn } from '@breakery/ui';

interface ComboBadgeProps {
  className?: string;
}

export function ComboBadge({ className }: ComboBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide',
        'bg-purple-500/20 text-purple-400',
        className,
      )}
    >
      COMBO
    </span>
  );
}
