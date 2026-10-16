import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '../index';

const auth = vi.hoisted(() => ({ isAuthenticated: true, isLocked: false }));
vi.mock('@/stores/authStore', () => ({
  useAuthStore: <T,>(selector: (state: typeof auth) => T) => selector(auth),
}));
vi.mock('@/lib/nativeShell', () => ({ isNativeShell: () => false }));
vi.mock('@/pages/Pos', () => ({ default: () => <main aria-label="Cashier">Ready to take orders</main> }));
vi.mock('@/pages/Login', () => ({ default: () => <main aria-label="Sign in">Enter PIN</main> }));

describe('Disponibilité de la route caisse', () => {
  beforeEach(() => { auth.isAuthenticated = true; });

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
});
