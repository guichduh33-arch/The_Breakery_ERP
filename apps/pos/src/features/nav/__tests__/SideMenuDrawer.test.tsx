// apps/pos/src/features/nav/__tests__/SideMenuDrawer.test.tsx
//
// Session 14 — Phase 2.A smoke for the master POS nav drawer.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SideMenuDrawer } from '../SideMenuDrawer';

const navigateMock = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

function renderDrawer(overrides: Partial<Parameters<typeof SideMenuDrawer>[0]> = {}) {
  return render(
    <MemoryRouter>
      <SideMenuDrawer
        open
        onClose={() => {}}
        userName="Mamat Owner"
        userRole="OWNER"
        userInitial="M"
        {...overrides}
      />
    </MemoryRouter>,
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
      onOpenHeldOrders: () => {},
      onOpenHistory: () => {},
      onOpenLiveSessions: () => {},
      onOpenCustomers: () => {},
      onCloseShift: () => {},
      onLockTerminal: () => {},
      onChangePin: () => {},
      onLogout: () => {},
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
    renderDrawer({ onChangePin: () => {} });
    const item = screen.getByTestId('side-menu-change-pin') as HTMLButtonElement;
    expect(item).toBeInTheDocument();
    expect(item.disabled).toBe(false);
  });

  it('disables Change PIN item when onChangePin is missing', () => {
    renderDrawer({});
    const item = screen.getByTestId('side-menu-change-pin') as HTMLButtonElement;
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
    const item = screen.getByTestId('side-menu-close-shift') as HTMLButtonElement;
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

  it('navigates to /pos/reports when "POS Reports" is clicked', () => {
    renderDrawer();
    fireEvent.click(screen.getByTestId('side-menu-pos-reports'));
    expect(navigateMock).toHaveBeenCalledWith('/pos/reports');
  });

  it('disables an item when its handler is missing', () => {
    // Omit onOpenHeldOrders entirely (NOT set to undefined — exactOptionalPropertyTypes).
    renderDrawer({});
    const item = screen.getByTestId('side-menu-held-orders') as HTMLButtonElement;
    expect(item.disabled).toBe(true);
  });

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn();
    renderDrawer({ onClose });
    fireEvent.click(screen.getByLabelText('Close menu'));
    expect(onClose).toHaveBeenCalled();
  });
});
