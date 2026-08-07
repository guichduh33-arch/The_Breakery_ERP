// apps/backoffice/src/layouts/__tests__/TopBar.test.tsx
//
// Refonte shell 2026-08-05 — le filet de la top bar.
//
// Couvre ce qui remplace l'ancien Sidebar.test.tsx : présence des 7 onglets,
// ouverture/fermeture des drop-panels, marqueur de section active, filtrage par
// permission en cascade, et la navigation clavier de menubar (← → ↓ Échap).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Les hooks d'alerte partent en réseau — neutralisés avant l'import de TopBar.
vi.mock('@/features/inventory-alerts/hooks/useLowStock.js', () => ({
  useLowStock: () => ({ data: [], isLoading: false }),
}));
vi.mock('@/features/inventory-alerts/hooks/useReorderSuggestions.js', () => ({
  useReorderSuggestions: () => ({ data: [], isLoading: false }),
}));

import { TopBar } from '@/layouts/TopBar.js';
import { useAuthStore } from '@/stores/authStore.js';

const ALL_PERMS = [
  'orders.read', 'customers.read', 'customer_categories.read', 'settings.read',
  'promotions.read', 'loyalty.read', 'purchasing.po.read', 'suppliers.read',
  'categories.read', 'combos.read', 'products.read', 'inventory.read',
  'inventory.receive', 'expenses.read', 'expenses.thresholds.read',
  'accounting.coa.read', 'accounting.gl.read', 'accounting.tb.read',
  'accounting.read', 'accounting.period.close', 'accounting.cash.read',
  'zreports.read', 'reports.read', 'reports.sales.read', 'reports.inventory.read',
  'reports.financial.read', 'reports.audit.read', 'lan.devices.read',
  'users.read', 'rbac.read', 'display.read', 'settings.security.manage',
  'tables.update', 'b2b.read',
];

function setAuthState(perms: string[]) {
  useAuthStore.setState({
    user: { id: 'u-1', full_name: 'Mamat', role_code: 'OWNER', employee_code: 'E1' },
    sessionToken: 'tok',
    permissions: perms,
    isAuthenticated: true,
    isLoading: false,
    error: null,
  });
}

function renderTopBar(route = '/backoffice') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[route]}>
        <TopBar onOpenSearch={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const tab = (name: string) =>
  screen.getByRole(name === 'Today' ? 'link' : 'button', { name: new RegExp(`^${name}$`) });

describe('TopBar', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('rend les 7 onglets de domaine pour un rôle omnipotent', () => {
    setAuthState(ALL_PERMS);
    renderTopBar();
    for (const label of ['Today', 'Sales', 'Stock', 'Purchase', 'Finance', 'Reports', 'Admin']) {
      expect(tab(label)).toBeInTheDocument();
    }
  });

  it('n’affiche aucun panneau tant qu’aucun onglet n’est ouvert', () => {
    setAuthState(ALL_PERMS);
    renderTopBar();
    expect(screen.queryByTestId('domain-panel-stock')).not.toBeInTheDocument();
    expect(tab('Stock')).toHaveAttribute('aria-expanded', 'false');
  });

  it('ouvre le drop-panel au clic et le referme au re-clic', () => {
    setAuthState(ALL_PERMS);
    renderTopBar();

    fireEvent.click(tab('Stock'));
    const panel = screen.getByTestId('domain-panel-stock');
    expect(within(panel).getByText('Catalogue')).toBeInTheDocument();
    expect(within(panel).getByText('Movements')).toBeInTheDocument();
    expect(within(panel).getByText('Watch')).toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: 'Products' })).toHaveAttribute(
      'href', '/backoffice/products',
    );
    expect(tab('Stock')).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(tab('Stock'));
    expect(screen.queryByTestId('domain-panel-stock')).not.toBeInTheDocument();
  });

  it('ferme le panneau sur Échap et sur un clic extérieur', () => {
    setAuthState(ALL_PERMS);
    renderTopBar();

    fireEvent.click(tab('Reports'));
    expect(screen.getByTestId('domain-panel-reports')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('domain-panel-reports')).not.toBeInTheDocument();

    fireEvent.click(tab('Reports'));
    expect(screen.getByTestId('domain-panel-reports')).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId('domain-panel-reports')).not.toBeInTheDocument();
  });

  it('bascule au survol seulement quand la barre est déjà déployée', () => {
    setAuthState(ALL_PERMS);
    renderTopBar();

    // Barre fermée : survoler n'ouvre rien.
    fireEvent.mouseEnter(tab('Finance'));
    expect(screen.queryByTestId('domain-panel-finance')).not.toBeInTheDocument();

    // Barre ouverte : le survol d'un autre onglet bascule sans clic.
    fireEvent.click(tab('Stock'));
    fireEvent.mouseEnter(tab('Finance'));
    expect(screen.queryByTestId('domain-panel-stock')).not.toBeInTheDocument();
    expect(screen.getByTestId('domain-panel-finance')).toBeInTheDocument();
  });

  it('marque l’onglet de la section courante, y compris sur une route enfant', () => {
    setAuthState(ALL_PERMS);
    renderTopBar('/backoffice/orders/abc-123');
    // Le soulignement or est porté par une classe d'ombre interne.
    expect(tab('Sales').className).toContain('shadow-[inset_0_-2px_0_var(--ink-gold)]');
    expect(tab('Stock').className).not.toContain('shadow-[inset_0_-2px_0_var(--ink-gold)]');
  });

  it('cache un domaine dont toutes les colonnes sont vides', () => {
    setAuthState(['expenses.read']);
    renderTopBar();
    expect(tab('Today')).toBeInTheDocument();
    expect(tab('Finance')).toBeInTheDocument();
    for (const label of ['Sales', 'Stock', 'Purchase', 'Reports', 'Admin']) {
      expect(screen.queryByRole('button', { name: new RegExp(`^${label}$`) })).not.toBeInTheDocument();
    }
  });

  it('cache une colonne vide sans cacher le domaine', () => {
    setAuthState(['expenses.read', 'zreports.read']);
    renderTopBar();
    fireEvent.click(tab('Finance'));
    const panel = screen.getByTestId('domain-panel-finance');
    // « Expenses » est à la fois le libellé de colonne et celui du lien.
    expect(within(panel).getByRole('link', { name: 'Expenses' })).toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: 'Z-reports' })).toBeInTheDocument();
    expect(within(panel).getByText('Closing')).toBeInTheDocument();
    expect(within(panel).queryByText('Accounting')).not.toBeInTheDocument();
    expect(within(panel).queryByRole('link', { name: 'General ledger' })).not.toBeInTheDocument();
  });

  it('ne monte la cloche d’alertes que sous inventory.read', () => {
    setAuthState(['expenses.read']);
    renderTopBar();
    expect(screen.queryByRole('link', { name: /inventory alerts/i })).not.toBeInTheDocument();

    cleanup();
    setAuthState(ALL_PERMS);
    renderTopBar();
    expect(screen.getByRole('link', { name: /No inventory alerts/i })).toBeInTheDocument();
  });

  it('déplace le focus entre onglets avec ← et →', () => {
    setAuthState(ALL_PERMS);
    renderTopBar();

    tab('Today').focus();
    fireEvent.keyDown(tab('Today'), { key: 'ArrowRight' });
    expect(document.activeElement).toBe(tab('Sales'));

    fireEvent.keyDown(tab('Sales'), { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(tab('Today'));

    // Le parcours boucle : ← depuis le premier onglet va au dernier.
    fireEvent.keyDown(tab('Today'), { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(tab('Admin'));
  });

  it('ouvre le panneau sur ↓', () => {
    setAuthState(ALL_PERMS);
    renderTopBar();
    fireEvent.keyDown(tab('Purchase'), { key: 'ArrowDown' });
    expect(screen.getByTestId('domain-panel-purchase')).toBeInTheDocument();
  });

  it('expose le menu utilisateur avec le rôle et la déconnexion', () => {
    setAuthState(ALL_PERMS);
    renderTopBar();
    fireEvent.click(screen.getByRole('button', { name: /Mamat/ }));
    const menu = screen.getByRole('menu');
    expect(within(menu).getByText('OWNER')).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: /Settings/ })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: /Logout/ })).toBeInTheDocument();
  });

  it('déclenche l’ouverture de la palette depuis le bouton de recherche', () => {
    setAuthState(ALL_PERMS);
    const onOpenSearch = vi.fn();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/backoffice']}>
          <TopBar onOpenSearch={onOpenSearch} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /command palette/i }));
    expect(onOpenSearch).toHaveBeenCalledOnce();
  });
});
