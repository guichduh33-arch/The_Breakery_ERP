// apps/pos/src/features/reports/components/POSReportsLayout.tsx
//
// Session 14 — Phase 2.D — Shared chrome for the 3 POS report pages:
//   /pos/reports             → Overview (today's KPIs + sales-by-hour)
//   /pos/reports/products    → Top products
//   /pos/reports/activity    → Event timeline
//
// Visual refs: 82-overview-today / 83-products-month / 84-activity-month.
//
// Header per ref: gold icon, "POS Reports" title, subtitle = period label,
// close (back to /pos). Below: period chips (Today / Yesterday / Last 7
// days / This week / This month / Custom). Below that: tab nav.

import { type JSX, type ReactNode } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { X, BarChart3, Activity, Package, Wallet, Ban, Layers, PieChart, TrendingUp, type LucideIcon } from 'lucide-react';
import { Button, cn } from '@breakery/ui';
import type { PermissionCode } from '@breakery/supabase';
import { useAuthStore } from '@/stores/authStore';
import { useReportsPeriod, type ReportsPeriod } from '../hooks/useReportsPeriod';

type POSReportsTab = 'overview' | 'payments' | 'voids' | 'sessions' | 'mix' | 'products' | 'activity' | 'margin';

export interface POSReportsLayoutProps {
  /** Active tab; controlled by the route currently rendered. */
  activeTab: POSReportsTab;
  /** Renders the period-scoped content. */
  children: (period: ReportsPeriod) => ReactNode;
}

// `permission`: tab hidden unless the caller holds it (Margin = financial data,
// not for every sales reader — mirrors the RPC gate).
const TABS: { id: POSReportsTab; label: string; path: string; icon: LucideIcon; permission?: PermissionCode }[] = [
  { id: 'overview', label: 'Overview', path: '/pos/reports', icon: BarChart3 },
  { id: 'payments', label: 'Payments', path: '/pos/reports/payments', icon: Wallet },
  { id: 'voids', label: 'Voids', path: '/pos/reports/voids', icon: Ban },
  { id: 'sessions', label: 'Sessions', path: '/pos/reports/sessions', icon: Layers },
  { id: 'mix', label: 'Mix', path: '/pos/reports/mix', icon: PieChart },
  { id: 'products', label: 'Products', path: '/pos/reports/products', icon: Package },
  { id: 'margin', label: 'Margin', path: '/pos/reports/margin', icon: TrendingUp, permission: 'reports.financial.read' },
  { id: 'activity', label: 'Activity', path: '/pos/reports/activity', icon: Activity },
];

export function POSReportsLayout({ activeTab, children }: POSReportsLayoutProps): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const { period, setPreset, presets, labelOf } = useReportsPeriod('today');
  const visibleTabs = TABS.filter((t) => !t.permission || hasPermission(t.permission));

  return (
    <div className="h-screen flex flex-col bg-bg-base text-text-primary">
      <header className="h-16 px-6 flex items-center justify-between border-b border-border-subtle bg-bg-elevated">
        <div className="flex items-center gap-3">
          <div
            aria-hidden
            className="h-10 w-10 inline-flex items-center justify-center rounded-md bg-gold-soft text-gold"
          >
            <BarChart3 className="h-5 w-5" />
          </div>
          <div>
            <h1 className="font-display text-lg">POS Reports</h1>
            <p className="text-text-secondary text-xs">{period.label}</p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Close reports"
          onClick={() => navigate('/pos')}
          data-testid="pos-reports-close"
        >
          <X className="h-5 w-5" aria-hidden />
        </Button>
      </header>

      <div className="px-6 py-3 flex items-center gap-2 overflow-x-auto border-b border-border-subtle">
        {presets.map((p) => (
          <PeriodChip
            key={p}
            label={labelOf(p)}
            active={period.preset === p}
            onClick={() => setPreset(p)}
          />
        ))}
      </div>

      <nav
        aria-label="Reports tabs"
        className="px-6 flex items-center gap-1 border-b border-border-subtle"
      >
        {visibleTabs.map((t) => {
          const Icon = t.icon;
          const isActive = location.pathname === t.path || activeTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => navigate(t.path)}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'inline-flex items-center gap-2 px-4 h-12 -mb-px',
                'border-b-2 transition-colors motion-reduce:transition-none',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold focus-visible:outline-offset-[-2px]',
                isActive
                  ? 'border-gold text-gold'
                  : 'border-transparent text-text-secondary hover:text-text-primary',
              )}
            >
              <Icon className="h-4 w-4" aria-hidden />
              <span className="text-sm font-semibold">{t.label}</span>
            </button>
          );
        })}
      </nav>

      <main className="flex-1 overflow-y-auto p-6">{children(period)}</main>
    </div>
  );
}

function PeriodChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center px-3 h-8 rounded-full border text-xs font-semibold whitespace-nowrap',
        'transition-colors motion-reduce:transition-none',
        active
          ? 'bg-gold-soft border-gold text-gold'
          : 'bg-bg-elevated border-border-subtle text-text-secondary hover:text-text-primary',
      )}
    >
      {label}
    </button>
  );
}
