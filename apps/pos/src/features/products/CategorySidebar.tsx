// apps/pos/src/features/products/CategorySidebar.tsx
import { Star, Package, Coffee, Croissant, Sandwich, Wheat } from 'lucide-react';
import { useCategories } from './hooks/useCategories';
import { cn } from '@breakery/ui';
import type { LucideProps } from 'lucide-react';
import type { ForwardRefExoticComponent, RefAttributes } from 'react';

type IconComponent = ForwardRefExoticComponent<Omit<LucideProps, 'ref'> & RefAttributes<SVGSVGElement>>;

const ICONS: Record<string, IconComponent> = {
  beverage: Coffee,
  bread: Wheat,
  pastry: Croissant,
  sandwiches: Sandwich,
};

export interface CategorySidebarProps {
  selectedSlug: string | null;
  onSelect: (slug: string) => void;
}

export function CategorySidebar({ selectedSlug, onSelect }: CategorySidebarProps) {
  const { data: categories = [] } = useCategories();
  return (
    <aside className="w-20 bg-bg-elevated border-r border-border-subtle flex flex-col items-center py-4 gap-1 overflow-y-auto">
      <button
        onClick={() => onSelect('favorites')}
        className={cn(
          'w-16 py-3 flex flex-col items-center gap-1 rounded-md text-[10px] uppercase tracking-wide font-semibold',
          selectedSlug === 'favorites' ? 'bg-gold-soft text-gold' : 'text-text-secondary hover:text-text-primary',
        )}
      >
        <Star className="h-5 w-5" aria-hidden />
        Favorites
      </button>
      {categories.map((cat) => {
        const Icon = ICONS[cat.slug] ?? Package;
        const active = selectedSlug === cat.slug;
        return (
          <button
            key={cat.id}
            onClick={() => onSelect(cat.slug)}
            className={cn(
              'w-16 py-3 flex flex-col items-center gap-1 rounded-md text-[10px] uppercase tracking-wide font-semibold',
              active ? 'bg-gold-soft text-gold' : 'text-text-secondary hover:text-text-primary',
            )}
          >
            <Icon className="h-5 w-5" aria-hidden />
            {cat.name}
          </button>
        );
      })}
    </aside>
  );
}
