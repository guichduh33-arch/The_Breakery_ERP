// apps/backoffice/src/features/products/components/ProductsTable.tsx
//
// Écran 2a — table du catalogue, douze colonnes.
//
// Deux colonnes sont NEUVES et changent ce que la table sert à faire :
//
//   · Stock — `useProducts` renvoyait déjà `current_stock`, `unit`,
//     `min_stock_threshold` et `track_inventory` ; la table ne les montrait pas.
//     Aucune requête nouvelle, une colonne qui manquait.
//   · Margin — (retail − cost) / retail. Le catalogue affichait un coût et un
//     prix côte à côte en laissant le lecteur faire la division de tête, alors
//     que c'est le seul chiffre qui décide.
//
// Un coût MANQUANT se rend en rouge, et la marge en tiret : « marge nulle » et
// « marge inconnue » ne sont pas la même information, et les confondre ferait
// passer pour vendu à prix coûtant un produit dont on ignore le coût.
//
// La sélection multiple et le pied d'actions groupées sont RETIRÉS (audit UX/UI
// 2026-08-13). Les trois actions étaient inertes — elles réclament des RPC de
// masse gatées et auditées qui n'existent pas — et une case à cocher qui
// n'ouvre sur rien promet une capacité que l'écran n'a pas. Les cases
// reviendront avec les RPC, pas avant.

import { DollarSign, Eye, Package, Trash2 } from 'lucide-react';
import type { JSX } from 'react';
import { Badge, DataTable, cn, type DataTableColumn, type DataTableSort } from '@breakery/ui';
import { formatCurrency, formatQuantity } from '@breakery/utils';
import { ProductTypeBadge } from './ProductTypeBadge.js';
import {
  classifyProduct, productMarginPct,
  type ProductColumnId, type ProductRow,
} from '../types.js';
import {
  LIST_PAGE_SIZE_DEFAULT,
  ListPagination,
  pageSlice,
} from '@/components/ListPagination.js';

/** @deprecated Taille par défaut seulement — la taille effective est une prop.
 *  Conservé parce que des tests l'importent comme repère. */
export const PRODUCTS_PAGE_SIZE = LIST_PAGE_SIZE_DEFAULT;

const MONO = 'font-data tabular-nums';
// Les montants ne se coupent PAS. Sans cette classe, le navigateur est libre de
// renvoyer « Rp » seul sur une première ligne et le nombre sur la seconde, dans
// une colonne alignée à droite : mesuré sur la table AVANT correction, une
// cellule « Rp 5.000 » rendait 36 px de haut pour une ligne de 18. On rend la
// coupure IMPOSSIBLE plutôt qu'improbable, et on calibre la colonne pour.
const NOWRAP = 'whitespace-nowrap';
const DASH = <span className="text-text-subtle">—</span>;

// Le helper `num` unique est mort (audit UX/UI 2026-08-13) : il rendait un
// stock et un prix de la même façon, si bien que « 5.000 » sur la ligne Cost et
// « 5.000 » sur la ligne Stock ne se distinguaient pas — et qu'aucun des deux
// ne disait s'il s'agissait de roupies. Les trois colonnes de prix passent à
// `formatCurrency` (préfixe `Rp`), la colonne Stock à `formatQuantity` (unité
// en suffixe, arrondi entier pour les unités de comptage).

interface Props {
  rows: readonly ProductRow[];
  isLoading?: boolean;
  parentIds?: ReadonlySet<string>;
  hiddenColumns?: ReadonlySet<ProductColumnId>;
  /** Page courante, 1-based. La pagination est possédée par la page. */
  page?: number;
  onPage?: (next: number) => void;
  /** Lignes par page. Même contrat que `page` : la page la possède. */
  pageSize?: number;
  onPageSize?: (next: number) => void;
  /**
   * Tri courant. Même contrat que la pagination : la table REND l'ordre, elle
   * ne l'applique pas — c'est la page qui trie, parce que la grille montre le
   * même jeu et doit voir le même ordre.
   */
  sort?: DataTableSort | null;
  onSortChange?: (next: DataTableSort) => void;
  onRowClick?: (row: ProductRow) => void;
  onView?:     (row: ProductRow) => void;
  onPricing?:  (row: ProductRow) => void;
  onDelete?:   (row: ProductRow) => void;
}

export function ProductsTable({
  rows,
  isLoading = false,
  parentIds,
  hiddenColumns,
  page = 1,
  onPage,
  pageSize = LIST_PAGE_SIZE_DEFAULT,
  onPageSize,
  sort = null,
  onSortChange,
  onRowClick,
  onView,
  onPricing,
  onDelete,
}: Props): JSX.Element {
  const total = rows.length;
  const { pageRows } = pageSlice(rows, page, pageSize);

  const shown = (id: ProductColumnId): boolean => hiddenColumns?.has(id) !== true;

  // ── BUDGET DE LARGEUR ──────────────────────────────────────────────────────
  // Les onze colonnes étaient déclarées en POURCENTAGES (99,9 % au total) plus
  // 72 px d'actions. Un pourcentage ne se somme pas avec un pixel : à 1219 px
  // utiles (mesuré, viewport 1280), le rendu réel faisait 1239 px — 20 px de
  // débordement AVANT même de regarder le texte. Et `table-layout` étant `auto`
  // dans DataTable, une largeur déclarée n'est qu'une PRÉFÉRENCE : la largeur
  // minimale du contenu gagne. `actions`, déclarée 72 px, rendait 112.
  //
  // Tout passe donc en rem — la convention du reste du dépôt (OrdersListPage,
  // Inventory, ExpensesListPage) — et chaque colonne est calibrée sur son
  // minimum RÉEL : en-tête (`SectionLabel` xs, 12 px mono, interlettrage
  // 0,14 em, plus le chevron de tri) ou contenu, le plus grand des deux.
  // Pas de `ch` : l'unité se résout sur le `<th>`, qui n'a AUCUNE classe de
  // taille et hérite donc 16 px, quand les `<td>` sont en `text-sm` (14 px) —
  // un `ch` y mentirait de 14 %.
  //
  //   product 9 · sku 8 · category 7,5 · stock 6 · cost/retail/wholesale 9,25
  //   · margin 5,25 · status 5,25 · actions 7        = 75,75rem = 1212 px ≤ 1219
  //
  // La colonne `type` (6rem) est HORS de cette somme : elle est masquée par
  // défaut (`PRODUCT_DEFAULT_HIDDEN_COLUMNS`, features/products/types.ts), parce
  // que sans elle le budget ne bouclait pas. Le menu Columns la rend en un clic.
  const columns: DataTableColumn<ProductRow>[] = [
    {
      id: 'product',
      header: 'Product',
      width: '9rem',
      sortable: true,
      // Les badges Variant/Parent passent SOUS le nom : inline, ils poussaient un
      // nom long à la ligne, si bien qu'un produit à trois mots occupait deux
      // lignes juste pour loger une pastille d'une syllabe.
      render: (r) => {
        const isVariant = r.parent_product_id !== null;
        const isParent = parentIds?.has(r.id) ?? false;
        return (
          <div className={cn('flex flex-col gap-0.5', isVariant && 'pl-4')}>
            {/* `max-w` explicite : `truncate` pose `white-space: nowrap`, donc
                la largeur MINIMALE de la cellule devient celle du nom entier et
                la colonne s'élargit sans fin — c'est ce qui la faisait rendre
                225,7 px pour 9rem demandés. Le plafond vaut la colonne moins ses
                28 px de padding compact. Même geste que la colonne Customer
                d'OrdersListPage, qui borne déjà la sienne. */}
            <span className="max-w-[7.25rem] truncate font-medium text-text-primary" title={r.name}>{r.name}</span>
            {(isVariant || isParent) && (
              <div className="flex items-center gap-1">
                {isVariant && (
                  <Badge variant="outline" data-testid="badge-variant">Variant</Badge>
                )}
                {isParent && (
                  <Badge variant="outline" data-testid="badge-parent">Parent</Badge>
                )}
              </div>
            )}
          </div>
        );
      },
    },
    {
      id: 'sku',
      header: 'SKU',
      width: '8rem',
      sortable: true,
      // `whitespace-nowrap` : un SKU alphanumérique long se cassait sur trois
      // lignes dans une colonne trop étroite. Il reste sur une ligne, la colonne
      // est élargie pour l'accueillir.
      render: (r) => <span className="whitespace-nowrap font-data text-xs text-text-muted">{r.sku}</span>,
    },
    ...(shown('type') ? [{
      id: 'type',
      header: 'Type',
      width: '6rem',
      render: (r: ProductRow) => <ProductTypeBadge type={classifyProduct(r)} />,
    }] : []),
    ...(shown('category') ? [{
      id: 'category',
      header: 'Category',
      width: '7.5rem',
      sortable: true,
      // La pilule de catégorie tombe en vue liste : quinze pilules colorées
      // empilées font un vitrail où la couleur ne distingue plus rien.
      // `truncate` + plafond : un nom de catégorie long repliait la cellule sur
      // trois lignes. Le plancher de la colonne reste son en-tête (« Category »
      // + chevron de tri ≈ 117 px), pas son contenu.
      render: (r: ProductRow) =>
        r.category_name === null ? DASH : (
          <span className="block max-w-[5.75rem] truncate text-xs text-text-secondary" title={r.category_name}>
            {r.category_name}
          </span>
        ),
    }] : []),
    ...(shown('stock') ? [{
      id: 'stock',
      header: 'Stock',
      align: 'right' as const,
      width: '6rem',
      sortable: true,
      render: (r: ProductRow) => {
        if (!r.track_inventory) return DASH;
        const qty = r.current_stock;
        const tone =
          qty <= 0 ? 'text-danger font-semibold'
            : qty <= r.min_stock_threshold ? 'text-warning font-semibold'
              : 'text-text-secondary';
        return (
          <span
            className={cn(MONO, 'whitespace-nowrap', tone)}
            {...(r.is_display_item
              ? { title: 'Display-case product — the POS sells off the vitrine counter, not this global stock.' }
              : {})}
          >
            {formatQuantity(qty, r.unit)}
          </span>
        );
      },
    }] : []),
    ...(shown('cost') ? [{
      id: 'cost',
      header: 'Cost',
      align: 'right' as const,
      // 9,25rem = 148 px : « Rp 150.000.000 » fait 14 caractères, à 8,4 px
      // (JetBrains Mono, chasse 0,6 em, cellule `text-sm`) = 117,6 px, plus
      // 28 px de padding compact. Les trois colonnes monétaires partagent ce
      // calibre — un alignement décimal de colonne à colonne suppose la même
      // largeur. Mesuré AVANT : cost 86,8 px, retail 99,3, wholesale 107,9.
      width: '9.25rem',
      sortable: true,
      // Coût manquant EN ROUGE : c'est la population du compteur « No cost
      // price », et la cause d'une marge qu'on ne peut pas calculer.
      render: (r: ProductRow) =>
        r.cost_price > 0
          ? <span className={cn(MONO, NOWRAP, 'text-text-secondary')}>{formatCurrency(r.cost_price)}</span>
          : <span className={cn(MONO, 'font-semibold text-danger')}>—</span>,
    }] : []),
    ...(shown('retail') ? [{
      id: 'retail',
      header: 'Retail',
      align: 'right' as const,
      width: '9.25rem',
      sortable: true,
      render: (r: ProductRow) =>
        r.retail_price > 0
          ? <span className={cn(MONO, NOWRAP, 'font-semibold text-gold')}>{formatCurrency(r.retail_price)}</span>
          : DASH,
    }] : []),
    ...(shown('wholesale') ? [{
      id: 'wholesale',
      header: 'Wholesale',
      align: 'right' as const,
      width: '9.25rem',
      render: (r: ProductRow) =>
        r.wholesale_price !== null && r.wholesale_price > 0
          ? <span className={cn(MONO, NOWRAP, 'text-text-secondary')}>{formatCurrency(r.wholesale_price)}</span>
          : DASH,
    }] : []),
    ...(shown('margin') ? [{
      id: 'margin',
      header: 'Margin',
      align: 'right' as const,
      width: '5.25rem',
      // Marge NÉGATIVE en rouge, comme le coût manquant : un produit vendu à
      // perte rendait jusqu'ici en noir ordinaire, typographiquement identique à
      // un produit à 87 % de marge — seul le signe moins portait l'information.
      // Et aucun compteur ne l'attrape : « No cost price » teste `cost <= 0`,
      // pas `cost > retail`.
      render: (r: ProductRow) => {
        const m = productMarginPct(r);
        if (m === null) return DASH;
        const atALoss = m < 0;
        return (
          <span
            className={cn(MONO, atALoss ? 'font-semibold text-danger' : 'text-text-primary')}
            {...(atALoss ? { title: 'Sold below cost' } : {})}
          >
            {m.toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%
          </span>
        );
      },
    }] : []),
    ...(shown('status') ? [{
      id: 'status',
      header: 'Status',
      align: 'center' as const,
      width: '5.25rem',
      render: (r: ProductRow) => (
        <span className={cn('text-xs font-semibold', r.is_active ? 'text-success' : 'text-text-muted')}>
          {r.is_active ? 'Active' : 'Inactive'}
        </span>
      ),
    }] : []),
    {
      id: 'actions',
      header: 'Actions',
      align: 'right',
      // 7rem = 112 px, la largeur RÉELLEMENT rendue : les trois boutons d'action
      // plus les 28 px de padding. Les 72 px déclarés jusqu'ici étaient une
      // fiction que `table-layout: auto` corrigeait en silence — et 40 px de
      // fiction dans un budget qui débordait de 20.
      width: '7rem',
      render: (r) => (
        <div className="flex items-center justify-end gap-1.5">
          <RowAction label={`View ${r.name}`} onClick={(e) => { e.stopPropagation(); onView?.(r); }}>
            <Eye className="h-3.5 w-3.5" aria-hidden />
          </RowAction>
          {onPricing !== undefined && (
            <RowAction
              label={`Edit pricing for ${r.name}`}
              onClick={(e) => { e.stopPropagation(); onPricing(r); }}
              data-testid={`pricing-btn-${r.id}`}
            ><DollarSign className="h-3.5 w-3.5" aria-hidden /></RowAction>
          )}
          {onDelete !== undefined && (
            <RowAction
              label={`Delete ${r.name}`}
              onClick={(e) => { e.stopPropagation(); onDelete(r); }}
              destructive
              data-testid={`delete-btn-${r.id}`}
            ><Trash2 className="h-3.5 w-3.5" aria-hidden /></RowAction>
          )}
        </div>
      ),
    },
  ];

  const footer = (
    <ListPagination
      total={total}
      page={page}
      pageSize={pageSize}
      {...(onPage !== undefined ? { onPage } : {})}
      {...(onPageSize !== undefined ? { onPageSize } : {})}
    />
  );

  const tableProps: Parameters<typeof DataTable<ProductRow>>[0] = {
    'data-testid': 'products-table',
    columns,
    rows: pageRows,
    getRowKey: (r) => r.id,
    isLoading,
    loadingRowCount: pageSize,
    striped: false,
    density: 'compact',
    sort,
    footer,
    emptyTitle: 'No products match these filters',
    emptyState: (
      <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
        <Package className="h-10 w-10 text-text-subtle" aria-hidden />
        <h3 className="text-base font-semibold text-text-primary">No products match these filters</h3>
        <p className="max-w-prose text-sm text-text-secondary">
          Clear a counter or widen the search to see the catalogue again.
        </p>
      </div>
    ),
  };
  if (onRowClick !== undefined) tableProps.onRowClick = onRowClick;
  if (onSortChange !== undefined) tableProps.onSortChange = onSortChange;
  return <DataTable {...tableProps} />;
}

interface RowActionProps {
  label: string;
  onClick: (e: React.MouseEvent) => void;
  destructive?: boolean;
  'data-testid'?: string;
  children: React.ReactNode;
}

function RowAction({
  label, onClick, destructive = false, 'data-testid': testId, children,
}: RowActionProps): JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      data-testid={testId}
      className={cn(
        'inline-flex h-6 w-6 items-center justify-center rounded-sm text-text-subtle transition-colors',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold',
        destructive ? 'hover:bg-red-soft hover:text-danger' : 'hover:bg-surface-4 hover:text-text-primary',
      )}
    >
      {children}
    </button>
  );
}
