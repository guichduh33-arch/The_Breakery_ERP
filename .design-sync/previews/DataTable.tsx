import {
  Badge,
  Currency,
  DataTable,
  type DataTableColumn,
} from '@breakery/ui';

interface ProductRow {
  id: string;
  name: string;
  sku: string;
  category: string;
  price: number;
  stock: number;
}

const rows: ProductRow[] = [
  { id: '1', name: 'Baguette tradition', sku: 'BRD-001', category: 'Breads', price: 25000, stock: 34 },
  { id: '2', name: 'Croissant au beurre', sku: 'VIEN-001', category: 'Viennoiserie', price: 28000, stock: 21 },
  { id: '3', name: 'Es kopi susu', sku: 'BEV-014', category: 'Beverages', price: 30000, stock: 120 },
  { id: '4', name: 'Kouign-amann', sku: 'VIEN-007', category: 'Viennoiserie', price: 38000, stock: 3 },
  { id: '5', name: 'Pain au chocolat', sku: 'VIEN-002', category: 'Viennoiserie', price: 32000, stock: 0 },
];

function stockBadge(stock: number) {
  if (stock === 0) return <Badge variant="destructive">Out of stock</Badge>;
  if (stock <= 5) return <Badge variant="warning">{stock} left</Badge>;
  return <Badge variant="success">{stock} in stock</Badge>;
}

const columns: DataTableColumn<ProductRow>[] = [
  {
    id: 'name',
    header: 'Product',
    sortable: true,
    render: (row) => (
      <div className="flex flex-col">
        <span className="font-medium">{row.name}</span>
        <span className="text-xs text-text-muted">{row.sku}</span>
      </div>
    ),
  },
  {
    id: 'category',
    header: 'Category',
    render: (row) => <span className="text-text-secondary">{row.category}</span>,
  },
  {
    id: 'price',
    header: 'Price',
    sortable: true,
    align: 'right',
    render: (row) => <Currency amount={row.price} />,
  },
  {
    id: 'stock',
    header: 'Stock',
    align: 'right',
    render: (row) => stockBadge(row.stock),
  },
];

// Canonical product table — SectionLabel headers, active asc sort on Product,
// zebra stripes, mono prices, status badges. Full width (cardMode column).
export const ProductsSorted = () => (
  <div className="bg-bg-base p-6 rounded-lg">
    <DataTable
      columns={columns}
      rows={rows}
      getRowKey={(row) => row.id}
      sort={{ columnId: 'name', direction: 'asc' }}
      onSortChange={() => {}}
      onRowClick={() => {}}
    />
  </div>
);

// Loading skeleton — pulse rows while async data resolves.
export const LoadingSkeleton = () => (
  <div className="bg-bg-base p-6 rounded-lg">
    <DataTable
      columns={columns}
      rows={[]}
      getRowKey={(row: ProductRow) => row.id}
      isLoading
      loadingRowCount={4}
    />
  </div>
);

// Empty — EmptyState slot below the header row.
export const Empty = () => (
  <div className="bg-bg-base p-6 rounded-lg">
    <DataTable
      columns={columns}
      rows={[]}
      getRowKey={(row: ProductRow) => row.id}
      emptyTitle="No products found"
      emptyDescription="Try a different category or clear the search filter."
    />
  </div>
);
