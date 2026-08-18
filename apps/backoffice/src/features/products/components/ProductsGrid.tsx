// apps/backoffice/src/features/products/components/ProductsGrid.tsx
//
// Session 14 / Phase 4.B — Card grid view of the catalog.
// Used when the user toggles to "grid" view from the filter strip.
//
// La grille recevait tout le résultat filtré et rendait ses 373 cartes d'un
// coup, quand la table voisine paginait à 15 : basculer de vue faisait passer
// le document de 911 à 8 236 nœuds. Elle prend désormais le MÊME contrat que
// `ProductsTable` — `page`, `pageSize`, `onPage`, `onPageSize` — et le même
// pied, pour qu'un bouton de vue ne change plus que l'apparence.

import { ImageOff } from 'lucide-react';
import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Card, CardContent, Currency } from '@breakery/ui';
import { CategoryChip } from './CategoryChip.js';
import { ProductTypeBadge } from './ProductTypeBadge.js';
import {
  LIST_PAGE_SIZE_DEFAULT,
  ListPagination,
  pageSlice,
} from '@/components/ListPagination.js';
import { FOCUS_RING } from '@/components/focusRing.js';
import { classifyProduct, type ProductRow } from '../types.js';
import { formatCurrency } from '@breakery/utils';

interface Props {
  rows: readonly ProductRow[];
  /** Session 27c — set of product ids that are parents (i.e. have variants). */
  parentIds?: ReadonlySet<string>;
  /** Page courante, 1-based — même contrat que ProductsTable. */
  page?: number;
  onPage?: (next: number) => void;
  pageSize?: number;
  onPageSize?: (next: number) => void;
}

export function ProductsGrid({
  rows,
  parentIds,
  page = 1,
  onPage,
  pageSize = LIST_PAGE_SIZE_DEFAULT,
  onPageSize,
}: Props): JSX.Element {
  const { pageRows } = pageSlice(rows, page, pageSize);

  return (
    <div className="space-y-3.5" data-testid="products-grid">
    {rows.length === 0 ? (
      <div className="rounded-lg border border-border-subtle bg-bg-elevated py-16 text-center">
        {/* `<h3>` sous le `<h1>` de PageHeader, sans aucun `<h2>` sur la page :
            le niveau sautait de 1 à 3 (WCAG 1.3.1). Même défaut que l'état vide
            des dépenses. */}
        <h2 className="text-xl font-semibold text-text-primary">No products to show</h2>
        <p className="mt-1 text-sm text-text-secondary">Try adjusting your filters.</p>
      </div>
    ) : (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {pageRows.map((r) => (
        // `role="button"` était un rôle à ENFANTS PRÉSENTATIONNELS (ARIA 1.2
        // § 5.2.7) : posé sur la carte, il effaçait la sémantique du titre, du
        // prix, du SKU, de la puce de catégorie et des badges de variante, et
        // l'`aria-label` écrasait par-dessus le nom calculé. Un lecteur d'écran
        // ne recevait plus qu'un nœud — « Open Croissant, bouton » — quand la
        // vue TABLE de la même page expose tout (WCAG 1.3.1 et 4.1.2). Le lien
        // n'a pas ce défaut : `role="link"` garde ses enfants, et il apporte au
        // passage le clavier, le clic-milieu et le menu contextuel sans aucun
        // `onKeyDown` écrit à la main.
        <Link
          key={r.id}
          to={`/backoffice/products/${r.id}`}
          className={`block rounded-lg ${FOCUS_RING}`}
        >
          <Card
            variant="default"
            // `hover:border-border-strong` — Border-Before-Shadow : le survol
            // se dit par la bordure. L'ombre `shadow-sm` du variant `default`
            // est celle que DESIGN.md § Cartes autorise « en usage général » ;
            // c'est le dashboard, et lui seul, qui la retire.
            className="group h-full overflow-hidden border-border-subtle transition-colors duration-base hover:border-border-strong"
          >
          <div className="relative aspect-[4/3] w-full overflow-hidden bg-bg-overlay">
            {r.image_url === null ? (
              <div className="flex h-full w-full items-center justify-center text-text-muted">
                <ImageOff className="h-8 w-8" aria-hidden />
              </div>
            ) : (
              <img
                src={r.image_url}
                alt={r.name}
                loading="lazy"
                className="h-full w-full object-cover transition-transform duration-base group-hover:scale-[1.02]"
              />
            )}
            {!r.is_active && (
              <span className="absolute left-2 top-2 rounded-sm bg-red-soft px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-red">
                Inactive
              </span>
            )}
          </div>
          <CardContent className="space-y-2 p-4">
            <div className="flex items-start justify-between gap-2">
              {/* `<h2>` et non `<h3>` — même motif que l'état vide juste
                  au-dessus, et que `ComboCard` : la page n'a que le `<h1>` de
                  `PageHeader`, le niveau sautait de 1 à 3 (WCAG 1.3.1). L'état
                  VIDE avait été corrigé sans que son voisin peuplé le soit. */}
              <h2 className="line-clamp-1 text-base font-semibold text-text-primary">{r.name}</h2>
              <Currency format={formatCurrency} amount={r.retail_price} emphasis="gold" />
            </div>
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="font-mono text-text-muted">{r.sku}</span>
              {r.category_name !== null && <CategoryChip name={r.category_name} />}
            </div>
            <div className="flex flex-wrap items-center gap-1 pt-1">
              <ProductTypeBadge type={classifyProduct(r)} />
              {r.parent_product_id !== null && (
                <Badge variant="outline" data-testid="badge-variant">Variant</Badge>
              )}
              {parentIds !== undefined && parentIds.has(r.id) && (
                <Badge variant="outline" data-testid="badge-parent">Parent</Badge>
              )}
            </div>
          </CardContent>
          </Card>
        </Link>
      ))}
    </div>
    )}
      {/* Le pied se rend MÊME quand la grille est vide — DESIGN.md § Tableaux :
          « 0 sur 318 » est une information, pas un vide. Un `return` anticipé
          sur `rows.length === 0` sortait avant lui, quand la vue table de la
          même page le rend inconditionnellement. */}
      <ListPagination
        total={rows.length}
        page={page}
        pageSize={pageSize}
        {...(onPage !== undefined ? { onPage } : {})}
        {...(onPageSize !== undefined ? { onPageSize } : {})}
      />
    </div>
  );
}
