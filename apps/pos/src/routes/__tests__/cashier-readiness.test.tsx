import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '../index';

const auth = vi.hoisted(() => ({ isAuthenticated: true, isLocked: false }));
const terminal = vi.hoisted(() => ({ orderingOnly: false }));
vi.mock('@/features/lan/terminalPaymentAccess', () => ({ useOrderingOnlyTerminal: () => terminal.orderingOnly }));
vi.mock('@/stores/authStore', () => ({
  useAuthStore: <T,>(selector: (state: typeof auth) => T) => selector(auth),
}));
vi.mock('@/lib/nativeShell', () => ({ isNativeShell: () => false }));
vi.mock('@/pages/Pos', () => ({ default: () => <main aria-label="Cashier">Ready to take orders</main> }));
vi.mock('@/pages/Login', () => ({ default: () => <main aria-label="Sign in">Enter PIN</main> }));
vi.mock('@/pages/tablet/TabletLayout', () => ({ default: () => <main aria-label="Tablet">Order only</main> }));
vi.mock('@/features/settings/POSSettingsPage', () => ({ default: () => <main aria-label="Setup">Device setup</main> }));

describe('Disponibilité de la route caisse', () => {
  beforeEach(() => { auth.isAuthenticated = true; terminal.orderingOnly = false; });

  it('rend la caisse sans attendre un second chargement de route après la restauration de session', () => {
    render(<MemoryRouter initialEntries={['/pos']}><AppRoutes /></MemoryRouter>);
    expect(screen.getByRole('main', { name: 'Cashier' })).toHaveTextContent('Ready to take orders');
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
  });

  it('conserve le contrôle de connexion sur la route caisse', () => {
    auth.isAuthenticated = false;
    render(<MemoryRouter initialEntries={['/pos']}><AppRoutes /></MemoryRouter>);
    expect(screen.getByRole('main', { name: 'Sign in' })).toHaveTextContent('Enter PIN');
    expect(screen.queryByRole('main', { name: 'Cashier' })).not.toBeInTheDocument();
  });

  it.each(['/pos', '/pos/debts'])('renvoie un appareil de prise de commande hors de %s', async (route) => {
    terminal.orderingOnly = true;
    render(<MemoryRouter initialEntries={[route]}><AppRoutes /></MemoryRouter>);
    expect(await screen.findByRole('main', { name: 'Tablet' })).toHaveTextContent('Order only');
    expect(screen.queryByRole('main', { name: 'Cashier' })).not.toBeInTheDocument();
  });

  it('conserve les réglages nécessaires à l’appairage d’une tablette', async () => {
    terminal.orderingOnly = true;
    render(<MemoryRouter initialEntries={['/pos/settings']}><AppRoutes /></MemoryRouter>);
    expect(await screen.findByRole('main', { name: 'Setup' })).toBeInTheDocument();
  });
});
