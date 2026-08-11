// apps/backoffice/src/features/inventory/__tests__/StockRowActions.test.tsx
//
// Le menu de ligne annonce `role="menu"` / `role="menuitem"`. Ces tests
// vérifient que le contrat est TENU — il ne l'était pas : le focus ne rentrait
// pas dans le menu et les flèches ne faisaient rien, il fallait Tab, Tab, Tab.
// Un contrat ARIA annoncé et non tenu promet une navigation qui n'existe pas.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { StockRowActions } from '../components/StockRowActions.js';
import type { StockLevelRow } from '../hooks/useStockLevels.js';

const ROW: StockLevelRow = {
  product_id: 'p-1',
  sku: 'BEV-AMER',
  name: 'Americano',
  category_id: null,
  category_name: null,
  current_stock: 5,
  min_stock_threshold: 10,
  track_inventory: true,
  unit: 'pcs',
  stock_value: 25_000,
  last_movement_at: null,
};

function renderActions(perms: { canAdjust: boolean; canWaste: boolean }) {
  return render(
    <StockRowActions
      row={ROW}
      canAdjust={perms.canAdjust}
      canWaste={perms.canWaste}
      onView={vi.fn()}
      onAdjust={vi.fn()}
      onWaste={vi.fn()}
    />,
  );
}

function trigger(): HTMLElement {
  return screen.getByRole('button', { name: /Actions for Americano/i });
}

function items(): HTMLElement[] {
  return within(screen.getByRole('menu')).getAllByRole('menuitem');
}

describe('StockRowActions — contrat clavier du menu', () => {
  beforeEach(() => { cleanup(); });

  it('Flèche bas sur le déclencheur ouvre le menu ET y place le focus', () => {
    renderActions({ canAdjust: true, canWaste: true });
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' });

    const all = items();
    expect(all).toHaveLength(3);
    expect(all[0]).toHaveFocus();
  });

  it('Flèche haut sur le déclencheur ouvre sur le DERNIER élément', () => {
    renderActions({ canAdjust: true, canWaste: true });
    fireEvent.keyDown(trigger(), { key: 'ArrowUp' });

    const all = items();
    expect(all[all.length - 1]).toHaveFocus();
  });

  it('les flèches circulent et bouclent aux extrémités', () => {
    renderActions({ canAdjust: true, canWaste: true });
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' });
    const menu = screen.getByRole('menu');

    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(items()[1]).toHaveFocus();

    // Depuis le dernier, Flèche bas revient au premier.
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(items()[2]).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(items()[0]).toHaveFocus();

    // Et symétriquement vers le haut.
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(items()[2]).toHaveFocus();
  });

  it('Origine et Fin vont aux extrémités', () => {
    renderActions({ canAdjust: true, canWaste: true });
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' });
    const menu = screen.getByRole('menu');

    fireEvent.keyDown(menu, { key: 'End' });
    expect(items()[2]).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'Home' });
    expect(items()[0]).toHaveFocus();
  });

  it('Échap referme et rend le focus au déclencheur', () => {
    renderActions({ canAdjust: true, canWaste: true });
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger()).toHaveFocus();
  });

  it('Tab referme le menu au lieu de laisser tabuler dans une surface flottante', () => {
    renderActions({ canAdjust: true, canWaste: true });
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Tab' });

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('les permissions retirent des entrées sans casser la navigation', () => {
    renderActions({ canAdjust: false, canWaste: false });
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' });

    const all = items();
    expect(all).toHaveLength(1);
    expect(all[0]).toHaveTextContent(/View stock/i);
    // Une seule entrée : la flèche boucle sur elle-même sans sortir du menu.
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });
    expect(all[0]).toHaveFocus();
  });
});
