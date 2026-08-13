// apps/pos/src/features/products/CategoryNav.tsx
//
// POS category rail. Each category renders as a square-ish tile with its own
// translucent tint (fill + border) and accent (icon + label + active bar),
// driven by `categoryStyle()` resolving a `cat-*` design-system token and
// `CAT_TOKEN_CLASSES` supplying the literal Tailwind classes for it (see
// categoryTints.ts — the `cat-*` family is the only token set where alpha
// modifiers work).
//
// - Width 104px, hidden scrollbar (`scrollbar-none`).
// - Active tile: stronger tint + a left accent bar (`aria-current="page"`).
// - Favorites / Combos are pinned virtual categories; the rest come from the DB
//   (ordered by sort_order via `useCategories`).

import { Settings } from 'lucide-react';
import type { JSX } from 'react';
import { cn } from '@breakery/ui';
import { useCategories } from './hooks/useCategories';
import { categoryStyle, categoryMonogram, CAT_TOKEN_CLASSES } from './categoryTints';

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
      className="w-[116px] shrink-0 bg-bg-elevated border-r border-border-subtle flex flex-col max-md:w-full max-md:border-r-0 max-md:border-b max-md:flex-row"
    >
      {/* Below md the vertical rail becomes a horizontal swipe strip. */}
      <nav className="flex-1 overflow-y-auto scrollbar-none p-2 max-md:overflow-y-hidden max-md:overflow-x-auto max-md:flex max-md:items-stretch max-md:gap-1.5">
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
        <div className="border-t border-border-subtle py-3 flex justify-center max-md:hidden">
          <button
            type="button"
            onClick={onOpenSettings}
            className="h-11 w-11 inline-flex items-center justify-center rounded-md text-text-muted hover:text-text-primary focus:outline focus:outline-2 focus:outline-gold focus:outline-offset-2 transition-colors motion-reduce:transition-none"
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
  const tone = CAT_TOKEN_CLASSES[style.token];

  return (
    <button
      type="button"
      onClick={() => onSelect(slug)}
      aria-current={active ? 'page' : undefined}
      data-testid={`category-nav-item-${slug}`}
      className={cn(
        'relative w-full mb-1.5 py-2.5 px-1 rounded-lg border',
        'max-md:w-[92px] max-md:shrink-0 max-md:mb-0',
        'flex flex-col items-center justify-center gap-1',
        'text-xs uppercase tracking-wide font-semibold leading-[1.15]',
        tone.text,
        // Hover only applies while the tile is inactive (matches the former
        // `.cat-btn:hover:not([aria-current='page'])` rule).
        active ? tone.active : cn(tone.idle, tone.hover),
        'transition-all duration-fast ease-motion-out active:scale-95 motion-reduce:transition-none motion-reduce:active:scale-100',
        'focus:outline focus:outline-2 focus:outline-gold focus:outline-offset-[-2px]',
      )}
    >
      {active && (
        <span
          aria-hidden
          className={cn('absolute left-0 top-2.5 bottom-2.5 w-[3px] rounded-r', tone.accentBar)}
        />
      )}
      {/* Matched category → its glyph. Unmatched → a coloured monogram (the
          initial), so compound DB names stay visually distinct instead of all
          collapsing to a single grid icon. */}
      {Icon ? (
        <Icon className="h-6 w-6" strokeWidth={1.8} aria-hidden />
      ) : (
        <span
          aria-hidden
          className={cn('h-6 w-6 grid place-items-center rounded-md text-sm font-bold leading-none', tone.text, tone.monogramBg)}
        >
          {categoryMonogram(label)}
        </span>
      )}
      <span className="text-center break-words max-w-[100px] line-clamp-2">{label}</span>
    </button>
  );
}
