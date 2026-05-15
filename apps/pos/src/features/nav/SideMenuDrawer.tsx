// apps/pos/src/features/nav/SideMenuDrawer.tsx
//
// Session 14 — Phase 2.A — Master navigation drawer for the POS shell.
//
// Visual reference: docs/Design/caissapp/87-side-menu-drawer.jpg.
//
// Layout (per ref):
//   ┌──────────────────────────────────┐
//   │  [M] Mamat (Owner)        [✕]   │  ← user header + close
//   │      OWNER                       │
//   ├──────────────────────────────────┤
//   │                                  │
//   │  OPERATIONS                      │  ← section label
//   │  🕓 Held Orders                  │
//   │  📊 Transaction History          │
//   │  📈 POS Reports                  │
//   │  📡 Live Sessions                │
//   │                                  │
//   │  SHIFT                       ⌄  │  ← collapsible group (close shift, etc.)
//   │                                  │
//   │  📦 Cafe Stock                   │
//   │  ⚠  Outstanding Debts            │
//   │  🖥  KDS                         │
//   │                                  │
//   │  SYSTEM                          │
//   │  ⚙  POS Settings                 │
//   │  🔒 Lock Terminal                │
//   └──────────────────────────────────┘
//
// Triggered by the hamburger icon in Pos.tsx top-bar. Sliding panel from
// left, ~300px wide. Uses the shared Sheet primitive for animation +
// focus management.
//
// Per task scope: this component renders the nav and dispatches actions
// (route push, modal open, logout). It does NOT build the destinations
// — pos-aux owns history/reports/debts/etc.

import { useNavigate } from 'react-router-dom';
import {
  History,
  ListOrdered,
  BarChart3,
  Radio,
  Package,
  AlertCircle,
  Monitor,
  Settings,
  Lock,
  Users,
} from 'lucide-react';
import type { JSX, ReactNode } from 'react';
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
  SectionLabel,
  BrandMark,
  cn,
} from '@breakery/ui';

export interface SideMenuDrawerProps {
  open: boolean;
  onClose: () => void;
  /** User name shown in the header. */
  userName?: string | null;
  /** User role label (e.g. "OWNER", "CASHIER"). */
  userRole?: string | null;
  /** Single-character avatar text (defaults to first letter of `userName`). */
  userInitial?: string | null;
  /** Open held-orders modal (lives in Pos.tsx / cart panel). */
  onOpenHeldOrders?: () => void;
  /** Open transaction history (current shift). */
  onOpenHistory?: () => void;
  /** Open the customer list modal. */
  onOpenCustomers?: () => void;
  /** Open the live sessions modal (cashier connections). */
  onOpenLiveSessions?: () => void;
  /** Lock the terminal (force re-auth). */
  onLockTerminal?: () => void;
  /** Sign the cashier out completely. */
  onLogout?: () => void;
}

export function SideMenuDrawer({
  open,
  onClose,
  userName,
  userRole,
  userInitial,
  onOpenHeldOrders,
  onOpenHistory,
  onOpenCustomers,
  onOpenLiveSessions,
  onLockTerminal,
  onLogout,
}: SideMenuDrawerProps): JSX.Element {
  const navigate = useNavigate();
  const initial = (userInitial ?? userName?.trim().charAt(0) ?? 'U').toUpperCase();

  function go(path: string): void {
    onClose();
    navigate(path);
  }

  function dispatch(handler: (() => void) | undefined): void {
    if (handler) {
      onClose();
      // Run in microtask so the sheet has time to start closing before any
      // modal opens — avoids the "modal-over-closing-drawer" flash.
      queueMicrotask(handler);
    }
  }

  return (
    <Sheet open={open} onOpenChange={(o) => (!o ? onClose() : null)}>
      <SheetContent
        side="left"
        className="w-[300px] sm:w-[320px] max-w-none p-0 flex flex-col"
        showClose={false}
        data-testid="pos-side-menu-drawer"
      >
        {/* Accessible title for screen readers — hidden visually since the
            user-card header provides equivalent visual context. */}
        <SheetTitle className="sr-only">Menu</SheetTitle>
        <SheetDescription className="sr-only">
          POS navigation drawer with operations, shift, system, and account actions.
        </SheetDescription>

        {/* User card header */}
        <div className="px-4 pt-4 pb-3 flex items-center gap-3 border-b border-border-subtle">
          <div
            aria-hidden
            className="h-10 w-10 rounded-md bg-gold/80 inline-flex items-center justify-center font-display italic text-gold-fg text-lg"
          >
            {initial}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-text-primary truncate">
              {userName ?? 'Unknown user'}
            </div>
            {userRole && (
              <div className="text-[10px] uppercase tracking-widest text-text-muted">
                {userRole}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="h-9 w-9 inline-flex items-center justify-center rounded-md border border-border-subtle text-text-secondary hover:text-text-primary hover:border-border-strong transition-colors motion-reduce:transition-none focus:outline focus:outline-2 focus:outline-gold focus:outline-offset-2"
          >
            <span aria-hidden className="text-lg leading-none">×</span>
          </button>
        </div>

        {/* Optional brand mark — small, decorative */}
        <div className="px-4 py-3 flex justify-start">
          <BrandMark size="sm" className="opacity-80" />
        </div>

        <nav
          aria-label="POS navigation"
          className="flex-1 overflow-y-auto px-2 pb-4 space-y-4"
        >
          <NavGroup label="Operations">
            <NavLink
              icon={<History className="h-5 w-5" aria-hidden />}
              label="Held Orders"
              onClick={() => dispatch(onOpenHeldOrders)}
              disabled={!onOpenHeldOrders}
            />
            <NavLink
              icon={<ListOrdered className="h-5 w-5" aria-hidden />}
              label="Transaction History"
              onClick={() => dispatch(onOpenHistory)}
              disabled={!onOpenHistory}
            />
            <NavLink
              icon={<BarChart3 className="h-5 w-5" aria-hidden />}
              label="POS Reports"
              onClick={() => go('/pos/reports')}
            />
            <NavLink
              icon={<Radio className="h-5 w-5" aria-hidden />}
              label="Live Sessions"
              onClick={() => dispatch(onOpenLiveSessions)}
              disabled={!onOpenLiveSessions}
            />
            <NavLink
              icon={<Users className="h-5 w-5" aria-hidden />}
              label="Customer List"
              onClick={() => dispatch(onOpenCustomers)}
              disabled={!onOpenCustomers}
            />
          </NavGroup>

          <NavGroup label="Shift">
            <NavLink
              icon={<Package className="h-5 w-5" aria-hidden />}
              label="Cafe Stock"
              onClick={() => go('/pos/stock')}
            />
            <NavLink
              icon={<AlertCircle className="h-5 w-5" aria-hidden />}
              label="Outstanding Debts"
              onClick={() => go('/pos/debts')}
            />
            <NavLink
              icon={<Monitor className="h-5 w-5" aria-hidden />}
              label="KDS"
              onClick={() => go('/kds')}
            />
          </NavGroup>

          <NavGroup label="System">
            <NavLink
              icon={<Settings className="h-5 w-5" aria-hidden />}
              label="POS Settings"
              onClick={() => go('/pos/settings')}
            />
            <NavLink
              icon={<Lock className="h-5 w-5" aria-hidden />}
              label="Lock Terminal"
              onClick={() => dispatch(onLockTerminal)}
              disabled={!onLockTerminal}
            />
          </NavGroup>

          {onLogout && (
            <div className="pt-2 px-1">
              <button
                type="button"
                onClick={() => dispatch(onLogout)}
                className="w-full h-10 inline-flex items-center justify-center gap-2 rounded-md border border-border-subtle text-text-secondary text-sm font-semibold uppercase tracking-widest hover:text-text-primary hover:border-border-strong transition-colors motion-reduce:transition-none focus:outline focus:outline-2 focus:outline-gold focus:outline-offset-2"
              >
                Sign out
              </button>
            </div>
          )}
        </nav>
      </SheetContent>
    </Sheet>
  );
}

interface NavGroupProps {
  label: string;
  children: ReactNode;
}

function NavGroup({ label, children }: NavGroupProps): JSX.Element {
  return (
    <div className="space-y-1">
      <SectionLabel size="xs" className="px-3 py-1.5">
        {label}
      </SectionLabel>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

interface NavLinkProps {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

function NavLink({ icon, label, onClick, disabled }: NavLinkProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={`side-menu-${label.toLowerCase().replace(/\s+/g, '-')}`}
      className={cn(
        'w-full px-3 py-2.5 inline-flex items-center gap-3 rounded-md',
        'text-sm font-semibold text-left text-text-primary',
        'transition-colors motion-reduce:transition-none',
        'focus:outline focus:outline-2 focus:outline-gold focus:outline-offset-[-2px]',
        disabled
          ? 'opacity-40 cursor-not-allowed'
          : 'hover:bg-bg-overlay hover:text-gold',
      )}
    >
      <span aria-hidden className="text-text-muted">
        {icon}
      </span>
      <span className="flex-1 truncate">{label}</span>
    </button>
  );
}
