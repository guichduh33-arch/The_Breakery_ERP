// apps/backoffice/src/components/__tests__/RowActionsMenu.test.tsx
//
// Ce que ces tests verrouillent, et pourquoi.
//
// LE DESTRUCTEUR NE TOUCHE PAS LE BÉNIN. Le menu existe pour supprimer
// l'adjacence entre une cible destructrice et une cible bénigne — et pourtant
// `View details` et `Void order` se suivaient à 34 px l'un de l'autre sans
// filet (critique BO du 2026-09-04). Un séparateur précède la première entrée
// `danger` qui suit une entrée bénigne. Il n'est PAS une option : le contrat
// clavier de `StockRowActions.test` compte les `menuitem`, et ce compte ne
// bouge pas.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { RowActionsMenu, type RowActionEntry } from '@/components/RowActionsMenu.js';

function open(entries: RowActionEntry[]): HTMLElement {
  render(<RowActionsMenu subject="ORD-1" entries={entries} />);
  fireEvent.click(screen.getByRole('button', { name: /Actions for ORD-1/i }));
  return screen.getByRole('menu');
}

describe('RowActionsMenu — séparateur avant l’action destructrice', () => {
  beforeEach(() => { cleanup(); });

  it('pose un séparateur entre la dernière entrée bénigne et la première entrée danger', () => {
    const menu = open([
      { key: 'details', label: 'View details', activate: vi.fn() },
      { key: 'edit', label: 'Edit items', activate: vi.fn() },
      { key: 'void', label: 'Void order', danger: true, activate: vi.fn() },
    ]);
    const separators = within(menu).getAllByRole('separator');
    expect(separators).toHaveLength(1);
    // Le séparateur précède immédiatement l'entrée destructrice.
    expect(separators[0]?.nextElementSibling).toHaveTextContent('Void order');
    // Et il ne compte pas comme option.
    expect(within(menu).getAllByRole('menuitem')).toHaveLength(3);
  });

  it('ne pose aucun séparateur quand le menu n’a pas d’entrée destructrice', () => {
    const menu = open([
      { key: 'details', label: 'View details', activate: vi.fn() },
      { key: 'edit', label: 'Edit items', activate: vi.fn() },
    ]);
    expect(within(menu).queryByRole('separator')).not.toBeInTheDocument();
  });

  it('ne pose aucun séparateur devant une entrée destructrice qui ouvre le menu', () => {
    const menu = open([
      { key: 'void', label: 'Void order', danger: true, activate: vi.fn() },
    ]);
    expect(within(menu).queryByRole('separator')).not.toBeInTheDocument();
    expect(within(menu).getAllByRole('menuitem')).toHaveLength(1);
  });

  it('le clavier saute le séparateur : Flèche bas depuis la dernière bénigne atterrit sur la destructrice', () => {
    render(
      <RowActionsMenu
        subject="ORD-1"
        entries={[
          { key: 'details', label: 'View details', activate: vi.fn() },
          { key: 'void', label: 'Void order', danger: true, activate: vi.fn() },
        ]}
      />,
    );
    fireEvent.keyDown(screen.getByRole('button', { name: /Actions for ORD-1/i }), { key: 'ArrowDown' });
    const menu = screen.getByRole('menu');
    const items = within(menu).getAllByRole('menuitem');
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);
  });
});
