// apps/backoffice/src/features/settings/roles/__tests__/RolesPage.smoke.test.tsx
//
// ADR-031 — ce que ces tests figent n'est pas une mise en page :
//   · la bannière « next sign-in » est présente, parce que sans elle un
//     opérateur qui coche et ne voit rien changer conclut au bug ;
//   · la case cochée poste bien `set_role_permission_v1` avec le rôle ET la
//     permission de SA cellule — une matrice qui se trompe de colonne accorde
//     un droit à quelqu'un d'autre ;
//   · la colonne SUPER_ADMIN est inerte, parce que le serveur la refuse et
//     qu'un contrôle qui promet une action impossible est un piège ;
//   · l'échec de chargement se dit.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import RolesPage from '@/pages/settings/roles/RolesPage.js';
import { supabase } from '@/lib/supabase.js';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const MOCK_ROLES = [
  { code: 'ADMIN',       name: 'Admin',       description: 'Full access', is_system: true,  session_timeout_minutes: 120 },
  { code: 'MANAGER',     name: 'Manager',     description: null,          is_system: false, session_timeout_minutes: 60 },
  { code: 'SUPER_ADMIN', name: 'Super Admin', description: null,          is_system: true,  session_timeout_minutes: 480 },
];

const MOCK_PERMISSIONS = [
  { code: 'orders.refund',   module: 'orders',   action: 'refund', description: null },
  { code: 'settings.read',   module: 'settings', action: 'read',   description: 'View settings' },
  { code: 'settings.update', module: 'settings', action: 'update', description: 'Update settings' },
];

const MOCK_GRANTS = [
  { role_code: 'SUPER_ADMIN', permission_code: 'orders.refund',   is_granted: true },
  { role_code: 'SUPER_ADMIN', permission_code: 'settings.read',   is_granted: true },
  { role_code: 'SUPER_ADMIN', permission_code: 'settings.update', is_granted: true },
  { role_code: 'ADMIN',       permission_code: 'settings.read',   is_granted: true },
  { role_code: 'ADMIN',       permission_code: 'settings.update', is_granted: true },
  { role_code: 'MANAGER',     permission_code: 'settings.read',   is_granted: true },
];

let failTables = false;

vi.mock('@/lib/supabase.js', () => {
  // Une seule coquille pour les quatre `select` : `select` et `order` rendent
  // le même objet, lui-même thenable. Elle couvre donc aussi bien
  // `.select()` seul que `.select().order().order()`.
  function buildChain(table: string): unknown {
    const dataFor =
      table === 'roles'                     ? MOCK_ROLES :
      table === 'permissions'               ? MOCK_PERMISSIONS :
      table === 'role_permissions'          ? MOCK_GRANTS :
      [];
    const result = failTables
      ? { data: null, error: { message: 'boom' } }
      : { data: dataFor, error: null };
    const chain: Record<string, unknown> = {
      then: (resolve: (v: unknown) => void) => { resolve(result); },
    };
    chain.select = () => chain;
    chain.order  = () => chain;
    chain.is     = () => chain;
    return chain;
  }
  return {
    supabase: {
      from: (table: string) => buildChain(table),
      rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
    },
  };
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <RolesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('RolesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    failTables = false;
  });

  it('renders the heading, the sign-in banner, and one row per role', async () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /Roles & permissions/i })).toBeInTheDocument();
    expect(screen.getByTestId('rbac-banner')).toHaveTextContent(/next sign-in/i);
    expect(await screen.findByTestId('role-link-MANAGER')).toHaveAttribute(
      'href', '/backoffice/settings/roles/MANAGER',
    );
    expect(screen.getByTestId('role-link-ADMIN')).toBeInTheDocument();
    expect(screen.getByTestId('role-link-SUPER_ADMIN')).toBeInTheDocument();
  });

  it('counts the permissions granted to each role', async () => {
    renderPage();
    expect(await screen.findByTestId('role-granted-MANAGER')).toHaveTextContent('1 / 3');
    expect(screen.getByTestId('role-granted-ADMIN')).toHaveTextContent('2 / 3');
    expect(screen.getByTestId('role-granted-SUPER_ADMIN')).toHaveTextContent('3 / 3');
  });

  it('toggling a matrix cell calls set_role_permission_v1 with that cell’s role and permission', async () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.fn() mock, no `this` to lose
    const rpcSpy = vi.mocked(supabase.rpc);
    renderPage();
    // Radix bascule d'onglet sur `mousedown`, pas sur `click` : l'idiome du
    // dépôt (RecipeBuilder.test.tsx) est le seul qui change réellement de pane.
    fireEvent.mouseDown(screen.getByRole('tab', { name: /Full matrix/i }));
    const cell = await screen.findByTestId('rbac-cell-MANAGER-settings.update');
    expect(cell).not.toBeChecked();
    fireEvent.click(cell);
    await waitFor(() => {
      expect(rpcSpy).toHaveBeenCalledWith('set_role_permission_v1', {
        p_role_code:       'MANAGER',
        p_permission_code: 'settings.update',
        p_granted:         true,
      });
    });
  });

  it('locks the SUPER_ADMIN column', async () => {
    renderPage();
    // Radix bascule d'onglet sur `mousedown`, pas sur `click` : l'idiome du
    // dépôt (RecipeBuilder.test.tsx) est le seul qui change réellement de pane.
    fireEvent.mouseDown(screen.getByRole('tab', { name: /Full matrix/i }));
    const locked = await screen.findByTestId('rbac-cell-SUPER_ADMIN-settings.read');
    expect(locked).toBeDisabled();
    expect(locked).toHaveAttribute('title', 'Locked to prevent lockout');
    // Un rôle non verrouillé reste actionnable — la garde vise UNE colonne.
    expect(screen.getByTestId('rbac-cell-ADMIN-settings.read')).not.toBeDisabled();
  });

  // Le bloc nu a laissé la place au bandeau partagé : phrase humaine, message
  // serveur relégué en diagnostic, et une reprise (« Try again ») qui évite de
  // recharger la page. C'est le bandeau qu'on épingle, plus une formulation.
  it('surfaces a load failure instead of rendering an empty table', async () => {
    failTables = true;
    renderPage();
    const banner = await screen.findByTestId('roles-error');
    expect(banner).toHaveTextContent(/Roles could not be loaded/i);
    expect(banner).toHaveAttribute('role', 'alert');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
