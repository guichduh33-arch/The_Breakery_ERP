import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTabletCartStore } from '@/stores/tabletCartStore';
import { TabletUserMenu } from '../components/TabletUserMenu';

const auth = vi.hoisted(() => ({ user: { full_name: 'Waiter One' }, logout: vi.fn() }));
vi.mock('@/stores/authStore', () => ({
  useAuthStore: Object.assign((selector: (state: typeof auth) => unknown) => selector(auth), {
    getState: () => auth,
  }),
}));

function openMenu() {
  render(<TabletUserMenu />);
  fireEvent.click(screen.getByRole('button', { name: 'Switch user: Waiter One' }));
}

describe('Tablet user switch', () => {
  beforeEach(() => {
    auth.logout.mockReset().mockResolvedValue(undefined);
    useTabletCartStore.getState().clearCart();
  });

  it('cancels without signing out or changing the draft', () => {
    useTabletCartStore.getState().setTableNumber('T4');
    openMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(auth.logout).not.toHaveBeenCalled();
    expect(useTabletCartStore.getState().tableNumber).toBe('T4');
  });

  it('signs out once and clears empty draft context', async () => {
    let resolve!: () => void;
    auth.logout.mockImplementation(() => new Promise<void>((done) => { resolve = done; }));
    useTabletCartStore.getState().setTableNumber('T4');
    openMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Switch user' }));
    expect(screen.getByRole('button', { name: 'Signing out…' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(auth.logout).toHaveBeenCalledTimes(1);
    expect(useTabletCartStore.getState().tableNumber).toBeNull();
    await act(async () => { resolve(); await Promise.resolve(); });
  });

  it('protects a nonempty cart, including changes after opening', async () => {
    openMenu();
    act(() => useTabletCartStore.setState({ items: [{ id: 'draft' }] as never }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Switch user' })).toBeDisabled());
    expect(auth.logout).not.toHaveBeenCalled();
    expect(useTabletCartStore.getState().items).toHaveLength(1);
  });

  it('protects an unresolved send even with an empty cart', () => {
    const attempt = useTabletCartStore.getState().beginSend('waiter-one', true);
    openMenu();
    expect(screen.getByRole('button', { name: 'Switch user' })).toBeDisabled();
    expect(useTabletCartStore.getState().pendingSend).toEqual(attempt);
    expect(auth.logout).not.toHaveBeenCalled();
  });
});
