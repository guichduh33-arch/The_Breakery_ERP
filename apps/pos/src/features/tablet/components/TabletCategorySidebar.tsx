// apps/pos/src/features/tablet/components/TabletCategorySidebar.tsx
//
// LOT 6 (POS P0 hardening, audit 2026-06-25) — tablet category rail.
// Critique 2026-08-23 (P1) — le rail portait sa PROPRE map d'icônes
// (beverage/bread/pastry/sandwiches) qui ne matchait aucun slug du catalogue
// réel : les 21 catégories rendaient le même cube `Package` gris. Il consomme
// désormais le système du comptoir — `categoryStyle()` (alias + sous-chaînes +
// repli déterministe), monogramme coloré quand aucun glyphe ne matche, et les
// douze teintes `cat-*` via CAT_TOKEN_CLASSES (la seule famille de tokens où
// l'alpha fonctionne). Une seule source d'identité visuelle pour les deux rails.
//
// Ergonomie tablette conservée : rail ≥104px, labels text-xs, cibles min-h-16.

import { LayoutGrid, Star } from 'lucide-react';
import { cn } from '@breakery/ui';
import type { JSX } from 'react';
import { useCategories } from '@/features/products/hooks/useCategories';
import {
  categoryStyle,
  categoryMonogram,
  CAT_TOKEN_CLASSES,
} from '@/features/products/categoryTints';

export interface TabletCategorySidebarProps {
  selectedSlug: string | null;
  /** `null` = tout le catalogue (tuile « All »). */
  onSelect: (slug: string | null) => void;
}

// Classes structurelles partagées par toutes les tuiles du rail — la tuile
// « All » ne porte pas de teinte cat-* mais doit rester le même objet à l'œil.
const TILE_BASE = cn(
  'relative w-full min-h-16 px-2 py-3 flex flex-col items-center justify-center gap-1.5 rounded-md border',
  'text-xs uppercase tracking-wide font-semibold text-center leading-tight',
  'transition-colors duration-fast ease-motion-out',
  // Critique 2026-08-24 (a11y) — le rail entier était sans focus visible.
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold focus-visible:outline-offset-2',
);

function Tile({
  active,
  onSelect,
  slug,
  label,
}: {
  active: boolean;
  onSelect: (slug: string) => void;
  slug: string;
  label: string;
}): JSX.Element {
  const style = categoryStyle(slug, label);
  const Icon = slug === 'favorites' ? Star : style.Icon;
  const tone = CAT_TOKEN_CLASSES[style.token];

  return (
    <button
      onClick={() => onSelect(slug)}
      aria-current={active ? 'page' : undefined}
      className={cn(
        TILE_BASE,
        tone.text,
        // Le survol ne s'applique qu'à la tuile inactive (même règle que le
        // comptoir) — sur tablette il ne sert que le stylet/trackpad, il ne
        // coûte rien au doigt.
        active ? tone.active : cn(tone.idle, tone.hover),
      )}
    >
      {/* Left accent bar — category tint on the active item. */}
      {active && (
        <span aria-hidden className={cn('absolute left-0 top-2 bottom-2 w-1 rounded-r', tone.accentBar)} />
      )}
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
      <span className="line-clamp-2">{label}</span>
    </button>
  );
}

export function TabletCategorySidebar({ selectedSlug, onSelect }: TabletCategorySidebarProps): JSX.Element {
  const { data: categories = [] } = useCategories();
  // Contract: iPad ≥ 768px only — no phone-width fallback is planned. The
  // tablet surface is documented iPad-first (PRODUCT.md); this fixed rail
  // width is intentional, not an oversight.
  return (
    <aside
      aria-label="Product categories"
      className="w-[104px] shrink-0 bg-bg-elevated border-r border-border-subtle flex flex-col items-stretch p-2 gap-1 overflow-y-auto"
    >
      {/* Critique 2026-08-24 (P2) — l'état « tout le catalogue » (slug null)
          était inatteignable une fois une catégorie touchée, et le rail ne le
          représentait pas. Tuile neutre : l'or marque la sélection, pas une
          teinte cat-* (ce n'est pas une famille de produits). */}
      <button
        onClick={() => onSelect(null)}
        aria-current={selectedSlug === null ? 'page' : undefined}
        className={cn(
          TILE_BASE,
          selectedSlug === null
            ? 'bg-gold-soft text-gold border-gold-soft'
            : 'border-transparent text-text-secondary hover:text-text-primary hover:bg-bg-overlay',
        )}
      >
        {selectedSlug === null && (
          <span aria-hidden className="absolute left-0 top-2 bottom-2 w-1 rounded-r bg-gold" />
        )}
        <LayoutGrid className="h-6 w-6" strokeWidth={1.8} aria-hidden />
        <span className="line-clamp-2">All</span>
      </button>
      <Tile
        active={selectedSlug === 'favorites'}
        onSelect={onSelect}
        slug="favorites"
        label="Favorites"
      />
      {categories.map((cat) => (
        <Tile
          key={cat.id}
          active={selectedSlug === cat.slug}
          onSelect={onSelect}
          slug={cat.slug}
          label={cat.name}
        />
      ))}
    </aside>
  );
}
