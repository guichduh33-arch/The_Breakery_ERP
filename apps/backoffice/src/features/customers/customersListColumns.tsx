// apps/backoffice/src/features/customers/customersListColumns.tsx
//
// Colonnes de la liste clients, extraites de `CustomersListPage` (le fichier
// dépassait 500 lignes) — même patron que `features/orders/ordersListColumns`.
// Elles ne dépendent d'aucun état de la page : une constante suffit.

import { Link } from 'react-router-dom';
import { LoyaltyBadge, type DataTableColumn } from '@breakery/ui';
import { tierFromLifetime } from '@breakery/domain';
import { formatCurrency } from '@breakery/utils';
import { FOCUS_RING } from '@/components/focusRing.js';
import { CustomerAvatar } from '@/features/customers/components/CustomerAvatar.js';
import { CustomerCategoryChip } from '@/features/customers/components/CustomerCategoryChip.js';
import type { CustomersListRow, CustomersSort } from '@/features/customers/hooks/useCustomersList.js';

// Colonne de la table → clé de tri du hook. Les quatre clés serveur, pas une de
// plus : `category`, `tier` et `credit` n'ont pas d'ordre côté requête, et une
// entête cliquable qui ne trie rien est un état menteur.
export const COLUMN_SORT: Record<string, CustomersSort> = {
  customer: 'name',
  points:   'points',
  spent:    'spend',
  last:     'last_visit',
};

// Chaque clé porte une direction FIXE côté hook (`useCustomersList`) : le nom
// monte, l'argent, les points et la dernière visite descendent. On affiche donc
// la direction réelle du serveur plutôt qu'un chevron réversible que la requête
// ignorerait.
export const SORT_DIRECTION: Record<CustomersSort, 'asc' | 'desc'> = {
  name:       'asc',
  spend:      'desc',
  points:     'desc',
  last_visit: 'desc',
};

function formatLastVisit(iso: string | null): string {
  if (iso === null) return '—';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export const CUSTOMERS_LIST_COLUMNS: readonly DataTableColumn<CustomersListRow>[] = [
  {
    id:     'customer',
    header: 'Customer',
    width: '26%',
    minWidth: '15rem',
    sortable: true,
    // La navigation vers la fiche est portée par un vrai lien — le clic-ligne
    // du `DataTable` ne se prend ni au Tab ni à Entrée, et la fiche client
    // était donc inatteignable au clavier depuis cette liste (WCAG 2.1.1).
    // Même motif que la colonne « PO Number » des bons de commande :
    // `stopPropagation` empêche la ligne de naviguer une seconde fois.
    render: (row) => (
      <div className="flex min-w-0 items-center gap-3">
        <CustomerAvatar name={row.name} className="shrink-0" />
        <div className="min-w-0 break-words leading-tight">
          <Link
            to={`/backoffice/customers/${row.id}`}
            onClick={(e) => e.stopPropagation()}
            className={`rounded-sm font-medium text-text-primary hover:text-gold hover:underline ${FOCUS_RING}`}
          >
            {row.name}
          </Link>
          {row.phone !== null && (
            <div className="font-data text-xs tabular-nums text-text-muted">{row.phone}</div>
          )}
        </div>
      </div>
    ),
  },
  {
    id:     'category',
    header: 'Category',
    width:  '15%',
    minWidth: '11rem',
    render: (row) => (
      <CustomerCategoryChip name={row.category_name} slug={row.category_slug} />
    ),
  },
  {
    id:     'tier',
    header: 'Loyalty tier',
    width:  '15%',
    minWidth: '10rem',
    render: (row) => {
      const t = tierFromLifetime(row.lifetime_points);
      return <LoyaltyBadge tier={t} points={row.loyalty_points} />;
    },
  },
  {
    id:     'credit',
    header: 'B2B balance',
    headerClassName: 'whitespace-nowrap',
    align:  'right',
    width:  '13%',
    minWidth: '10rem',
    render: (row) =>
      row.customer_type === 'b2b' && row.b2b_current_balance > 0 ? (
        <span className="whitespace-nowrap font-data tabular-nums text-warning">
          {formatCurrency(row.b2b_current_balance)}
        </span>
      ) : (
        <span className="text-text-subtle" aria-hidden>—</span>
      ),
  },
  {
    id:     'points',
    header: 'Points',
    align:  'right',
    width:  '8%',
    minWidth: '6rem',
    sortable: true,
    render: (row) => (
      <span className="font-data tabular-nums">{row.loyalty_points.toLocaleString('id-ID')}</span>
    ),
  },
  {
    id:     'spent',
    header: 'Total spent',
    align:  'right',
    width:  '13%',
    minWidth: '10rem',
    sortable: true,
    render: (row) => (
      <span className="whitespace-nowrap font-data tabular-nums">{formatCurrency(row.total_spent)}</span>
    ),
  },
  {
    id:     'last',
    header: 'Last visit',
    align:  'right',
    width:  '10%',
    minWidth: '8rem',
    sortable: true,
    render: (row) => (
      <span className="text-xs text-text-secondary">{formatLastVisit(row.last_visit_at)}</span>
    ),
  },
];
