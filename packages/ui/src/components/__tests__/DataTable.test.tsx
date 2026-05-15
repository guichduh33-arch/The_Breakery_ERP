import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DataTable, type DataTableColumn } from '../DataTable.js';

interface Row {
  id: string;
  name: string;
  amount: number;
}

const COLUMNS: DataTableColumn<Row>[] = [
  { id: 'name', header: 'Product', render: (r) => r.name, sortable: true },
  {
    id: 'amount',
    header: 'Amount',
    render: (r) => r.amount,
    sortable: true,
    align: 'right',
  },
];

const ROWS: Row[] = [
  { id: '1', name: 'Croissant', amount: 25000 },
  { id: '2', name: 'Bagel', amount: 18000 },
  { id: '3', name: 'Latte', amount: 35000 },
];

describe('DataTable', () => {
  it('renders headers + rows', () => {
    render(
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        getRowKey={(r) => r.id}
      />,
    );
    expect(screen.getByText('Product')).toBeInTheDocument();
    expect(screen.getByText('Amount')).toBeInTheDocument();
    expect(screen.getByText('Croissant')).toBeInTheDocument();
    expect(screen.getByText('Bagel')).toBeInTheDocument();
    expect(screen.getByText('Latte')).toBeInTheDocument();
  });

  it('uses SectionLabel chrome for headers (uppercase + tracking-widest)', () => {
    render(<DataTable columns={COLUMNS} rows={ROWS} getRowKey={(r) => r.id} />);
    const header = screen.getByText('Product');
    expect(header.className).toMatch(/uppercase/);
    expect(header.className).toMatch(/tracking-widest/);
  });

  it('fires onSortChange with asc on first click of a sortable column', () => {
    const onSortChange = vi.fn();
    render(
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        getRowKey={(r) => r.id}
        onSortChange={onSortChange}
      />,
    );
    fireEvent.click(screen.getByText('Product'));
    expect(onSortChange).toHaveBeenCalledWith({ columnId: 'name', direction: 'asc' });
  });

  it('toggles sort direction on subsequent clicks of the same column', () => {
    const onSortChange = vi.fn();
    render(
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        getRowKey={(r) => r.id}
        sort={{ columnId: 'name', direction: 'asc' }}
        onSortChange={onSortChange}
      />,
    );
    fireEvent.click(screen.getByText('Product'));
    expect(onSortChange).toHaveBeenCalledWith({ columnId: 'name', direction: 'desc' });
  });

  it('renders empty state when no rows and not loading', () => {
    render(
      <DataTable
        columns={COLUMNS}
        rows={[]}
        getRowKey={(r) => r.id}
        emptyTitle="No products yet"
        emptyDescription="Add your first product"
      />,
    );
    expect(screen.getByText('No products yet')).toBeInTheDocument();
    expect(screen.getByText('Add your first product')).toBeInTheDocument();
  });

  it('renders skeleton rows when isLoading', () => {
    const { container } = render(
      <DataTable
        columns={COLUMNS}
        rows={[]}
        getRowKey={(r) => r.id}
        isLoading
        loadingRowCount={3}
      />,
    );
    const skeletons = container.querySelectorAll('.animate-pulse');
    // 3 rows * 2 columns = 6 skeletons.
    expect(skeletons.length).toBe(6);
  });

  it('fires onRowClick when a row is clicked', () => {
    const onRowClick = vi.fn();
    render(
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        getRowKey={(r) => r.id}
        onRowClick={onRowClick}
      />,
    );
    fireEvent.click(screen.getByText('Bagel'));
    expect(onRowClick).toHaveBeenCalledWith(ROWS[1], 1);
  });

  it('reports aria-sort on sorted column', () => {
    render(
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        getRowKey={(r) => r.id}
        sort={{ columnId: 'amount', direction: 'desc' }}
        onSortChange={vi.fn()}
      />,
    );
    const amountTh = screen.getByText('Amount').closest('th');
    expect(amountTh?.getAttribute('aria-sort')).toBe('descending');
  });

  it('applies right alignment for align=right columns', () => {
    render(<DataTable columns={COLUMNS} rows={ROWS} getRowKey={(r) => r.id} />);
    // The Amount column has align=right — its td should have text-right class.
    const matches = screen.getAllByText(/25000|18000|35000/);
    expect(matches.length).toBeGreaterThan(0);
    const amountCell = matches[0]!.closest('td');
    expect(amountCell?.className).toMatch(/text-right/);
  });
});
