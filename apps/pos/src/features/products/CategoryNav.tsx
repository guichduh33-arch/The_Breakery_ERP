// apps/pos/src/features/products/CategoryNav.tsx
//
// Session 14 — Phase 2.A — Vertical category navigation sidebar for POS.
//
// Visual reference: docs/Design/caissapp/01-grid-bagel-empty-cart-dine-in.jpg
// + 03-grid-coffee-empty-cart.jpg.
//
// Layout (per ref):
// - ~80px wide, full-height column
// - Pinned at top: FAVORITES (star icon), COMBOS (grid icon)
// - Then dynamic categories from DB ordered by sort_order
// - Each item: vertical uppercase label (text-xs, tracking-widest, font-semibold)
// - Active state: gold text + small gold left-edge accent bar
// - Hover state: text-primary
// - Bottom: COG icon → settings (calls onOpenSettings if provided)
//
// Replaces the prior CategorySidebar which used an icon-on-top layout.
// Kept side-by-side so the migration is safe; once Pos.tsx is wired,
// CategorySidebar.tsx can be removed in a follow-up commit.

import { Star, LayoutGrid, Settings } from 'lucide-react';
import type { JSX } from 'react';
import { cn } from '@breakery/ui';
import { useCategories } from './hooks/useCategories';

export interface CategoryNavProps {
  selectedSlug: string | null;
  onSelect: (slug: string) => void;
  /** Optional click handler for the bottom cog icon (POS Settings). */
  onOpenSettings?: () => void;
}

export function CategoryNav({
  selectedSlug,
  onSelect,
  onOpenSettings,
}: CategoryNavProps): JSX.Element {
  const { data: categories = [] } = useCategories();

  return (
    <aside
      aria-label="Product categories"
      className="w-20 shrink-0 bg-bg-elevated border-r border-border-subtle flex flex-col"
    >
      <nav className="flex-1 overflow-y-auto py-2">
        <CategoryItem
          slug="favorites"
          label="Favorites"
          active={selectedSlug === 'favorites'}
          onSelect={onSelect}
          icon={<Star className="h-4 w-4" aria-hidden />}
        />
        <CategoryItem
          slug="combos"
          label="Combos"
          active={selectedSlug === 'combos'}
          onSelect={onSelect}
          icon={<LayoutGrid className="h-4 w-4" aria-hidden />}
        />
        {categories.map((cat) => (
          <CategoryItem
            key={cat.id}
            slug={cat.slug}
            label={cat.name}
            active={selectedSlug === cat.slug}
            onSelect={onSelect}
          />
        ))}
      </nav>
      {onOpenSettings && (
        <div className="border-t border-border-subtle py-3 flex justify-center">
          <button
            type="button"
            onClick={onOpenSettings}
            className="h-10 w-10 inline-flex items-center justify-center rounded-md text-text-muted hover:text-text-primary focus:outline focus:outline-2 focus:outline-gold focus:outline-offset-2 transition-colors motion-reduce:transition-none"
            aria-label="POS settings"
          >
            <Settings className="h-5 w-5" aria-hidden />
          </button>
        </div>
      )}
    </aside>
  );
}

interface CategoryItemProps {
  slug: string;
  label: string;
  active: boolean;
  onSelect: (slug: string) => void;
  /** Optional inline icon (Favorites/Combos). */
  icon?: JSX.Element;
}

function CategoryItem({ slug, label, active, onSelect, icon }: CategoryItemProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={() => onSelect(slug)}
      aria-current={active ? 'page' : undefined}
      data-testid={`category-nav-item-${slug}`}
      className={cn(
        'relative w-full py-3 px-1 flex flex-col items-center justify-center gap-1.5',
        'text-[10px] uppercase tracking-widest font-semibold',
        'transition-colors motion-reduce:transition-none',
        'focus:outline focus:outline-2 focus:outline-gold focus:outline-offset-[-2px]',
        active
          ? 'text-gold'
          : 'text-text-secondary hover:text-text-primary',
      )}
    >
      {active && (
        <span
          aria-hidden
          className="absolute left-0 top-2 bottom-2 w-[3px] bg-gold rounded-r-full"
        />
      )}
      {icon ?? null}
      <span className="leading-tight text-center break-words max-w-[68px]">{label}</span>
    </button>
  );
}
