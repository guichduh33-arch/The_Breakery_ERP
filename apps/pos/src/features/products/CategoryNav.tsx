// apps/pos/src/features/products/CategoryNav.tsx
//
// POS category rail. Each category renders as a square-ish tile with its own
// translucent tint (fill + border) and accent (icon + label + active bar),
// driven by `categoryStyle()` and the `.cat-btn` component class in index.css.
//
// - Width 104px, hidden scrollbar (`scrollbar-none`).
// - Active tile: stronger tint + a left accent bar (`aria-current="page"`).
// - Favorites / Combos are pinned virtual categories; the rest come from the DB
//   (ordered by sort_order via `useCategories`).

import { Settings } from 'lucide-react';
import type { CSSProperties, JSX } from 'react';
import { cn } from '@breakery/ui';
import { useCategories } from './hooks/useCategories';
import { categoryStyle } from './categoryTints';

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
      className="w-[104px] shrink-0 bg-bg-elevated border-r border-border-subtle flex flex-col"
    >
      <nav className="flex-1 overflow-y-auto scrollbar-none p-2">
        <CategoryItem
          slug="favorites"
          label="Favorites"
          active={selectedSlug === 'favorites'}
          onSelect={onSelect}
        />
        <CategoryItem
          slug="combos"
          label="Combos"
          active={selectedSlug === 'combos'}
          onSelect={onSelect}
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
}

function CategoryItem({ slug, label, active, onSelect }: CategoryItemProps): JSX.Element {
  const style = categoryStyle(slug, label);
  const Icon = style.Icon;
  const cssVars = {
    '--cat-tint': style.tint,
    '--cat-accent': style.accent,
  } as CSSProperties;

  return (
    <button
      type="button"
      onClick={() => onSelect(slug)}
      aria-current={active ? 'page' : undefined}
      data-testid={`category-nav-item-${slug}`}
      style={cssVars}
      className={cn(
        'cat-btn relative w-full mb-1.5 py-3 px-1 rounded-lg',
        'flex flex-col items-center justify-center gap-1.5',
        'text-[10px] uppercase tracking-wide font-semibold',
        'transition-all duration-fast ease-motion-out active:scale-95 motion-reduce:transition-none motion-reduce:active:scale-100',
        'focus:outline focus:outline-2 focus:outline-gold focus:outline-offset-[-2px]',
      )}
    >
      {active && (
        <span
          aria-hidden
          className="absolute left-0 top-2.5 bottom-2.5 w-[3px] rounded-r"
          style={{ backgroundColor: style.accent }}
        />
      )}
      <Icon className="h-6 w-6" strokeWidth={1.8} aria-hidden />
      <span className="leading-tight text-center break-words max-w-[80px]">{label}</span>
    </button>
  );
}
