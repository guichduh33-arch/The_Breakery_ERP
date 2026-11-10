// apps/backoffice/src/features/reports/components/__tests__/report-table.test.tsx
//
// S3-22 — la table de rapport partagée : ordre serveur à l'état nul, tri
// opt-in par en-tête, recherche client sur les colonnes désignées avec son
// compteur « n of m », pied de total, état vide et légende accessible.

import { describe, it, expect } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { JSX } from 'react';
import { ReportTable, type ReportColumn } from '../ReportTable.js';
import type { SortSpec } from '../../hooks/useSortedRows.js';

interface Row { id: string; name: string; note: string; qty: number }
type K = 'name' | 'qty';

const ROWS: Row[] = [
  { id: '1', name: 'Croissant',     note: 'flaky',  qty: 30 },
  { id: '2', name: 'Baguette',      note: 'crusty', qty: 10 },
  { id: '3', name: 'Crème brûlée',  note: 'sweet',  qty: 20 },
];

const SPECS: Readonly<Record<K, SortSpec<Row>>> = {
  name: { kind: 'string', value: (r) => r.name },
  qty:  { kind: 'number', value: (r) => r.qty },
};

const COLUMNS: readonly ReportColumn<Row, K>[] = [
  { id: 'name', header: 'Product', sortKey: 'name', cell: (r) => r.name,
    searchText: (r) => r.name, footer: 'Total' },
  { id: 'note', header: 'Note', cell: (r) => r.note },
  { id: 'qty', header: 'Qty', sortKey: 'qty', align: 'right', cell: (r) => String(r.qty),
    footer: '60' },
];

function Probe(): JSX.Element {
  return <span data-testid="location">{useLocation().search}</span>;
}

interface Opts { rows?: Row[]; emptyText?: string; noSearch?: boolean }

function renderTable({ rows = ROWS, emptyText, noSearch = false }: Opts = {}) {
  return render(
    <MemoryRouter initialEntries={['/r']}>
      <ReportTable<Row, K>
        rows={rows}
        columns={COLUMNS}
        sortSpecs={SPECS}
        rowKey={(r) => r.id}
        caption="Products sold"
        showFooter
        {...(noSearch ? {} : {
          search: { label: 'Search products', placeholder: 'Search', noun: 'product', urlKey: 'q' },
        })}
        {...(emptyText !== undefined ? { emptyText } : {})}
        testId="t"
      />
      <Probe />
    </MemoryRouter>,
  );
}

function bodyNames(): string[] {
  const table = screen.getByRole('table');
  const body = within(table).getAllByRole('rowgroup')[1];
  if (body === undefined) return [];
  return within(body).getAllByRole('row').map((r) => r.firstElementChild?.textContent ?? '');
}

describe('ReportTable', () => {
  it('has an accessible caption and keeps the server order by default', () => {
    renderTable();
    expect(screen.getByRole('table', { name: 'Products sold' })).toBeInTheDocument();
    expect(bodyNames()).toEqual(['Croissant', 'Baguette', 'Crème brûlée']);
  });

  it('sorts on header click: asc, desc, then back to the server order', () => {
    renderTable();
    const btn = screen.getByTestId('sort-qty');
    fireEvent.click(btn);
    expect(bodyNames()).toEqual(['Baguette', 'Crème brûlée', 'Croissant']);
    expect(btn.closest('th')).toHaveAttribute('aria-sort', 'ascending');
    fireEvent.click(btn);
    expect(bodyNames()).toEqual(['Croissant', 'Crème brûlée', 'Baguette']);
    fireEvent.click(btn);
    expect(bodyNames()).toEqual(['Croissant', 'Baguette', 'Crème brûlée']);
    // Une colonne sans `sortKey` reste inerte.
    expect(screen.getByRole('columnheader', { name: 'Note' })).not.toHaveAttribute('aria-sort');
  });

  it('right-aligns numeric columns', () => {
    renderTable();
    expect(screen.getByRole('columnheader', { name: /Qty/ })).toHaveClass('text-right');
    expect(screen.getByRole('cell', { name: '30' })).toHaveClass('text-right', 'tabular-nums');
  });

  it('renders the footer when asked', () => {
    renderTable();
    expect(screen.getByTestId('t-footer')).toHaveTextContent('Total60');
  });

  it('searches the designated columns only, ignoring case and accents', () => {
    renderTable();
    const input = screen.getByRole('searchbox', { name: 'Search products' });
    fireEvent.change(input, { target: { value: 'CREME' } });
    expect(bodyNames()).toEqual(['Crème brûlée']);
    expect(screen.getByTestId('t-count')).toHaveTextContent('1 of 3 products');
    expect(screen.getByTestId('location')).toHaveTextContent('?q=CREME');
    // Le pied du jeu complet se tait pendant une recherche qui restreint.
    expect(screen.queryByTestId('t-footer')).toBeNull();
    // `note` n'est pas cherchable.
    fireEvent.change(input, { target: { value: 'crusty' } });
    expect(screen.getByRole('table')).toHaveTextContent('No products match “crusty”.');
  });

  it('sorts the searched rows', () => {
    renderTable();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'cr' } });
    fireEvent.click(screen.getByTestId('sort-name'));
    expect(bodyNames()).toEqual(['Crème brûlée', 'Croissant']);
  });

  it('renders the empty text when there is no row, and no footer', () => {
    renderTable({ rows: [], emptyText: 'Nothing sold.' });
    expect(screen.getByRole('table')).toHaveTextContent('Nothing sold.');
    expect(screen.queryByTestId('t-footer')).toBeNull();
  });

  it('works without search', () => {
    renderTable({ noSearch: true });
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(bodyNames()).toHaveLength(3);
  });
});
