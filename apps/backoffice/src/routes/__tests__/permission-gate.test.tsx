// apps/backoffice/src/routes/__tests__/permission-gate.test.tsx
//
// LE DÉFAUT QUE CE FICHIER FERME (lot 4 / tâche C).
//
// `PermissionGate` rendait `<Navigate to="/backoffice" replace />` : un clic sur
// un rapport depuis un hub de 46 tuiles éjectait l'utilisateur vers l'accueil,
// lui faisait perdre sa place ET sa recherche, et le seul message qui nommait le
// problème était un toast — qui s'efface, et qui ne dit ni quelle permission
// manque ni à qui la demander.
//
// Le gate rend désormais le bloc « restricted » DANS la coquille, à la place du
// corps de route. Ces tests verrouillent les trois propriétés qui font la
// différence : l'URL ne bouge pas, la coquille reste montée, et le code de
// permission est lisible à l'écran.
//
// La coquille est remplacée par un témoin : ce qu'on teste ici est le GATE, pas
// la TopBar (qui monte ses propres requêtes). Le témoin suffit à prouver que le
// refus ne démonte pas le shell.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter, Outlet, useLocation } from 'react-router-dom';

const authState = {
  isAuthenticated: true,
  hasPermission: (_code: string) => false,
  user: { role_code: 'MANAGER' as string | undefined },
};

vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (selector: (s: typeof authState) => unknown) => selector(authState),
}));

// Coquille-témoin : une barre de navigation factice + l'Outlet. Si le refus
// éjectait, ce témoin resterait certes monté — mais l'URL, elle, bougerait ;
// les deux assertions se tiennent ensemble.
vi.mock('@/layouts/BackofficeLayout.js', () => ({
  BackofficeLayout: () => (
    <div>
      <nav data-testid="shell-nav">shell nav</nav>
      <Outlet />
    </div>
  ),
}));

import { AppRoutes } from '@/routes/index.js';

/** Sonde de localisation : l'URL courante, rendue en clair. */
function LocationProbe() {
  const { pathname } = useLocation();
  return <span data-testid="pathname">{pathname}</span>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <LocationProbe />
      <AppRoutes />
    </MemoryRouter>,
  );
}

describe('PermissionGate — le refus s’affiche, il n’éjecte plus', () => {
  beforeEach(() => {
    authState.hasPermission = () => false;
  });
  afterEach(cleanup);

  it("laisse l'utilisateur sur son URL au lieu de le renvoyer à l'accueil", async () => {
    renderAt('/backoffice/expenses');
    await screen.findByTestId('route-denied');
    expect(screen.getByTestId('pathname')).toHaveTextContent('/backoffice/expenses');
  });

  it('garde la coquille de navigation montée', async () => {
    renderAt('/backoffice/expenses');
    await screen.findByTestId('route-denied');
    expect(screen.getByTestId('shell-nav')).toBeInTheDocument();
  });

  it('nomme la permission manquante et offre une sortie', async () => {
    renderAt('/backoffice/expenses');
    const denied = await screen.findByTestId('route-denied');
    expect(denied).toHaveTextContent('expenses.read');
    expect(denied).toHaveTextContent('Access restricted');
    expect(screen.getByRole('link', { name: /back to dashboard/i })).toHaveAttribute(
      'href',
      '/backoffice',
    );
  });

  it('laisse passer la route quand le droit est là', () => {
    authState.hasPermission = (code: string) => code === 'customer_categories.read';
    renderAt('/backoffice/customers/categories');
    // La page réelle est lazy : on se contente de vérifier que le refus n'est
    // PAS rendu, ce qui prouve que le gate a laissé passer.
    expect(screen.queryByTestId('route-denied')).not.toBeInTheDocument();
  });
});

// LOT 9 — le jumeau de rôle. `AdminGate` garde /reports/audit et
// /settings/history ; il rendait encore `<Navigate to="/backoffice">` + un
// toast, soit exactement le défaut que le lot 4 a nommé en corrigeant
// `PermissionGate` : deux traitements du même refus dans le même produit.
// Ce qu'un garde de RÔLE doit nommer n'est pas un code de permission mais le
// rôle requis — au moins aussi utile, et ça dit à qui s'adresser.
describe('AdminGate — le refus de rôle s’affiche lui aussi', () => {
  beforeEach(() => {
    authState.hasPermission = () => false;
    authState.user.role_code = 'MANAGER';
  });
  afterEach(cleanup);

  it("laisse l'utilisateur sur son URL au lieu de le renvoyer à l'accueil", async () => {
    renderAt('/backoffice/reports/audit');
    await screen.findByTestId('route-denied');
    expect(screen.getByTestId('pathname')).toHaveTextContent('/backoffice/reports/audit');
    expect(screen.getByTestId('shell-nav')).toBeInTheDocument();
  });

  it('nomme le RÔLE requis — pas un code de permission — et offre une sortie', async () => {
    renderAt('/backoffice/settings/history');
    const denied = await screen.findByTestId('route-denied');
    expect(denied).toHaveTextContent('Access restricted');
    // Les deux rôles sont alternatifs : « or », et le libellé humain, pas le
    // code brut de la base.
    expect(denied).toHaveTextContent('It requires the Admin or Super admin role.');
    expect(denied.textContent).not.toContain('SUPER_ADMIN');
    expect(screen.getByRole('link', { name: /back to dashboard/i })).toHaveAttribute(
      'href',
      '/backoffice',
    );
  });

  it('laisse passer un administrateur', () => {
    authState.user.role_code = 'ADMIN';
    renderAt('/backoffice/settings/history');
    expect(screen.queryByTestId('route-denied')).not.toBeInTheDocument();
  });
});
