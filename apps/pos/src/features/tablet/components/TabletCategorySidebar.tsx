// apps/pos/src/features/tablet/components/TabletCategorySidebar.tsx
//
// LOT 6 (POS P0 hardening, audit 2026-06-25) — tablet category rail.
//
// The cashier CategorySidebar is a narrow 80px icon rail with 10px labels —
// hard to read and hit on a tablet. This rail is ≥104px wide with text-xs
// labels and taller (min-h-16) targets, plus a left gold accent bar on the
// active category for at-a-glance orientation.

import { Star, Package, Coffee, Croissant, Sandwich, Wheat } from 'lucide-react';
import { cn } from '@breakery/ui';
import type { LucideProps } from 'lucide-react';
import type { ForwardRefExoticComponent, JSX, RefAttributes } from 'react';
import { useCategories } from '@/features/products/hooks/useCategories';

type IconComponent = ForwardRefExoticComponent<Omit<LucideProps, 'ref'> & RefAttributes<SVGSVGElement>>;

const ICONS: Record<string, IconComponent> = {
  beverage: Coffee,
  bread: Wheat,
  pastry: Croissant,
  sandwiches: Sandwich,
};

export interface TabletCategorySidebarProps {
  selectedSlug: string | null;
  onSelect: (slug: string) => void;
}

function Tile({
  active,
  onSelect,
  slug,
  label,
  Icon,
}: {
  active: boolean;
  onSelect: (slug: string) => void;
  slug: string;
  label: string;
  Icon: IconComponent;
}): JSX.Element {
  return (
    <button
      onClick={() => onSelect(slug)}
      className={cn(
        'relative w-full min-h-16 px-2 py-3 flex flex-col items-center justify-center gap-1.5 rounded-md',
        'text-xs uppercase tracking-wide font-semibold text-center leading-tight',
        'transition-colors duration-fast ease-motion-out',
        active
          ? 'bg-gold-soft text-gold'
          : 'text-text-secondary hover:text-text-primary hover:bg-bg-input',
      )}
    >
      {/* Left accent bar — category tint on the active item. */}
      {active && <span aria-hidden className="absolute left-0 top-2 bottom-2 w-1 rounded-r bg-gold" />}
      <Icon className="h-6 w-6" aria-hidden />
      <span className="line-clamp-2">{label}</span>
    </button>
  );
}

export function TabletCategorySidebar({ selectedSlug, onSelect }: TabletCategorySidebarProps): JSX.Element {
  const { data: categories = [] } = useCategories();
  return (
    <aside className="w-[104px] shrink-0 bg-bg-elevated border-r border-border-subtle flex flex-col items-stretch p-2 gap-1 overflow-y-auto">
      <Tile
        active={selectedSlug === 'favorites'}
        onSelect={onSelect}
        slug="favorites"
        label="Favorites"
        Icon={Star}
      />
      {categories.map((cat) => (
        <Tile
          key={cat.id}
          active={selectedSlug === cat.slug}
          onSelect={onSelect}
          slug={cat.slug}
          label={cat.name}
          Icon={ICONS[cat.slug] ?? Package}
        />
      ))}
    </aside>
  );
}
