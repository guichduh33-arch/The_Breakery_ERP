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
      onLockTerminal: () => {},
      onLogout: () => {},
    });
    expect(screen.getByTestId('side-menu-held-orders')).toBeInTheDocument();
    expect(screen.getByTestId('side-menu-transaction-history')).toBeInTheDocument();
    expect(screen.getByTestId('side-menu-pos-reports')).toBeInTheDocument();
    expect(screen.getByTestId('side-menu-live-sessions')).toBeInTheDocument();
    expect(screen.getByTestId('side-menu-customer-list')).toBeInTheDocument();
    expect(screen.getByTestId('side-menu-cafe-stock')).toBeInTheDocument();
    expect(screen.getByTestId('side-menu-outstanding-debts')).toBeInTheDocument();
    expect(screen.getByTestId('side-menu-kds')).toBeInTheDocument();
    expect(screen.getByTestId('side-menu-pos-settings')).toBeInTheDocument();
    expect(screen.getByTestId('side-menu-lock-terminal')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
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
