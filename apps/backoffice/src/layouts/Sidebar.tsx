// apps/backoffice/src/layouts/Sidebar.tsx
//
// Session 14 / Phase 4.A — Backoffice global sidebar.
//
// Grouped navigation matching docs/Design/backoffice/Dashboard.jpg:
//   - BrandMark + AlertsBadge in header
//   - OPERATIONS  — Dashboard, POS Terminal, Kitchen Display
//   - MANAGEMENT  — Products, Stock & Inventory, Order History, B2B, Purchases,
//                   Suppliers, Expenses, Customers
//   - ADMIN       — Reports, Accounting, Users, Settings
//
// Each top-level category renders as a collapsible accordion header (beige
// `bg-surface-4` pill, uppercase SectionLabel h2, pivoting chevron). Items are
// permission-filtered via the auth store — empty groups are hidden so the
// sidebar stays clean for non-owner roles.
//
// Open/closed state is persisted per category in localStorage
// (`bo:sidebar:groups`) and per named subgroup (`bo:sidebar:subgroups`); the
// category owning the active route is auto-opened on load. Indented sub-items
// (e.g. inventory subpages) keep the existing visual hierarchy.

import { useEffect, useId, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Package, Boxes, Users, Building2,
  Calculator, BarChart3, Settings, Tag, Heart, PieChart, Shield,
  ChefHat, BookOpen, ClipboardList, GitCommitHorizontal, BellRing, MapPin, Store,
  Receipt, ShieldCheck, CalendarDays, Mail, FileText, Clock4, AlertTriangle, FileSpreadsheet,
  Printer, Network, Coins, Scale, Banknote, Layers3,
  LineChart, Sparkles, Megaphone, Cake,
  ClipboardCheck, TrendingUp, Signature, ShoppingBag,
  Calendar, ShoppingCart, Truck, ListChecks,
  ChevronRight,
  type LucideIcon,
} from 'lucide-react';
import { BrandMark, SectionLabel, cn } from '@breakery/ui';
import type { PermissionCode } from '@breakery/supabase';
import { useAuthStore } from '@/stores/authStore.js';
import { AlertsBadge } from '@/features/inventory-alerts/components/AlertsBadge.js';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  permission?: PermissionCode;
  /** 0 = top-level, 1 = nested visual indent. */
  indent?: 0 | 1;
}

interface NavSubgroup {
  label: string;
  items: NavItem[];
}

type NavGroup =
  | { label: string; items: NavItem[] }
  | { label: string; subgroups: NavSubgroup[] };

const GROUPS: NavGroup[] = [
  {
    label: 'Operations',
    items: [
      { to: '/backoffice', label: 'Dashboard', icon: LayoutDashboard, end: true },
      { to: '/backoffice/print-queue', label: 'Print Queue', icon: Printer, permission: 'print_queue.read' },
    ],
  },
  {
    label: 'Sales',
    items: [
      { to: '/backoffice/orders', label: 'Orders', icon: ShoppingBag, permission: 'orders.read', end: true },
      { to: '/backoffice/customers', label: 'Customers', icon: Users, permission: 'customers.read', end: true },
      { to: '/backoffice/customers/categories', label: 'Customer Categories', icon: Tag, permission: 'customer_categories.read', indent: 1 },
      { to: '/backoffice/b2b', label: 'B2B Wholesale', icon: Building2, permission: 'customers.read', end: true },
      { to: '/backoffice/b2b/payments', label: 'Payments', icon: Banknote, permission: 'customers.read', indent: 1 },
      { to: '/backoffice/b2b/settings', label: 'B2B Credit Settings', icon: Settings, permission: 'settings.read', indent: 1 },
      { to: '/backoffice/promotions', label: 'Promotions', icon: Megaphone, permission: 'promotions.read' },
      { to: '/backoffice/loyalty', label: 'Loyalty', icon: Heart, permission: 'loyalty.read' },
    ],
  },
  {
    label: 'Purchase',
    items: [
      { to: '/backoffice/purchasing/purchase-orders', label: 'Purchase Orders', icon: ClipboardCheck, permission: 'purchasing.po.read' as never },
      { to: '/backoffice/suppliers', label: 'Suppliers', icon: Building2, permission: 'suppliers.read' },
    ],
  },
  {
    label: 'Stock Management',
    items: [
      { to: '/backoffice/products', label: 'Products', icon: Package, end: true },
      { to: '/backoffice/categories', label: 'Product Categories', icon: Tag, permission: 'categories.read', indent: 1 },
      { to: '/backoffice/inventory', label: 'Stock & Inventory', icon: Boxes, permission: 'inventory.read', end: true },
      { to: '/backoffice/inventory/recipes', label: 'Recipes', icon: BookOpen, permission: 'inventory.read', indent: 1 },
      { to: '/backoffice/inventory/production', label: 'Production', icon: ChefHat, permission: 'inventory.read', indent: 1 },
      { to: '/backoffice/inventory/opname', label: 'Opname', icon: ClipboardList, permission: 'inventory.read', indent: 1 },
      { to: '/backoffice/inventory/movements', label: 'Live Movements', icon: GitCommitHorizontal, permission: 'inventory.read', indent: 1 },
      { to: '/backoffice/inventory/display', label: 'Display Stock (Vitrine)', icon: Store, permission: 'display.read', indent: 1 },
      { to: '/backoffice/inventory/alerts', label: 'Alerts', icon: BellRing, permission: 'inventory.read', indent: 1 },
      { to: '/backoffice/inventory/sections', label: 'Sections', icon: MapPin, permission: 'inventory.read', indent: 1 },
    ],
  },
  {
    label: 'Finance',
    subgroups: [
      {
        label: 'Expenses',
        items: [
          { to: '/backoffice/expenses', label: 'Expenses', icon: Receipt, permission: 'expenses.read' },
          { to: '/backoffice/settings/expense-thresholds', label: 'Expense Thresholds', icon: Scale, permission: 'expenses.thresholds.read' },
        ],
      },
      {
        label: 'Accounting',
        items: [
          { to: '/backoffice/accounting/chart-of-accounts', label: 'Chart of Accounts', icon: BookOpen, permission: 'accounting.coa.read' },
          { to: '/backoffice/accounting/journal-entries', label: 'Journal Entries', icon: ClipboardList, permission: 'accounting.gl.read' },
          { to: '/backoffice/accounting/general-ledger', label: 'General Ledger', icon: LineChart, permission: 'accounting.gl.read' },
          { to: '/backoffice/accounting/trial-balance', label: 'Trial Balance', icon: Scale, permission: 'accounting.tb.read' },
          { to: '/backoffice/accounting/mappings', label: 'Account Mappings', icon: GitCommitHorizontal, permission: 'accounting.read' },
          { to: '/backoffice/settings/accounting', label: 'Fiscal Periods', icon: Calculator, permission: 'accounting.period.close' },
          { to: '/backoffice/cash-register/zreports', label: 'Cash Closing (Z-Reports)', icon: Signature, permission: 'zreports.read' as never },
        ],
      },
    ],
  },
  {
    label: 'Reports',
    subgroups: [
      {
        label: '',
        items: [
          { to: '/backoffice/reports', label: 'Reports Hub', icon: BarChart3, permission: 'reports.read', end: true },
        ],
      },
      {
        label: 'Sales reports',
        items: [
          { to: '/backoffice/reports/sales-by-hour', label: 'Sales by Hour', icon: BarChart3, permission: 'reports.sales.read' },
          { to: '/backoffice/reports/sales-by-category', label: 'Sales by Category', icon: PieChart, permission: 'reports.sales.read' },
          { to: '/backoffice/reports/sales-by-staff', label: 'Sales by Staff', icon: Users, permission: 'reports.sales.read' },
          { to: '/backoffice/reports/basket-analysis', label: 'Basket Analysis', icon: Layers3, permission: 'reports.sales.read' },
          { to: '/backoffice/reports/daily-sales', label: 'Daily Sales', icon: Calendar, permission: 'reports.sales.read' },
          { to: '/backoffice/reports/staff-performance', label: 'Staff Performance', icon: Users, permission: 'reports.sales.read' },
          { to: '/backoffice/reports/payment-by-method', label: 'Payment by Method', icon: Receipt, permission: 'reports.financial.read' as PermissionCode },
        ],
      },
      {
        label: 'Inventory reports',
        items: [
          { to: '/backoffice/reports/stock-variance', label: 'Stock Variance', icon: Boxes, permission: 'reports.inventory.read' },
          { to: '/backoffice/reports/stock-movements', label: 'Stock Movement History', icon: GitCommitHorizontal, permission: 'reports.inventory.read' as PermissionCode },
          { to: '/backoffice/reports/wastage', label: 'Wastage & Spoilage', icon: AlertTriangle, permission: 'reports.inventory.read' as PermissionCode },
          { to: '/backoffice/reports/perishable-turnover', label: 'Perishable Turnover', icon: Clock4, permission: 'reports.inventory.read' as PermissionCode },
          { to: '/backoffice/reports/recipe-cost', label: 'Recipe Cost', icon: TrendingUp, permission: 'reports.financial.read' },
          { to: '/backoffice/reports/production-report', label: 'Production Report', icon: BarChart3, permission: 'reports.inventory.read' as PermissionCode },
          { to: '/backoffice/reports/production-efficiency', label: 'Production Efficiency', icon: TrendingUp, permission: 'reports.inventory.read' as PermissionCode },
        ],
      },
      {
        label: 'Purchase reports',
        items: [
          { to: '/backoffice/reports/purchase-items', label: 'Purchase Items', icon: ShoppingCart, permission: 'reports.inventory.read' as PermissionCode },
          { to: '/backoffice/reports/purchase-by-date', label: 'Purchase by Date', icon: Calendar, permission: 'reports.inventory.read' as PermissionCode },
          { to: '/backoffice/reports/purchase-by-supplier', label: 'Purchase by Supplier', icon: Truck, permission: 'reports.inventory.read' as PermissionCode },
        ],
      },
      {
        label: 'Financial reports',
        items: [
          { to: '/backoffice/reports/profit-loss', label: 'Profit & Loss', icon: Coins, permission: 'reports.financial.read' },
          { to: '/backoffice/reports/balance-sheet', label: 'Balance Sheet', icon: Scale, permission: 'reports.financial.read' },
          { to: '/backoffice/reports/cash-flow', label: 'Cash Flow', icon: Banknote, permission: 'reports.financial.read' },
          { to: '/backoffice/reports/pb1', label: 'VAT / PB1', icon: FileSpreadsheet, permission: 'reports.financial.read' as PermissionCode },
        ],
      },
      {
        label: 'Marketing reports',
        items: [
          { to: '/backoffice/marketing/cohort', label: 'Cohorts', icon: LineChart, permission: 'reports.read' },
          { to: '/backoffice/marketing/segments', label: 'Segments', icon: Sparkles, permission: 'reports.read' },
          { to: '/backoffice/marketing/promo-roi', label: 'Promo ROI', icon: Megaphone, permission: 'reports.read' },
          { to: '/backoffice/marketing/birthday', label: 'Birthdays', icon: Cake, permission: 'reports.read' },
        ],
      },
      {
        label: 'Audit',
        items: [
          { to: '/backoffice/reports/audit', label: 'Audit Log', icon: Shield, permission: 'reports.audit.read' },
          { to: '/backoffice/reports/price-changes', label: 'Price Changes', icon: ListChecks, permission: 'reports.financial.read' as PermissionCode },
          { to: '/backoffice/reports/permission-changes', label: 'Permission Change Log', icon: Shield, permission: 'reports.audit.read' as PermissionCode },
        ],
      },
    ],
  },
  {
    label: 'Settings',
    subgroups: [
      {
        label: '',
        items: [
          { to: '/backoffice/settings', label: 'General settings', icon: Settings, permission: 'settings.read', end: true },
          { to: '/backoffice/settings/holidays', label: 'Holidays', icon: CalendarDays, permission: 'settings.read' },
          { to: '/backoffice/settings/templates/email', label: 'Email Templates', icon: Mail, permission: 'settings.read' },
          { to: '/backoffice/settings/templates/receipt', label: 'Receipt Templates', icon: FileText, permission: 'settings.read' },
          { to: '/backoffice/settings/permissions', label: 'Permissions Matrix (read-only)', icon: ShieldCheck, permission: 'settings.read' },
        ],
      },
      {
        label: 'Devices',
        items: [
          { to: '/backoffice/lan-devices', label: 'LAN Devices', icon: Network, permission: 'lan.devices.read' },
        ],
      },
      {
        label: 'Users & Access',
        items: [
          { to: '/backoffice/users', label: 'Users', icon: Users, permission: 'users.read', end: true },
          { to: '/backoffice/users/permissions', label: 'RBAC Editor', icon: ShieldCheck, permission: 'rbac.read' },
        ],
      },
    ],
  },
];

const SUBGROUP_STORAGE_KEY = 'bo:sidebar:subgroups';
/** Top-level category open/closed state (collapsible accordion). */
const GROUP_STORAGE_KEY = 'bo:sidebar:groups';

function readStringSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((x): x is string => typeof x === 'string'));
  } catch {
    return new Set();
  }
}

const readOpenSubgroups = (): Set<string> => readStringSet(SUBGROUP_STORAGE_KEY);
const readOpenGroups = (): Set<string> => readStringSet(GROUP_STORAGE_KEY);

/** NavLink-equivalent active matching used to auto-open the owning category. */
function routeMatches(to: string, end: boolean | undefined, pathname: string): boolean {
  if (end === true) return pathname === to;
  return pathname === to || pathname.startsWith(`${to}/`);
}

/**
 * Returns the label of the top-level category that owns the active route, or
 * null. Picks the longest matching `to` so deep links resolve to the right
 * group (e.g. /backoffice/inventory/recipes → Stock Management, not Operations).
 */
function findActiveGroupLabel(
  groups: {
    label: string;
    items?: NavItem[] | undefined;
    subgroups?: NavSubgroup[] | undefined;
  }[],
  pathname: string,
): string | null {
  let best: { len: number; label: string } | null = null;
  for (const g of groups) {
    const items: NavItem[] = g.items ?? (g.subgroups ?? []).flatMap((sg) => sg.items);
    for (const it of items) {
      if (routeMatches(it.to, it.end, pathname) && (best === null || it.to.length > best.len)) {
        best = { len: it.to.length, label: g.label };
      }
    }
  }
  return best === null ? null : best.label;
}

/**
 * Shared collapsible primitive — one component for both the top-level category
 * headers (`variant="group"`, beige pill header) and the inner named subgroups
 * (`variant="subgroup"`). The chevron pivots via rotate-90; the panel is wired
 * to the trigger with aria-expanded / aria-controls.
 */
function Collapsible({
  title,
  isOpen,
  onToggle,
  variant,
  children,
}: {
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  variant: 'group' | 'subgroup';
  children: ReactNode;
}) {
  const panelId = useId();
  const chevron = (size: string) => (
    <ChevronRight
      className={cn(size, 'shrink-0 transition-transform', isOpen && 'rotate-90')}
      aria-hidden
    />
  );

  const trigger =
    variant === 'group' ? (
      <SectionLabel as="h2" size="xs" className="px-2">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={isOpen}
          aria-controls={panelId}
          className="w-full flex items-center justify-between gap-2 rounded-md bg-surface-4 px-3 py-2.5 text-text-muted transition-colors hover:bg-gold-soft hover:text-text-primary"
        >
          <span className="truncate">{title}</span>
          {chevron('h-4 w-4')}
        </button>
      </SectionLabel>
    ) : (
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-controls={panelId}
        className="w-full flex items-center justify-between px-6 pt-3 pb-1 text-[10px] uppercase tracking-wider text-text-muted/70 hover:text-text-primary transition-colors"
      >
        <span>{title}</span>
        {chevron('h-3 w-3')}
      </button>
    );

  return (
    <>
      {trigger}
      <div id={panelId} hidden={!isOpen} className={variant === 'group' ? 'mt-1' : undefined}>
        {isOpen && children}
      </div>
    </>
  );
}

function NavItemLink({ item }: { item: NavItem }) {
  const Icon = item.icon;
  const indented = item.indent === 1;
  const baseClass = cn(
    'flex items-center gap-3 py-2 text-sm transition-colors',
    indented ? 'pl-9 pr-4 text-xs' : 'px-4',
  );

  return (
    <NavLink
      to={item.to}
      {...(item.end === true ? { end: true } : {})}
      className={({ isActive }) =>
        cn(
          baseClass,
          isActive
            ? 'bg-gold-soft text-gold border-r-2 border-gold'
            : 'text-text-secondary hover:text-text-primary hover:bg-bg-overlay',
        )
      }
    >
      <Icon className={indented ? 'h-3.5 w-3.5' : 'h-4 w-4'} aria-hidden />
      {item.label}
    </NavLink>
  );
}

export function Sidebar() {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const { pathname } = useLocation();

  // Inner named-subgroup open/closed state (existing behaviour, unchanged).
  const [openSubgroups, setOpenSubgroups] = useState<Set<string>>(readOpenSubgroups);

  useEffect(() => {
    try {
      localStorage.setItem(SUBGROUP_STORAGE_KEY, JSON.stringify([...openSubgroups]));
    } catch {
      /* quota exceeded or private mode — fail silent */
    }
  }, [openSubgroups]);

  const toggleSubgroup = (key: string) => {
    setOpenSubgroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  type VisibleGroup =
    | { label: string; items: NavItem[]; subgroups?: undefined }
    | { label: string; subgroups: NavSubgroup[]; items?: undefined };

  const filterItems = (items: NavItem[]): NavItem[] =>
    items.filter((n) => n.permission === undefined || hasPermission(n.permission));

  const visibleGroups: VisibleGroup[] = GROUPS.flatMap((g): VisibleGroup[] => {
    if ('items' in g) {
      const items = filterItems(g.items);
      return items.length > 0 ? [{ label: g.label, items }] : [];
    }
    const subgroups = g.subgroups
      .map((sg) => ({ label: sg.label, items: filterItems(sg.items) }))
      .filter((sg) => sg.items.length > 0);
    return subgroups.length > 0 ? [{ label: g.label, subgroups }] : [];
  });

  // Top-level category open/closed state (collapsible accordion). Default is
  // collapsed; the category owning the active route is auto-opened on load and
  // whenever the active route moves into a different category.
  const activeGroupLabel = findActiveGroupLabel(visibleGroups, pathname);

  const [openGroups, setOpenGroups] = useState<Set<string>>(() => {
    const stored = readOpenGroups();
    if (activeGroupLabel !== null) stored.add(activeGroupLabel);
    return stored;
  });

  useEffect(() => {
    if (activeGroupLabel === null) return;
    setOpenGroups((prev) => {
      if (prev.has(activeGroupLabel)) return prev;
      const next = new Set(prev);
      next.add(activeGroupLabel);
      return next;
    });
  }, [activeGroupLabel]);

  useEffect(() => {
    try {
      localStorage.setItem(GROUP_STORAGE_KEY, JSON.stringify([...openGroups]));
    } catch {
      /* quota exceeded or private mode — fail silent */
    }
  }, [openGroups]);

  const toggleGroup = (label: string) => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  return (
    <aside
      aria-label="Backoffice navigation"
      className="w-60 shrink-0 bg-bg-elevated border-r border-border-subtle flex flex-col"
    >
      <div className="px-4 py-5 border-b border-border-subtle flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BrandMark size="sm" />
          <div className="leading-tight">
            <div className="font-serif text-base text-text-primary">The Breakery</div>
            <div className="text-[10px] text-text-secondary uppercase tracking-widest">
              Backoffice
            </div>
          </div>
        </div>
        {hasPermission('inventory.read') && <AlertsBadge />}
      </div>

      <nav className="flex-1 py-4 overflow-y-auto" aria-label="Primary">
        {visibleGroups.map((group) => (
          <div key={group.label} className="mb-3">
            <Collapsible
              title={group.label}
              isOpen={openGroups.has(group.label)}
              onToggle={() => toggleGroup(group.label)}
              variant="group"
            >
              {'items' in group && group.items !== undefined ? (
                <div className="space-y-0.5 pt-1">
                  {group.items.map((item) => (
                    <NavItemLink key={item.to} item={item} />
                  ))}
                </div>
              ) : (
                group.subgroups!.map((sg) => {
                  const key = `${group.label}::${sg.label}`;
                  // Unnamed subgroup ('') has no toggle — its items render
                  // directly whenever the parent category is open.
                  if (sg.label === '') {
                    return (
                      <div key={key} className="space-y-0.5 pt-1">
                        {sg.items.map((item) => (
                          <NavItemLink key={item.to} item={item} />
                        ))}
                      </div>
                    );
                  }
                  return (
                    <div key={key} className="mb-1">
                      <Collapsible
                        title={sg.label}
                        isOpen={openSubgroups.has(key)}
                        onToggle={() => toggleSubgroup(key)}
                        variant="subgroup"
                      >
                        <div className="space-y-0.5">
                          {sg.items.map((item) => (
                            <NavItemLink key={item.to} item={item} />
                          ))}
                        </div>
                      </Collapsible>
                    </div>
                  );
                })
              )}
            </Collapsible>
          </div>
        ))}
      </nav>
    </aside>
  );
}
