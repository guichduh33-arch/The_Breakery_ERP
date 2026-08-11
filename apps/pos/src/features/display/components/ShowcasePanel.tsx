// apps/pos/src/features/display/components/ShowcasePanel.tsx
//
// ADR-023 déc. 1 — au repos, l'écran client est commercial, pas opérationnel.
//
// Moitié droite de l'écran client entre deux commandes : trois produits par
// page, qui tournent. La moitié gauche reste la marque, et la vitrine ne s'y
// étend pas (ADR-023 conséquence 4, composition arrêtée le 2026-07-07).
//
// Présentation arrêtée par le propriétaire (2026-08-11) : une grille de trois
// qui tourne par pages, jamais un produit unique en rotation. Sous quatre
// produits il n'y a qu'une page, et rien ne bouge — une rotation sur place
// serait un clignotement gratuit sur un écran que personne ne regarde en
// continu.
//
// La cadence est une CONSTANTE de code, pas un réglage : aucun ADR n'en
// demande un, et personne n'aurait d'écran pour l'éditer.
//
// Composant PRÉSENTATIONNEL — la sélection et la résolution des prix vivent
// dans `useShowcaseProducts`. Il ne reçoit jamais un prix saisi à la main
// (ADR-023 déc. 2) : `retail_price` vient du catalogue.

import type { JSX } from 'react';
import { useEffect, useState } from 'react';

import { BrandMark, Currency, SectionLabel } from '@breakery/ui';

import type { ShowcaseProduct } from '../hooks/useShowcaseProducts';

/** Trois produits par page — la grille arrêtée par le propriétaire. */
export const SHOWCASE_PAGE_SIZE = 3;

/** Durée d'affichage d'une page. Assez long pour être lu à 1,5 m. */
export const SHOWCASE_PAGE_MS = 8_000;

export interface ShowcasePanelProps {
  /** Produits déjà résolus contre le catalogue, dans l'ordre de la sélection. */
  products: ShowcaseProduct[];
  /** Cadence de rotation. Exposée pour les tests, pas pour la configuration. */
  pageMs?: number;
}

interface ShowcaseCardProps {
  product: ShowcaseProduct;
}

/** Une carte produit : photo (ou monogramme), nom, prix catalogue. */
function ShowcaseCard({ product }: ShowcaseCardProps): JSX.Element {
  return (
    <li
      className="min-h-0 flex items-center gap-6 rounded-3xl border border-border-subtle bg-bg-elevated px-6 py-5"
      data-testid="cd-showcase-card"
      data-product-id={product.id}
    >
      <div
        className="flex-none w-40 h-40 rounded-2xl overflow-hidden border border-border-subtle bg-bg-base flex items-center justify-center"
        aria-hidden="true"
      >
        {product.image_url ? (
          <img
            src={product.image_url}
            alt=""
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <BrandMark size="lg" />
        )}
      </div>

      <div className="flex-1 min-w-0 flex flex-col gap-3">
        <h3
          className="font-display text-4xl text-text-primary truncate"
          data-testid="cd-showcase-name"
        >
          {product.name}
        </h3>
        <span data-testid="cd-showcase-price">
          <Currency amount={product.retail_price} emphasis="gold" className="text-3xl" />
        </span>
      </div>
    </li>
  );
}

/**
 * Vitrine de l'état de repos. Rend la page courante et avance seule quand la
 * sélection dépasse une page.
 */
export function ShowcasePanel({
  products,
  pageMs = SHOWCASE_PAGE_MS,
}: ShowcasePanelProps): JSX.Element {
  const pageCount = Math.max(1, Math.ceil(products.length / SHOWCASE_PAGE_SIZE));
  const [page, setPage] = useState(0);

  // Une seule page → aucun timer. Le modulo suit `pageCount` : si la sélection
  // rétrécit pendant que l'écran tourne, la page courante reste dans les bornes.
  useEffect(() => {
    setPage(0);
    if (pageCount <= 1) return;
    const id = setInterval(() => {
      setPage((prev) => (prev + 1) % pageCount);
    }, pageMs);
    return () => clearInterval(id);
  }, [pageCount, pageMs]);

  const start = (page % pageCount) * SHOWCASE_PAGE_SIZE;
  const visible = products.slice(start, start + SHOWCASE_PAGE_SIZE);

  return (
    <section
      className="h-full min-h-0 flex flex-col"
      data-testid="cd-showcase-panel"
      data-page-count={pageCount}
      data-page={page}
      aria-label="Today at the counter"
    >
      <div className="mb-4 flex items-baseline justify-between gap-6">
        <SectionLabel size="sm">Today at the counter</SectionLabel>
        {pageCount > 1 && (
          <span className="flex items-center gap-2" aria-hidden="true">
            {Array.from({ length: pageCount }, (_, idx) => (
              <span
                key={`showcase-dot-${idx}`}
                className={
                  'h-1.5 w-1.5 rounded-full transition-base ' +
                  (idx === page ? 'bg-gold' : 'bg-border-subtle')
                }
                data-testid="cd-showcase-dot"
                data-active={idx === page}
              />
            ))}
          </span>
        )}
      </div>

      {/* Trois rangées fixes : une page incomplète ne fait pas enfler les
          cartes restantes, la composition ne bouge pas d'une page à l'autre. */}
      <ul
        className="flex-1 min-h-0 grid grid-rows-3 gap-4"
        data-testid="cd-showcase-list"
      >
        {visible.map((product) => (
          <ShowcaseCard key={product.id} product={product} />
        ))}
      </ul>
    </section>
  );
}
