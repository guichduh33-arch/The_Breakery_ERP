// apps/backoffice/src/layouts/Sidebar.tsx
//
// Session 14 / Phase 4.A — Backoffice global sidebar.
//
// Grouped navigation matching docs/Design/backoffice/Dashboard.jpg:
//   - BrandMark + AlertsBadge in header
//   - OPERATIONS  — Dashboard, POS Terminal, Kitchen Display
//   - MANAGEMENT  — Products, Stock & Inventory, Order History, B2B, Purchases,
//                   Suppliers, Expenses, Customers
//   - ADMIN       — Reports, Accounting, Users, Settings (collapsed groups in
//                   future — for now we render all visible items)
//
// Each group renders an uppercase SectionLabel (group name). Items are
// permission-filtered via the auth store — empty groups are hidden so the
// sidebar stays clean for non-owner roles.
//
// Indented sub-items (e.g. inventory subpages) keep the existing visual
// hierarchy from the legacy layout.

import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Package, Boxes, ShoppingCart, Users, Building2,
  Calculator, BarChart3, Settings, Tag, Heart, PieChart, Shield,
  ChefHat, BookOpen, ClipboardList, GitCommitHorizontal, BellRing, MapPin,
  Receipt, ShieldCheck, UserPlus, CalendarDays, Mail, FileText,
  Printer, Network, Coins, Scale, Banknote, Layers3,
  LineChart, Sparkles, Megaphone, Cake, Monitor, ChefHat as KitchenIcon,
  ClipboardCheck, TrendingUp, Signature,
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
  /** External link (e.g. POS / KDS in another app). */
  external?: boolean;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const GROUPS: NavGroup[] = [
  {
    label: 'Operations',
    items: [
      { to: '/backoffice', label: 'Dashboard', icon: LayoutDashboard, end: true },
      { to: '/pos', label: 'POS Terminal', icon: Monitor, external: true },
      { to: '/kds', label: 'Kitchen Display', icon: KitchenIcon, external: true },
    ],
  },
  {
    label: 'Management',
    items: [
      { to: '/backoffice/products', label: 'Products', icon: Package, end: true },
      { to: '/backoffice/categories', label: 'Categories', icon: Tag, permission: 'categories.read', indent: 1 },
      { to: '/backoffice/promotions', label: 'Promotions', icon: Tag, permission: 'promotions.read' },
      { to: '/backoffice/loyalty', label: 'Loyalty', icon: Heart, permission: 'loyalty.read' },
      { to: '/backoffice/inventory', label: 'Stock & Inventory', icon: Boxes, permission: 'inventory.read', end: true },
      { to: '/backoffice/inventory/production', label: 'Production', icon: ChefHat, permission: 'inventory.read', indent: 1 },
      { to: '/backoffice/inventory/recipes', label: 'Recipes', icon: BookOpen, permission: 'inventory.read', indent: 1 },
      { to: '/backoffice/inventory/opname', label: 'Opname', icon: ClipboardList, permission: 'inventory.read', indent: 1 },
      { to: '/backoffice/inventory/movements', label: 'Movements', icon: GitCommitHorizontal, permission: 'inventory.read', indent: 1 },
      { to: '/backoffice/inventory/alerts', label: 'Alerts', icon: BellRing, permission: 'inventory.read', indent: 1 },
      { to: '/backoffice/inventory/sections', label: 'Sections', icon: MapPin, permission: 'inventory.read', indent: 1 },
      { to: '/backoffice/customers', label: 'Customers', icon: Users, permission: 'customers.read', end: true },
      { to: '/backoffice/customers/categories', label: 'Categories', icon: Tag, permission: 'customer_categories.read', indent: 1 },
      { to: '/backoffice/b2b', label: 'B2B Wholesale', icon: Building2, permission: 'customers.read', end: true },
      { to: '/backoffice/b2b/payments', label: 'Payments', icon: Banknote, permission: 'customers.read', indent: 1 },
      { to: '/backoffice/b2b/settings', label: 'Settings', icon: Settings, permission: 'settings.read', indent: 1 },
      { to: '/backoffice/purchasing', label: 'Purchases', icon: ShoppingCart, permission: 'purchasing.po.read' as never, end: true },
      { to: '/backoffice/purchasing/purchase-orders', label: 'Purchase Orders', icon: ClipboardCheck, permission: 'purchasing.po.read' as never, indent: 1 },
      { to: '/backoffice/suppliers', label: 'Suppliers', icon: Building2, permission: 'suppliers.read' },
      { to: '/backoffice/expenses', label: 'Expenses', icon: Receipt, permission: 'expenses.read' },
      { to: '/backoffice/cash-register/zreports', label: 'Z-Reports', icon: Signature, permission: 'zreports.read' as never },
    ],
  },
  {
    label: 'Admin',
    items: [
      { to: '/backoffice/reports', label: 'Reports', icon: BarChart3, permission: 'reports.read', end: true },
      { to: '/backoffice/reports/sales-by-hour', label: 'Sales by Hour', icon: BarChart3, permission: 'reports.sales.read', indent: 1 },
      { to: '/backoffice/reports/sales-by-category', label: 'Sales by Category', icon: PieChart, permission: 'reports.sales.read', indent: 1 },
      { to: '/backoffice/reports/sales-by-staff', label: 'Sales by Staff', icon: Users, permission: 'reports.sales.read', indent: 1 },
      { to: '/backoffice/reports/stock-variance', label: 'Stock Variance', icon: Boxes, permission: 'reports.inventory.read', indent: 1 },
      { to: '/backoffice/reports/audit', label: 'Audit Log', icon: Shield, permission: 'reports.audit.read', indent: 1 },
      { to: '/backoffice/reports/profit-loss', label: 'Profit & Loss', icon: Coins, permission: 'reports.financial.read', indent: 1 },
      { to: '/backoffice/reports/balance-sheet', label: 'Balance Sheet', icon: Scale, permission: 'reports.financial.read', indent: 1 },
      { to: '/backoffice/reports/cash-flow', label: 'Cash Flow', icon: Banknote, permission: 'reports.financial.read', indent: 1 },
      { to: '/backoffice/reports/basket-analysis', label: 'Basket Analysis', icon: Layers3, permission: 'reports.sales.read', indent: 1 },
      { to: '/backoffice/reports/recipe-cost', label: 'Recipe Cost', icon: TrendingUp, permission: 'reports.financial.read', indent: 1 },
      { to: '/backoffice/marketing/cohort', label: 'Cohorts', icon: LineChart, permission: 'reports.read' },
      { to: '/backoffice/marketing/segments', label: 'Segments', icon: Sparkles, permission: 'reports.read' },
      { to: '/backoffice/marketing/promo-roi', label: 'Promo ROI', icon: Megaphone, permission: 'reports.read' },
      { to: '/backoffice/marketing/birthday', label: 'Birthdays', icon: Cake, permission: 'reports.read' },
      { to: '/backoffice/accounting', label: 'Accounting', icon: Calculator, end: true },
      { to: '/backoffice/accounting/chart-of-accounts', label: 'Chart of Accounts', icon: BookOpen, permission: 'accounting.coa.read', indent: 1 },
      { to: '/backoffice/accounting/journal-entries', label: 'Journal Entries', icon: ClipboardList, permission: 'accounting.gl.read', indent: 1 },
      { to: '/backoffice/accounting/general-ledger', label: 'General Ledger', icon: LineChart, permission: 'accounting.gl.read', indent: 1 },
      { to: '/backoffice/accounting/trial-balance', label: 'Trial Balance', icon: Scale, permission: 'accounting.tb.read', indent: 1 },
      { to: '/backoffice/accounting/mappings', label: 'Mappings', icon: GitCommitHorizontal, permission: 'accounting.read', indent: 1 },
      { to: '/backoffice/users', label: 'Users', icon: Users, permission: 'users.read', end: true },
      { to: '/backoffice/users/new', label: 'New user', icon: UserPlus, permission: 'users.create', indent: 1 },
      { to: '/backoffice/users/permissions', label: 'Permissions', icon: ShieldCheck, permission: 'rbac.read', indent: 1 },
      { to: '/backoffice/settings', label: 'Settings', icon: Settings, permission: 'settings.read', end: true },
      { to: '/backoffice/settings/holidays', label: 'Holidays', icon: CalendarDays, permission: 'settings.read', indent: 1 },
      { to: '/backoffice/settings/templates/email', label: 'Email templates', icon: Mail, permission: 'settings.read', indent: 1 },
      { to: '/backoffice/settings/templates/receipt', label: 'Receipt templates', icon: FileText, permission: 'settings.read', indent: 1 },
      { to: '/backoffice/settings/permissions', label: 'Permissions', icon: ShieldCheck, permission: 'settings.read', indent: 1 },
      { to: '/backoffice/settings/accounting', label: 'Fiscal Periods', icon: Calculator, permission: 'accounting.period.close', indent: 1 },
      { to: '/backoffice/settings/expense-thresholds', label: 'Expense Thresholds', icon: Scale, permission: 'expenses.thresholds.read', indent: 1 },
      { to: '/backoffice/print-queue', label: 'Print Queue', icon: Printer, permission: 'print_queue.read' },
      { to: '/backoffice/lan-devices', label: 'LAN Devices', icon: Network, permission: 'lan.devices.read' },
    ],
  },
];

function NavItemLink({ item }: { item: NavItem }) {
  const Icon = item.icon;
  const indented = item.indent === 1;
  const baseClass = cn(
    'flex items-center gap-3 py-2 text-sm transition-colors',
    indented ? 'pl-9 pr-4 text-xs' : 'px-4',
  );

  if (item.external === true) {
    return (
      <a
        href={item.to}
        className={cn(
          baseClass,
          'text-text-secondary hover:text-text-primary hover:bg-bg-overlay',
        )}
      >
        <Icon className={indented ? 'h-3.5 w-3.5' : 'h-4 w-4'} aria-hidden />
        {item.label}
      </a>
    );
  }

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

  const visibleGroups = GROUPS.map((g) => ({
    label: g.label,
    items: g.items.filter(
      (n) => n.permission === undefined || hasPermission(n.permission),
    ),
  })).filter((g) => g.items.length > 0);

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
          <div key={group.label} className="mb-5">
            <SectionLabel
              as="h2"
              size="xs"
              className="px-4 mb-2 text-text-muted"
            >
              {group.label}
            </SectionLabel>
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <NavItemLink key={item.to} item={item} />
              ))}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  );
}
