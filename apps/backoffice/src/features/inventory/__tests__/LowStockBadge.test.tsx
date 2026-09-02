// apps/backoffice/src/features/inventory/__tests__/LowStockBadge.test.tsx
//
// Critique 2026-08-31 (P2) — la pastille rendait « LOW STOCK » aussi bien pour
// un produit à 0 que pour un produit à -1, alors que la bande de compteurs de
// la même page les compte séparément. Ce test fige les TROIS états et, tout
// aussi important, les deux cas où la pastille ne doit rien rendre : la garde
// d'entrée n'a pas bougé, aucun produit ne gagne une pastille qu'il n'avait pas.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LowStockBadge } from '../components/LowStockBadge.js';

describe('LowStockBadge', () => {
  it('names the three states apart', () => {
    const cases = [
      // stock, seuil, libellé attendu
      [-1, 5, 'Negative'],
      [0,  5, 'Out of stock'],
      [2,  5, 'Low stock'],
    ] as const;

    for (const [currentStock, minStockThreshold, label] of cases) {
      const { unmount } = render(
        <LowStockBadge currentStock={currentStock} minStockThreshold={minStockThreshold} />,
      );
      expect(screen.getByText(label)).toBeInTheDocument();
      unmount();
    }
  });

  it('renders nothing when the product is at or above its threshold', () => {
    const { container } = render(<LowStockBadge currentStock={5} minStockThreshold={5} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when no threshold is configured — even at zero stock', () => {
    // Le seuil à 0 sert aujourd'hui de proxy « non suivi ». Sans lui, un produit
    // à 0 gagnerait une pastille qu'il n'a jamais eue : c'est exactement le
    // changement de comportement que ce lot refuse.
    const { container } = render(<LowStockBadge currentStock={0} minStockThreshold={0} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('separates the danger states from the warning state by tone', () => {
    const { container: negative } = render(
      <LowStockBadge currentStock={-1} minStockThreshold={5} />,
    );
    const { container: low } = render(
      <LowStockBadge currentStock={2} minStockThreshold={5} />,
    );
    // `destructive` et `warning` sont les variantes tonales du primitif Badge ;
    // on vérifie qu'elles DIFFÈRENT, pas la valeur exacte des classes.
    expect(negative.firstElementChild?.className)
      .not.toBe(low.firstElementChild?.className);
  });
});
