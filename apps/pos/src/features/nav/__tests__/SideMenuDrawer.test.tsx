// apps/pos/src/features/nav/__tests__/SideMenuDrawer.test.tsx
//
// Session 14 — Phase 2.A smoke for the master POS nav drawer.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type * as ReactRouterDom from 'react-router-dom';
import { SideMenuDrawer } from '../SideMenuDrawer';

const navigateMock = vi.fn();
const noop = () => undefined;

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof ReactRouterDom>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

// CashInOutModal (Session 60 / 12 D1.1) is now mounted inline — its own
// hooks (useCashMovement, react-query) are exercised by its dedicated
// smoke suite; here we only mock supabase so mounting it doesn't error.
vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: vi.fn() },
}));

function renderDrawer(overrides: Partial<Parameters<typeof SideMenuDrawer>[0]> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <SideMenuDrawer
          open
          onClose={vi.fn()}
          userName="Mamat Owner"
          userRole="OWNER"
          userInitial="M"
          {...overrides}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SideMenuDrawer', () => {
  beforeEach(() => {
    navigateMock.mockReset();
  });

  it('renders the user header (name + role + initial)', () => {
    renderDrawer();
    expect(screen.getByText('Mamat Owner')).toBeInTheDocument();
    expect(screen.getByText('OWNER')).toBeInTheDocument();
    expect(screen.getByText('M')).toBeInTheDocument();
  });

  it('renders all required nav items', () => {
    renderDrawer({
      onOpenHeldOrders: noop,
      onOpenHistory: noop,
      onOpenLiveSessions: noop,
      onOpenCustomers: noop,
      onCloseShift: noop,
      onLockTerminal: noop,
      onChangePin: noop,
      onLogout: noop,
    });
    expect(screen.getByTestId('side-menu-held-orders')).toBeInTheDocument();
    expect(screen.getByTestId('side-menu-transaction-history')).toBeInTheDocument();
    expect(screen.getByTestId('side-menu-pos-reports')).toBeInTheDocument();
    expect(screen.getByTestId('side-menu-live-sessions')).toBeInTheDocument();
    expect(screen.getByTestId('side-menu-customer-list')).toBeInTheDocument();
    expect(screen.getByTestId('side-menu-close-shift')).toBeInTheDocument();
    expect(screen.getByTestId('side-menu-cafe-stock')).toBeInTheDocument();
    expect(screen.getByTestId('side-menu-outstanding-debts')).toBeInTheDocument();
    expect(screen.getByTestId('side-menu-kds')).toBeInTheDocument();
    expect(screen.getByTestId('side-menu-pos-settings')).toBeInTheDocument();
    expect(screen.getByTestId('side-menu-lock-terminal')).toBeInTheDocument();
    expect(screen.getByTestId('side-menu-change-pin')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
  });

  // Session 19 / Phase 3.C — Change PIN item.
  it('renders Change PIN item when onChangePin prop is provided', () => {
    renderDrawer({ onChangePin: noop });
    const item = screen.getByTestId<HTMLButtonElement>('side-menu-change-pin');
    expect(item).toBeInTheDocument();
    expect(item.disabled).toBe(false);
  });

  it('disables Change PIN item when onChangePin is missing', () => {
    renderDrawer({});
    const item = screen.getByTestId<HTMLButtonElement>('side-menu-change-pin');
    expect(item.disabled).toBe(true);
  });

  it('dispatches onChangePin on click and closes the drawer', () => {
    const onChangePin = vi.fn();
    const onClose = vi.fn();
    renderDrawer({ onChangePin, onClose });
    fireEvent.click(screen.getByTestId('side-menu-change-pin'));
    expect(onClose).toHaveBeenCalled();
    // Handler is dispatched via queueMicrotask — flush the microtask queue.
    return Promise.resolve().then(() => {
      expect(onChangePin).toHaveBeenCalled();
    });
  });

  // POS audit 2026-06-12 lot 3 — Close Shift item (was unreachable: the modal
  // existed but had no production mount, so shifts could never be closed).
  it('disables Close Shift when onCloseShift is missing (no open shift)', () => {
    renderDrawer({});
    const item = screen.getByTestId<HTMLButtonElement>('side-menu-close-shift');
    expect(item.disabled).toBe(true);
  });

  it('dispatches onCloseShift on click and closes the drawer', () => {
    const onCloseShift = vi.fn();
    const onClose = vi.fn();
    renderDrawer({ onCloseShift, onClose });
    fireEvent.click(screen.getByTestId('side-menu-close-shift'));
    expect(onClose).toHaveBeenCalled();
    return Promise.resolve().then(() => {
      expect(onCloseShift).toHaveBeenCalled();
    });
  });

  // Session 60 (12 D1.1) — T5: Cash In / Cash Out items (CashInOutModal was
  // built in S13 but never mounted anywhere until now).
  it('shows Cash In / Cash Out enabled when a session is open', () => {
    renderDrawer({ sessionId: 's1' });
    expect(screen.getByTestId('side-menu-cash-in')).toBeEnabled();
    expect(screen.getByTestId('side-menu-cash-out')).toBeEnabled();
  });

  it('disables Cash In / Cash Out when no session is open', () => {
    renderDrawer({});
    expect(screen.getByTestId('side-menu-cash-in')).toBeDisabled();
    expect(screen.getByTestId('side-menu-cash-out')).toBeDisabled();
  });

  it('dispatches Cash In click and closes the drawer', () => {
    const onClose = vi.fn();
    renderDrawer({ sessionId: 's1', onClose });
    fireEvent.click(screen.getByTestId('side-menu-cash-in'));
    expect(onClose).toHaveBeenCalled();
  });

  it('navigates to /pos/reports when "POS Reports" is clicked', () => {
    renderDrawer();
    fireEvent.click(screen.getByTestId('side-menu-pos-reports'));
    expect(navigateMock).toHaveBeenCalledWith('/pos/reports');
  });

  it('disables an item when its handler is missing', () => {
    // Omit onOpenHeldOrders entirely (NOT set to undefined — exactOptionalPropertyTypes).
    renderDrawer({});
    const item = screen.getByTestId<HTMLButtonElement>('side-menu-held-orders');
    expect(item.disabled).toBe(true);
  });

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn();
    renderDrawer({ onClose });
    fireEvent.click(screen.getByLabelText('Close menu'));
    expect(onClose).toHaveBeenCalled();
  });
});
