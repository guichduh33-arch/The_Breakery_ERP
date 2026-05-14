// apps/backoffice/src/layouts/BackofficeLayout.tsx
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Package, Boxes, ShoppingCart, Users, Building2,
  Calculator, BarChart3, Settings, LogOut, Tag, Heart, PieChart, Shield,
  ChefHat, BookOpen, ClipboardList, GitCommitHorizontal, BellRing, MapPin,
  Receipt, ShieldCheck, UserPlus, CalendarDays, Mail, FileText,
  Printer, Network, Coins, Scale, Banknote, Layers3,
  LineChart, Sparkles, Megaphone, Cake,
  type LucideIcon,
} from 'lucide-react';
import { Button, cn } from '@breakery/ui';
import type { PermissionCode } from '@breakery/supabase';
import { useAuthStore } from '@/stores/authStore.js';
import { AlertsBadge } from '@/features/inventory-alerts/components/AlertsBadge.js';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  permission?: PermissionCode;
  /**
   * Indent level. 0 = top-level, 1 = nested under the previous group.
   * Used only for visual hierarchy in the sidebar.
   */
  indent?: 0 | 1;
}

const NAV: NavItem[] = [
  { to: '/backoffice',            label: 'Dashboard',  icon: LayoutDashboard, end: true },
  { to: '/backoffice/products',   label: 'Products',   icon: Package },
  { to: '/backoffice/promotions', label: 'Promotions', icon: Tag, permission: 'promotions.read' },
  { to: '/backoffice/loyalty',    label: 'Loyalty',    icon: Heart, permission: 'loyalty.read' },
  { to: '/backoffice/inventory',  label: 'Inventory',  icon: Boxes, permission: 'inventory.read', end: true },
  { to: '/backoffice/inventory/production', label: 'Production', icon: ChefHat,        permission: 'inventory.read', indent: 1 },
  { to: '/backoffice/inventory/recipes',    label: 'Recipes',    icon: BookOpen,       permission: 'inventory.read', indent: 1 },
  { to: '/backoffice/inventory/opname',     label: 'Opname',     icon: ClipboardList,  permission: 'inventory.read', indent: 1 },
  { to: '/backoffice/inventory/movements',  label: 'Movements',  icon: GitCommitHorizontal, permission: 'inventory.read', indent: 1 },
  { to: '/backoffice/inventory/alerts',     label: 'Alerts',     icon: BellRing,       permission: 'inventory.read', indent: 1 },
  { to: '/backoffice/inventory/sections',   label: 'Sections',   icon: MapPin,         permission: 'inventory.read', indent: 1 },
  { to: '/backoffice/purchasing', label: 'Purchasing', icon: ShoppingCart, permission: 'purchasing.po.read' as never, end: true },
  { to: '/backoffice/purchasing/purchase-orders', label: 'Purchase Orders', icon: ShoppingCart, permission: 'purchasing.po.read' as never, indent: 1 },
  { to: '/backoffice/customers',  label: 'Customers',  icon: Users },
  { to: '/backoffice/b2b',        label: 'B2B',        icon: Building2 },
  { to: '/backoffice/accounting',          label: 'Accounting', icon: Calculator, end: true },
  { to: '/backoffice/accounting/mappings', label: 'Mappings',   icon: GitCommitHorizontal, permission: 'accounting.read', indent: 1 },
  { to: '/backoffice/expenses',   label: 'Expenses',   icon: Receipt, permission: 'expenses.read' },
  { to: '/backoffice/reports',    label: 'Reports',    icon: BarChart3, permission: 'reports.read', end: true },
  { to: '/backoffice/reports/sales-by-hour',     label: 'Sales by Hour',     icon: BarChart3, permission: 'reports.sales.read',     indent: 1 },
  { to: '/backoffice/reports/sales-by-category', label: 'Sales by Category', icon: PieChart,  permission: 'reports.sales.read',     indent: 1 },
  { to: '/backoffice/reports/sales-by-staff',    label: 'Sales by Staff',    icon: Users,     permission: 'reports.sales.read',     indent: 1 },
  { to: '/backoffice/reports/stock-variance',    label: 'Stock Variance',    icon: Boxes,     permission: 'reports.inventory.read', indent: 1 },
  { to: '/backoffice/reports/audit',             label: 'Audit Log',         icon: Shield,    permission: 'reports.audit.read',     indent: 1 },
  { to: '/backoffice/reports/profit-loss',       label: 'Profit & Loss',     icon: Coins,     permission: 'reports.financial.read', indent: 1 },
  { to: '/backoffice/reports/balance-sheet',     label: 'Balance Sheet',     icon: Scale,     permission: 'reports.financial.read', indent: 1 },
  { to: '/backoffice/reports/cash-flow',         label: 'Cash Flow',         icon: Banknote,  permission: 'reports.financial.read', indent: 1 },
  { to: '/backoffice/reports/basket-analysis',   label: 'Basket Analysis',   icon: Layers3,   permission: 'reports.sales.read',     indent: 1 },
  { to: '/backoffice/marketing/cohort',          label: 'Cohorts',           icon: LineChart, permission: 'reports.read' },
  { to: '/backoffice/marketing/segments',        label: 'Segments',          icon: Sparkles,  permission: 'reports.read' },
  { to: '/backoffice/marketing/promo-roi',       label: 'Promo ROI',         icon: Megaphone, permission: 'reports.read' },
  { to: '/backoffice/marketing/birthday',        label: 'Birthdays',         icon: Cake,      permission: 'reports.read' },
  { to: '/backoffice/users',         label: 'Users',         icon: Users,        permission: 'users.read', end: true },
  { to: '/backoffice/users/new',     label: 'New user',      icon: UserPlus,     permission: 'users.create', indent: 1 },
  { to: '/backoffice/users/permissions', label: 'Permissions',   icon: ShieldCheck,  permission: 'rbac.read', indent: 1 },
  { to: '/backoffice/settings',                  label: 'Settings',         icon: Settings,    permission: 'settings.read', end: true },
  { to: '/backoffice/settings/holidays',         label: 'Holidays',         icon: CalendarDays, permission: 'settings.read', indent: 1 },
  { to: '/backoffice/settings/templates/email',  label: 'Email templates',  icon: Mail,         permission: 'settings.read', indent: 1 },
  { to: '/backoffice/settings/templates/receipt', label: 'Receipt templates', icon: FileText,   permission: 'settings.read', indent: 1 },
  { to: '/backoffice/settings/permissions',      label: 'Permissions',      icon: ShieldCheck,  permission: 'settings.read', indent: 1 },
  { to: '/backoffice/print-queue',  label: 'Print Queue',  icon: Printer, permission: 'print_queue.read' },
  { to: '/backoffice/lan-devices',  label: 'LAN Devices',  icon: Network, permission: 'lan.devices.read' },
];

export function BackofficeLayout() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const hasPermission = useAuthStore((s) => s.hasPermission);

  const visibleNav = NAV.filter(
    (n) => n.permission === undefined || hasPermission(n.permission),
  );

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="h-screen flex bg-bg-base text-text-primary">
      <aside className="w-56 bg-bg-elevated border-r border-border-subtle flex flex-col">
        <div className="px-4 py-4 border-b border-border-subtle">
          <div className="font-serif text-lg">The Breakery</div>
          <div className="text-xs text-text-secondary uppercase tracking-widest">Backoffice</div>
        </div>
        <nav className="flex-1 py-3 space-y-0.5 overflow-y-auto">
          {visibleNav.map((n) => {
            const Icon = n.icon;
            const indented = n.indent === 1;
            return (
              <NavLink
                key={n.to}
                to={n.to}
                {...(n.end === true ? { end: true } : {})}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 py-2 text-sm transition-colors',
                    indented ? 'pl-9 pr-4 text-xs' : 'px-4',
                    isActive
                      ? 'bg-gold-soft text-gold border-r-2 border-gold'
                      : 'text-text-secondary hover:text-text-primary hover:bg-bg-overlay',
                  )
                }
              >
                <Icon className={indented ? 'h-3.5 w-3.5' : 'h-4 w-4'} aria-hidden />
                {n.label}
              </NavLink>
            );
          })}
        </nav>
        <div className="p-3 border-t border-border-subtle text-xs text-text-secondary">
          <div className="text-text-primary font-semibold">{user?.full_name}</div>
          <div>{user?.role_code}</div>
        </div>
      </aside>

      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="h-12 px-6 flex items-center justify-end gap-2 border-b border-border-subtle bg-bg-elevated">
          {hasPermission('inventory.read') && <AlertsBadge />}
          <Button variant="ghost" size="sm" onClick={() => { void handleLogout(); }}>
            <LogOut className="h-4 w-4 mr-2" aria-hidden /> Logout
          </Button>
        </header>
        <main id="main-content" tabIndex={-1} className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
