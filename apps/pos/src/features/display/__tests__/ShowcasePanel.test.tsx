// apps/pos/src/features/display/__tests__/ShowcasePanel.test.tsx
//
// ADR-023 déc. 1 — la vitrine du repos. Présentation arrêtée par le
// propriétaire : une grille de trois qui tourne par pages.

import { render, screen, act } from '@testing-library/react';
import { describe, expect, it, vi, afterEach } from 'vitest';

import { ShowcasePanel, SHOWCASE_PAGE_MS } from '../components/ShowcasePanel';
import type { ShowcaseProduct } from '../hooks/useShowcaseProducts';

function product(n: number): ShowcaseProduct {
  return {
    id: `p-${n}`,
    name: `Produit ${n}`,
    image_url: null,
    retail_price: n * 1000,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('ShowcasePanel', () => {
  it('montre trois produits par page', () => {
    render(<ShowcasePanel products={[1, 2, 3, 4, 5].map(product)} />);

    expect(screen.getAllByTestId('cd-showcase-card')).toHaveLength(3);
    expect(screen.getByTestId('cd-showcase-panel')).toHaveAttribute('data-page-count', '2');
  });

  it('tourne vers la page suivante après la cadence, puis revient au début', () => {
    vi.useFakeTimers();
    render(<ShowcasePanel products={[1, 2, 3, 4].map(product)} />);

    expect(screen.getAllByTestId('cd-showcase-name').map((n) => n.textContent)).toEqual([
      'Produit 1',
      'Produit 2',
      'Produit 3',
    ]);

    act(() => {
      vi.advanceTimersByTime(SHOWCASE_PAGE_MS);
    });
    // Page incomplète : les cartes restantes ne s'étirent pas pour combler.
    expect(screen.getAllByTestId('cd-showcase-name').map((n) => n.textContent)).toEqual([
      'Produit 4',
    ]);

    act(() => {
      vi.advanceTimersByTime(SHOWCASE_PAGE_MS);
    });
    expect(screen.getAllByTestId('cd-showcase-name')[0]).toHaveTextContent('Produit 1');
  });

  it('ne tourne pas — et n’affiche pas d’indicateur — sous quatre produits', () => {
    vi.useFakeTimers();
    render(<ShowcasePanel products={[1, 2, 3].map(product)} />);

    expect(screen.queryAllByTestId('cd-showcase-dot')).toHaveLength(0);

    act(() => {
      vi.advanceTimersByTime(SHOWCASE_PAGE_MS * 3);
    });
    expect(screen.getAllByTestId('cd-showcase-name').map((n) => n.textContent)).toEqual([
      'Produit 1',
      'Produit 2',
      'Produit 3',
    ]);
  });

  it('retombe sur le monogramme quand le produit n’a pas de photo', () => {
    // La vignette est décorative (`aria-hidden`) : elle ne doit rien annoncer,
    // le nom du produit porte déjà l'information. On la constate donc dans le
    // DOM, pas dans l'arbre accessible.
    const { container } = render(<ShowcasePanel products={[product(1)]} />);

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[aria-hidden="true"] svg')).not.toBeNull();
  });

  it('affiche la photo du produit quand il en a une', () => {
    const { container } = render(
      <ShowcasePanel products={[{ ...product(1), image_url: '/croissant.jpg' }]} />,
    );

    expect(container.querySelector('img')).toHaveAttribute('src', '/croissant.jpg');
  });
});
