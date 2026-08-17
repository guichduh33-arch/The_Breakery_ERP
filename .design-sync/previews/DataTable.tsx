import { Badge, DataTable, type DataTableColumn } from '@breakery/ui';

interface ProductRow {
  id: string;
  name: string;
  category: string;
  price: number;
  stock: number;
  status: 'active' | 'low' | 'out';
}

const ROWS: ProductRow[] = [
  { id: 'p1', name: 'Croissant beurre AOP', category: 'Viennoiseries', price: 18000, stock: 42, status: 'active' },
  { id: 'p2', name: 'Pain au chocolat', category: 'Viennoiseries', price: 20000, stock: 31, status: 'active' },
  { id: 'p3', name: 'Baguette tradition', category: 'Pains', price: 25000, stock: 8, status: 'low' },
  { id: 'p4', name: 'Tarte citron meringuée', category: 'Pâtisseries', price: 45000, stock: 12, status: 'active' },
  { id: 'p5', name: 'Éclair café', category: 'Pâtisseries', price: 32000, stock: 0, status: 'out' },
  { id: 'p6', name: 'Sourdough country loaf', category: 'Pains', price: 55000, stock: 15, status: 'active' },
];

const STATUS_BADGE = {
  active: <Badge variant="success">En vente</Badge>,
  low: <Badge variant="warning">Stock bas</Badge>,
  out: <Badge variant="destructive">Épuisé</Badge>,
};

const COLUMNS: DataTableColumn<ProductRow>[] = [
  { id: 'name', header: 'Produit', sortable: true, render: (r) => <span className="font-medium">{r.name}</span> },
  { id: 'category', header: 'Catégorie', render: (r) => <span className="text-text-secondary">{r.category}</span> },
  { id: 'price', header: 'Prix', align: 'right', sortable: true, render: (r) => <span className="font-mono tabular-nums">Rp {r.price.toLocaleString('en-US')}</span> },
  { id: 'stock', header: 'Stock', align: 'right', sortable: true, render: (r) => <span className="font-mono tabular-nums">{r.stock}</span> },
  { id: 'status', header: 'Statut', render: (r) => STATUS_BADGE[r.status] },
];

// La table canonique du back-office : en-têtes SectionLabel, zébrage, tri
// contrôlé visible (chevron or sur Produit), pied compteur + pagination.
export const Backoffice = () => (
  <div className="theme-backoffice bg-bg-base p-6">
    <DataTable
      columns={COLUMNS}
      rows={ROWS}
      getRowKey={(r) => r.id}
      sort={{ columnId: 'name', direction: 'asc' }}
      onSortChange={() => {}}
      footer={<span className="text-xs text-text-secondary">6 produits sur 128 · page 1 / 22</span>}
    />
  </div>
);

// Densité compact (14/10 px) — celle des écrans de travail (catalogue, listes
// longues), tri descendant sur le prix.
export const Compact = () => (
  <div className="theme-backoffice bg-bg-base p-6">
    <DataTable
      columns={COLUMNS}
      rows={ROWS}
      getRowKey={(r) => r.id}
      density="compact"
      sort={{ columnId: 'price', direction: 'desc' }}
      onSortChange={() => {}}
    />
  </div>
);

// États asynchrones : squelette de chargement, puis table vide (EmptyState).
export const States = () => (
  <div className="theme-backoffice grid gap-6 bg-bg-base p-6">
    <DataTable
      columns={COLUMNS}
      rows={[]}
      getRowKey={(r: ProductRow) => r.id}
      isLoading
      loadingRowCount={3}
    />
    <DataTable
      columns={COLUMNS}
      rows={[]}
      getRowKey={(r: ProductRow) => r.id}
      emptyTitle="Aucun produit"
      emptyDescription="Aucun résultat pour « macaron pistache »."
      footer={<span className="text-xs text-text-secondary">0 sur 128 produits</span>}
    />
  </div>
);
