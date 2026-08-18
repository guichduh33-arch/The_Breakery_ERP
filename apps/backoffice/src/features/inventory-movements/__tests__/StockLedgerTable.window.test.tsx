// apps/backoffice/src/features/inventory-movements/__tests__/StockLedgerTable.window.test.tsx
//
// La fenêtre de RENDU du grand livre de stock (2026-08-18).
//
// La RPC `get_stock_movement_ledger_v1` rend jusqu'à 5 000 lignes d'un coup, et
// ce tableau les peignait toutes : onze cellules par ligne, ~55 000 nœuds DOM
// sur l'écran que le responsable stock ouvre le plus, depuis un portable de
// boutique. Le rendu est désormais borné à 200 lignes, déroulables par
// « Load more ».
//
// Ce que ces tests verrouillent, et pourquoi :
//  - le PLAFOND, parce que c'est le défaut de performance lui-même ;
//  - le PIED, qui dit RENDU contre REÇU — deux nombres de provenances
//    différentes, et le seul endroit qui empêche la fenêtre de mentir ;
//  - le TRI, qui doit porter sur TOUTES les lignes reçues et non sur la
//    fenêtre : trier la fenêtre rendrait « les 200 premières, triées », ce qui
//    n'est pas la même table ;
//  - la REMISE À ZÉRO au changement de filtre, sans quoi une recherche plus
//    étroite garderait le déroulé de la précédente.

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { StockLedgerTable } from '../components/StockLedgerTable.js';
import type { StockLedgerRow } from '../stockLedgerColumns.js';

function makeRows(n: number, namePrefix = 'Product'): StockLedgerRow[] {
  return Array.from({ length: n }, (_, i) => ({
    id:              `sm-${i}`,
    movement_date:   '2026-05-20',
    // Décroissant sur l'index : l'ordre serveur n'est donc PAS l'ordre trié,
    // ce qui rend le test de tri capable d'échouer.
    created_time:    `2026-05-20T${String(23 - (i % 24)).padStart(2, '0')}:00:00Z`,
    movement_type:   'incoming',
    product_id:      `prod-${i}`,
    product_name:    `${namePrefix} ${String(n - i).padStart(4, '0')}`,
    product_group:   'Ingredient',
    unit:            'kg',
    incoming_qty:    1,
    outgoing_qty:    0,
    beginning_qty:   0,
    balance_qty:     1,
    price:           1000,
    movement_amount: 1000,
    reference_type:  null,
    reference_id:    null,
    reason:          null,
    reference_label: null,
    created_by_name: null,
    ref_no:          `REF-${i}`,
    type_label:      'Incoming',
    origin:          'Purchase',
  }));
}

function bodyRows(): HTMLElement[] {
  const table = screen.getByTestId('stock-ledger-table');
  const tbody = table.querySelector('tbody');
  return Array.from(tbody?.querySelectorAll('tr') ?? []);
}

describe('StockLedgerTable — fenêtre de rendu', () => {
  it('ne peint que 200 lignes quand la RPC en rend 5 000', () => {
    render(<StockLedgerTable rows={makeRows(5000)} truncated isLoading={false} />);
    expect(bodyRows()).toHaveLength(200);
  });

  it('le pied dit RENDU contre REÇU, pas « tout »', () => {
    render(<StockLedgerTable rows={makeRows(5000)} truncated isLoading={false} />);
    expect(screen.getByTestId('stock-ledger-footer-count')).toHaveTextContent('200 of 5.000 shown');
  });

  it('« Load more » ajoute un cran et disparaît une fois la liste épuisée', () => {
    render(<StockLedgerTable rows={makeRows(350)} truncated={false} isLoading={false} />);
    expect(bodyRows()).toHaveLength(200);

    fireEvent.click(screen.getByTestId('stock-ledger-load-more'));

    expect(bodyRows()).toHaveLength(350);
    expect(screen.getByTestId('stock-ledger-footer-count')).toHaveTextContent('350 of 350 shown');
    expect(screen.queryByTestId('stock-ledger-load-more')).toBeNull();
  });

  it('le pied se rend même quand la table est vide — « 0 of 0 » est une information', () => {
    render(<StockLedgerTable rows={[]} truncated={false} isLoading={false} />);
    expect(screen.getByTestId('stock-ledger-footer-count')).toHaveTextContent('0 of 0 shown');
    expect(screen.queryByTestId('stock-ledger-load-more')).toBeNull();
  });

  it('le tri porte sur TOUTES les lignes reçues, pas sur la seule fenêtre', () => {
    // 300 lignes nommées « Product 0300 » … « Product 0001 » dans l'ordre
    // serveur. Trié par produit en ascendant, la première ligne doit être
    // « Product 0001 » — elle vit au RANG 300 de l'ordre serveur, donc hors de
    // la fenêtre initiale. Si le tri ne portait que sur les 200 premières, la
    // tête serait « Product 0101 ».
    render(<StockLedgerTable rows={makeRows(300)} truncated={false} isLoading={false} />);
    fireEvent.click(screen.getByRole('button', { name: /product/i }));

    const first = bodyRows()[0];
    expect(first).toBeDefined();
    expect(within(first!).getByText('Product 0001')).toBeInTheDocument();
    expect(bodyRows()).toHaveLength(200);
  });

  it('un changement de filtre ramène la fenêtre à son premier cran', () => {
    const { rerender } = render(
      <StockLedgerTable rows={makeRows(350)} truncated={false} isLoading={false} />,
    );
    fireEvent.click(screen.getByTestId('stock-ledger-load-more'));
    expect(bodyRows()).toHaveLength(350);

    // Nouveau jeu de lignes = nouveau filtre côté page.
    rerender(<StockLedgerTable rows={makeRows(400, 'Autre')} truncated={false} isLoading={false} />);

    expect(bodyRows()).toHaveLength(200);
    expect(screen.getByTestId('stock-ledger-footer-count')).toHaveTextContent('200 of 400 shown');
  });
});
