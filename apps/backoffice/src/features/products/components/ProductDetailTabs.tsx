// apps/backoffice/src/features/products/components/ProductDetailTabs.tsx
//
// Session 14 / Phase 4.B — Horizontal tab strip used inside the product
// detail page. Visually it sits below the page header. The selected tab gets
// a 2px gold underline.
//
// Harden — le motif ARIA était déclaré à moitié : `role="tablist"` et
// `role="tab"` promettent au lecteur d'écran un widget composite (une seule
// tabulation pour entrer, les flèches pour circuler) que le clavier ne tenait
// pas. Dix onglets restaient donc dans l'ordre de tabulation, et aucun ne
// désignait son panneau. On tient maintenant la promesse : tabindex glissant,
// ←/→/Home/End, et `aria-controls` vers le panneau que ProductDetailPage rend.

import { useRef, type JSX, type KeyboardEvent } from 'react';
import { cn } from '@breakery/ui';
import type { ProductDetailTab } from '../types.js';

interface Props {
  active: ProductDetailTab;
  onChange: (tab: ProductDetailTab) => void;
}

const TABS: readonly { id: ProductDetailTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'general',  label: 'General'  },
  { id: 'units',    label: 'Units'    },
  { id: 'recipe',   label: 'Recipe'   },
  { id: 'variants', label: 'Variants' },
  { id: 'modifiers', label: 'Modifiers' },
  { id: 'costing',  label: 'Costing'  },
  { id: 'purchase', label: 'Purchase' },
  { id: 'stations', label: 'Stations' },
  { id: 'history',  label: 'History'  },
];

/** Identifiants partagés avec le panneau — `aria-controls` et `aria-labelledby`
 *  doivent se répondre, sans quoi la relation onglet↔panneau n'existe pas. */
export function productTabId(tab: ProductDetailTab): string {
  return `product-tab-${tab}`;
}
export function productTabPanelId(tab: ProductDetailTab): string {
  return `product-tabpanel-${tab}`;
}

export function ProductDetailTabs({ active, onChange }: Props): JSX.Element {
  const refs = useRef<Map<ProductDetailTab, HTMLButtonElement>>(new Map());

  function focusTab(id: ProductDetailTab): void {
    onChange(id);
    // Le focus suit la sélection : c'est le modèle « automatic activation »
    // du pattern Tabs, celui qui convient quand changer d'onglet est gratuit.
    refs.current.get(id)?.focus();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLElement>): void {
    const idx = TABS.findIndex((t) => t.id === active);
    if (idx < 0) return;
    let next: number | null = null;
    switch (e.key) {
      case 'ArrowRight': next = (idx + 1) % TABS.length; break;
      case 'ArrowLeft':  next = (idx - 1 + TABS.length) % TABS.length; break;
      case 'Home':       next = 0; break;
      case 'End':        next = TABS.length - 1; break;
      default: return;
    }
    e.preventDefault();
    const target = TABS[next];
    if (target !== undefined) focusTab(target.id);
  }

  return (
    <div className="border-b border-border-subtle">
      <nav
        role="tablist"
        aria-label="Product detail sections"
        className="flex flex-wrap gap-x-6"
        onKeyDown={handleKeyDown}
      >
        {TABS.map((t) => {
          const selected = t.id === active;
          return (
            <button
              key={t.id}
              ref={(el) => {
                if (el === null) refs.current.delete(t.id);
                else refs.current.set(t.id, el);
              }}
              type="button"
              role="tab"
              id={productTabId(t.id)}
              aria-selected={selected}
              aria-controls={productTabPanelId(t.id)}
              // Tabindex glissant : une seule tabulation entre dans la barre,
              // les flèches circulent ensuite.
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(t.id)}
              className={cn(
                'relative -mb-px py-3 text-xs font-semibold uppercase tracking-widest transition-colors duration-fast',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold',
                selected
                  ? 'text-gold'
                  : 'text-text-muted hover:text-text-primary',
              )}
            >
              {t.label}
              {selected && (
                <span aria-hidden className="absolute inset-x-0 -bottom-px h-0.5 bg-gold" />
              )}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
