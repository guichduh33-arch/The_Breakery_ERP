// apps/backoffice/src/layouts/nav.ts
//
// Refonte shell 2026-08-05 — le modèle de navigation du Backoffice.
//
// Remplace le tableau GROUPS de l'ancien Sidebar (8 groupes, sous-groupes
// imbriqués, ~85 entrées empilées dans un rail de 240 px) par 7 DOMAINES qui
// vivent dans la top bar, chacun ouvrant un drop-panel de colonnes.
//
// Le panneau est à LARGEUR VARIABLE : il compte autant de colonnes que le
// domaine en déclare (3 pour Stock, 5 pour Reports, 4 pour Admin). Le handoff
// dessinait 3 colonnes / 640 px, mais son propre mapping demandait 5 colonnes
// pour Reports et 6 pour Admin — arbitrage Mamat du 2026-08-05 : on garde la
// taxonomie complète et c'est le panneau qui s'élargit.
//
// AUCUNE destination de l'ancien sidebar n'est perdue. Deux déplacements
// assumés, tous deux dictés par le handoff :
//   · les 4 rapports d'achat quittent Reports pour Purchase (le handoff donne
//     à Purchase une colonne « Purchase reports » et n'en donne pas à Reports) ;
//   · Margin watch quitte Reports/Inventory pour Stock/Watch (le handoff le
//     nomme explicitement dans la colonne Watch).
//
// Le filtrage par permission est celui d'avant (`useAuthStore().hasPermission`),
// appliqué en cascade : un lien sans droit disparaît, une colonne vidée
// disparaît, un domaine dont toutes les colonnes sont vides disparaît.

import type { PermissionCode } from '@breakery/supabase';

export interface NavLinkDef {
  to: string;
  label: string;
  /** Exact-match routing (react-router `end`) — pour les routes index. */
  end?: boolean;
  permission?: PermissionCode;
}

export interface NavColumn {
  /** Libellé de groupe (mono, capitales) en tête de colonne. */
  label: string;
  links: NavLinkDef[];
}

export interface NavDomain {
  /** Clé stable — sert d'id d'onglet et d'ancre aria. */
  id: string;
  label: string;
  /**
   * Destination directe quand le domaine n'a pas de panneau (Today). Un domaine
   * a soit un `to`, soit des `columns` — jamais les deux.
   */
  to?: string;
  end?: boolean;
  columns?: NavColumn[];
}

export const NAV_DOMAINS: NavDomain[] = [
  {
    id: 'today',
    label: 'Today',
    to: '/backoffice',
    end: true,
  },
  {
    id: 'sales',
    label: 'Sales',
    columns: [
      {
        label: 'Orders',
        links: [
          { to: '/backoffice/orders', label: 'Orders', end: true, permission: 'orders.read' },
          { to: '/backoffice/customers', label: 'Customers', end: true, permission: 'customers.read' },
          { to: '/backoffice/customers/categories', label: 'Customer categories', permission: 'customer_categories.read' },
        ],
      },
      {
        label: 'Wholesale',
        links: [
          { to: '/backoffice/b2b', label: 'B2B wholesale', end: true, permission: 'b2b.read' },
          { to: '/backoffice/b2b/orders', label: 'B2B orders', permission: 'b2b.read' },
          { to: '/backoffice/b2b/payments', label: 'B2B payments', permission: 'b2b.read' },
        ],
      },
      {
        label: 'Engagement',
        links: [
          { to: '/backoffice/promotions', label: 'Promotions', permission: 'promotions.read' },
          { to: '/backoffice/loyalty', label: 'Loyalty', permission: 'loyalty.read' },
        ],
      },
    ],
  },
  {
    id: 'stock',
    label: 'Stock',
    columns: [
      {
        label: 'Catalogue',
        links: [
          { to: '/backoffice/products', label: 'Products', end: true, permission: 'products.read' },
          { to: '/backoffice/products/combos', label: 'Combos', permission: 'combos.read' },
          { to: '/backoffice/categories', label: 'Categories', permission: 'categories.read' },
        ],
      },
      {
        label: 'Movements',
        links: [
          { to: '/backoffice/inventory', label: 'Stock & inventory', end: true, permission: 'inventory.read' },
          { to: '/backoffice/inventory/incoming', label: 'Incoming', permission: 'inventory.receive' },
          { to: '/backoffice/inventory/production', label: 'Production', permission: 'inventory.read' },
          { to: '/backoffice/inventory/opname', label: 'Opname', permission: 'inventory.read' },
          { to: '/backoffice/inventory/movements', label: 'Live movements', permission: 'inventory.read' },
        ],
      },
      {
        label: 'Watch',
        links: [
          { to: '/backoffice/inventory/alerts', label: 'Alerts', permission: 'inventory.read' },
          { to: '/backoffice/inventory/display', label: 'Display stock', permission: 'display.read' },
          { to: '/backoffice/inventory/sections', label: 'Stations', permission: 'inventory.read' },
          { to: '/backoffice/inventory/production/margin-watch', label: 'Margin watch', permission: 'reports.inventory.read' },
        ],
      },
    ],
  },
  {
    id: 'purchase',
    label: 'Purchase',
    columns: [
      {
        label: 'Purchasing',
        links: [
          { to: '/backoffice/purchasing/purchase-orders', label: 'Purchase orders', permission: 'purchasing.po.read' },
          { to: '/backoffice/suppliers', label: 'Suppliers', permission: 'suppliers.read' },
        ],
      },
      {
        label: 'Purchase reports',
        links: [
          { to: '/backoffice/reports/purchase-items', label: 'Purchase items', permission: 'reports.inventory.read' },
          { to: '/backoffice/reports/purchase-by-date', label: 'Purchase by date', permission: 'reports.inventory.read' },
          { to: '/backoffice/reports/purchase-by-supplier', label: 'Purchase by supplier', permission: 'reports.inventory.read' },
          { to: '/backoffice/reports/purchase-price-trends', label: 'Purchase price trends', permission: 'reports.inventory.read' },
          { to: '/backoffice/reports/cost-spend', label: 'Cost & spend analytics', permission: 'reports.financial.read' },
          { to: '/backoffice/reports/supplier-payments', label: 'Supplier payments', permission: 'reports.financial.read' },
        ],
      },
    ],
  },
  {
    id: 'finance',
    label: 'Finance',
    columns: [
      {
        label: 'Expenses',
        links: [
          { to: '/backoffice/expenses', label: 'Expenses', permission: 'expenses.read' },
        ],
      },
      {
        label: 'Accounting',
        links: [
          { to: '/backoffice/accounting', label: 'Accounting hub', end: true, permission: 'accounting.read' },
          { to: '/backoffice/accounting/chart-of-accounts', label: 'Chart of accounts', permission: 'accounting.coa.read' },
          { to: '/backoffice/accounting/journal-entries', label: 'Journal entries', permission: 'accounting.gl.read' },
          { to: '/backoffice/accounting/general-ledger', label: 'General ledger', permission: 'accounting.gl.read' },
          { to: '/backoffice/accounting/cash', label: 'Cash treasury', permission: 'accounting.cash.read' },
          { to: '/backoffice/accounting/trial-balance', label: 'Trial balance', permission: 'accounting.tb.read' },
          { to: '/backoffice/accounting/mappings', label: 'Account mappings', permission: 'accounting.read' },
        ],
      },
      {
        label: 'Closing',
        links: [
          { to: '/backoffice/cash-register/zreports', label: 'Z-reports', permission: 'zreports.read' },
        ],
      },
    ],
  },
  {
    id: 'reports',
    label: 'Reports',
    columns: [
      {
        label: 'Sales',
        links: [
          { to: '/backoffice/reports', label: 'Reports hub', end: true, permission: 'reports.read' },
          { to: '/backoffice/reports/daily-sales', label: 'Daily sales', permission: 'reports.sales.read' },
          { to: '/backoffice/reports/sales-by-hour', label: 'Sales by hour', permission: 'reports.sales.read' },
          { to: '/backoffice/reports/sales-by-category', label: 'Sales by category', permission: 'reports.sales.read' },
          { to: '/backoffice/reports/sales-by-product', label: 'Sales by product', permission: 'reports.sales.read' },
          { to: '/backoffice/reports/sales-by-customer', label: 'Sales by customer', permission: 'reports.sales.read' },
          { to: '/backoffice/reports/sales-by-origin', label: 'Sales by origin', permission: 'reports.sales.read' },
          { to: '/backoffice/reports/combo-sales', label: 'Combo sales', permission: 'reports.sales.read' },
          { to: '/backoffice/reports/sales-by-table', label: 'Sales by table', permission: 'reports.sales.read' },
          { to: '/backoffice/reports/sales-by-staff', label: 'Sales by staff', permission: 'reports.sales.read' },
          { to: '/backoffice/reports/staff-performance', label: 'Staff performance', permission: 'reports.sales.read' },
          { to: '/backoffice/reports/basket-analysis', label: 'Basket analysis', permission: 'reports.sales.read' },
          { to: '/backoffice/reports/refunds-voids', label: 'Refunds & voids', permission: 'reports.sales.read' },
          { to: '/backoffice/reports/discounts-loyalty', label: 'Discounts & loyalty', permission: 'reports.sales.read' },
          { to: '/backoffice/reports/cashier-variance', label: 'Cashier variance', permission: 'reports.read' },
          { to: '/backoffice/reports/off-hours-sales', label: 'Off-hours sales', permission: 'reports.sales.read' },
        ],
      },
      {
        label: 'Inventory',
        links: [
          { to: '/backoffice/reports/stock-position', label: 'Stock position at date', permission: 'reports.inventory.read' },
          { to: '/backoffice/reports/stock-variance', label: 'Stock variance', permission: 'reports.inventory.read' },
          { to: '/backoffice/reports/stock-movements', label: 'Stock movement history', permission: 'reports.inventory.read' },
          { to: '/backoffice/reports/wastage', label: 'Wastage & spoilage', permission: 'reports.inventory.read' },
          // ⛔ `perishable-turnover` N'A PAS SA PLACE ICI, et son absence est une
          // DÉCISION, pas un oubli. ADR-004 (2026-07-04, acté), conséquence 2 :
          // « retirer la page /inventory/expiring et le rapport
          // perishable-turnover de la navigation ». The Breakery ne suit ni lots
          // ni péremption ; la péremption se déclare en perte. Le rapport, sa
          // route et son gabarit PDF subsistent pour l'historique — le menu, non.
          //
          // Il a été ajouté ici le 2026-08-21 puis retiré le lendemain. La
          // critique /impeccable avait relevé l'écart entre l'index des rapports
          // et le panneau de navigation, et l'écart était RÉEL — mais un écart
          // n'est pas un défaut tant qu'on n'a pas cherché pourquoi il existe.
          // Cette ligne est là pour que la prochaine comparaison mécanique des
          // deux listes trouve la réponse avant de « corriger » la décision.
          { to: '/backoffice/reports/recipe-cost', label: 'Recipe cost', permission: 'reports.financial.read' },
          { to: '/backoffice/reports/production-yield', label: 'Production yield', permission: 'inventory.read' },
          { to: '/backoffice/reports/production-report', label: 'Production report', permission: 'reports.inventory.read' },
          { to: '/backoffice/reports/production-efficiency', label: 'Production efficiency', permission: 'reports.inventory.read' },
        ],
      },
      {
        label: 'Financial',
        links: [
          { to: '/backoffice/reports/profit-loss', label: 'Profit & loss', permission: 'reports.financial.read' },
          { to: '/backoffice/reports/gross-margin', label: 'Gross margin', permission: 'reports.financial.read' },
          { to: '/backoffice/reports/operating-expenses', label: 'Operating expenses', permission: 'reports.financial.read' },
          { to: '/backoffice/reports/balance-sheet', label: 'Balance sheet', permission: 'reports.financial.read' },
          { to: '/backoffice/reports/cash-flow', label: 'Cash flow', permission: 'reports.financial.read' },
          { to: '/backoffice/reports/payment-by-method', label: 'Payment by method', permission: 'reports.financial.read' },
          { to: '/backoffice/reports/pb1', label: 'VAT / PB1', permission: 'reports.financial.read' },
          { to: '/backoffice/reports/ar-aging', label: 'AR aging (B2B)', permission: 'reports.financial.read' },
        ],
      },
      {
        label: 'Marketing',
        links: [
          { to: '/backoffice/marketing/cohort', label: 'Cohorts', permission: 'reports.read' },
          { to: '/backoffice/marketing/segments', label: 'Segments', permission: 'reports.read' },
          { to: '/backoffice/marketing/promo-roi', label: 'Promo ROI', permission: 'reports.read' },
          { to: '/backoffice/marketing/birthday', label: 'Birthdays', permission: 'reports.read' },
        ],
      },
      {
        label: 'Audit',
        links: [
          { to: '/backoffice/reports/audit', label: 'Audit log', permission: 'reports.audit.read' },
          { to: '/backoffice/reports/price-changes', label: 'Price changes', permission: 'reports.financial.read' },
          { to: '/backoffice/reports/permission-changes', label: 'Permission change log', permission: 'reports.audit.read' },
        ],
      },
    ],
  },
  {
    id: 'admin',
    label: 'Admin',
    columns: [
      {
        label: 'Business',
        links: [
          { to: '/backoffice/settings', label: 'Settings hub', end: true, permission: 'settings.read' },
          { to: '/backoffice/settings/general', label: 'Company', permission: 'settings.read' },
          { to: '/backoffice/settings/holidays', label: 'Holidays', permission: 'settings.read' },
          { to: '/backoffice/settings/inventory', label: 'Inventory config', permission: 'settings.read' },
        ],
      },
      {
        label: 'POS & sales',
        links: [
          { to: '/backoffice/settings/pos', label: 'POS configuration', permission: 'settings.read' },
          { to: '/backoffice/settings/payment-methods', label: 'Payment methods', permission: 'settings.read' },
          { to: '/backoffice/settings/printing', label: 'Printing', permission: 'settings.read' },
          { to: '/backoffice/settings/floor-plan', label: 'Floor plan', permission: 'tables.update' },
          { to: '/backoffice/settings/kds', label: 'KDS configuration', permission: 'settings.read' },
          { to: '/backoffice/settings/customer-display', label: 'Customer display', permission: 'settings.read' },
        ],
      },
      // Audit UX/UI 2026-08-13 (lot 2) : Admin est ramené de 7 colonnes à 4
      // (panneau de 1244 px → 754 px, libellés entiers). Fusion pure — chaque
      // lien garde sa permission, le filtrage en cascade est inchangé.
      {
        label: 'Finance & notifications',
        links: [
          { to: '/backoffice/settings/accounting', label: 'Fiscal periods', permission: 'accounting.period.close' },
          { to: '/backoffice/settings/expense-thresholds', label: 'Expense thresholds', permission: 'expenses.thresholds.read' },
          { to: '/backoffice/b2b/settings', label: 'B2B credit settings', permission: 'settings.read' },
          { to: '/backoffice/settings/notifications', label: 'Notifications', permission: 'settings.read' },
          { to: '/backoffice/settings/templates/email', label: 'Email templates', permission: 'settings.read' },
          { to: '/backoffice/settings/templates/receipt', label: 'Receipt templates', permission: 'settings.read' },
        ],
      },
      {
        label: 'Access & network',
        links: [
          { to: '/backoffice/settings/security', label: 'Session timeouts', permission: 'settings.security.manage' },
          { to: '/backoffice/settings/permissions', label: 'Permissions matrix', permission: 'settings.read' },
          { to: '/backoffice/users', label: 'Users', end: true, permission: 'users.read' },
          { to: '/backoffice/users/permissions', label: 'Permissions (read-only)', permission: 'rbac.read' },
          { to: '/backoffice/lan-devices', label: 'LAN devices', permission: 'lan.devices.read' },
        ],
      },
    ],
  },
];

/** Prédicat de permission — même signature que `useAuthStore().hasPermission`. */
export type PermissionPredicate = (code: PermissionCode) => boolean;

/**
 * Filtre le modèle en cascade : lien sans droit → colonne vidée → domaine vidé.
 * Un domaine à destination directe (Today) n'a pas de permission et survit
 * toujours ; c'est la page d'accueil, elle gère elle-même son état restreint.
 */
export function visibleDomains(
  domains: NavDomain[],
  hasPermission: PermissionPredicate,
): NavDomain[] {
  return domains.flatMap((domain) => {
    if (domain.columns === undefined) return [domain];
    const columns = domain.columns
      .map((col) => ({
        label: col.label,
        links: col.links.filter(
          (l) => l.permission === undefined || hasPermission(l.permission),
        ),
      }))
      .filter((col) => col.links.length > 0);
    return columns.length > 0 ? [{ ...domain, columns }] : [];
  });
}

/** Correspondance de route équivalente à `NavLink` (`end` = exact). */
export function routeMatches(to: string, end: boolean | undefined, pathname: string): boolean {
  if (end === true) return pathname === to;
  return pathname === to || pathname.startsWith(`${to}/`);
}

/**
 * Id du domaine qui possède la route courante, ou null. Retient le `to` le plus
 * LONG pour qu'un lien profond résolve vers son vrai domaine (par ex.
 * /backoffice/inventory/opname → Stock, pas Today via /backoffice).
 *
 * `end` est délibérément IGNORÉ ici. Ce drapeau sert au surlignage du LIEN dans
 * le drop-panel (« Orders » ne doit pas rester allumé sur le détail d'une
 * commande) ; l'appliquer à l'ONGLET éteindrait Sales sur cette même page,
 * alors qu'on y est toujours. Le préfixe suffit, et le plus long l'emporte —
 * /backoffice ne capte donc que ce qu'aucune entrée plus précise ne réclame.
 */
export function activeDomainId(domains: NavDomain[], pathname: string): string | null {
  let best: { len: number; id: string } | null = null;
  for (const domain of domains) {
    const targets: string[] =
      domain.columns?.flatMap((c) => c.links.map((l) => l.to))
      ?? (domain.to === undefined ? [] : [domain.to]);
    for (const to of targets) {
      if (routeMatches(to, false, pathname) && (best === null || to.length > best.len)) {
        best = { len: to.length, id: domain.id };
      }
    }
  }
  return best === null ? null : best.id;
}

/** Toutes les destinations visibles, à plat, avec leur fil d'Ariane. */
export interface FlatDestination extends NavLinkDef {
  domainLabel: string;
  columnLabel: string;
}

export function flattenDestinations(domains: NavDomain[]): FlatDestination[] {
  return domains.flatMap((domain) =>
    domain.columns === undefined
      ? domain.to === undefined
        ? []
        : [{ to: domain.to, label: domain.label, ...(domain.end === true ? { end: true } : {}), domainLabel: domain.label, columnLabel: '' }]
      : domain.columns.flatMap((col) =>
          col.links.map((link) => ({
            ...link,
            domainLabel: domain.label,
            columnLabel: col.label,
          })),
        ),
  );
}
