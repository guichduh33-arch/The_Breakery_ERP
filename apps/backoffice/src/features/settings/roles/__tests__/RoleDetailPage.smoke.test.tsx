// apps/backoffice/src/features/settings/roles/__tests__/RoleDetailPage.smoke.test.tsx
//
// ADR-031 — la fiche d'un rôle réunit trois choses qui vivaient ailleurs (ou
// nulle part) : ses permissions, son délai d'inactivité, et les exceptions
// accordées aux gens qui le portent. Ces tests figent les points où une erreur
// coûte un droit mal donné :
//   · la bascule d'une permission poste le bon couple (rôle, permission) ;
//   · le délai d'inactivité poste `update_role_session_timeout_v2` et refuse
//     hors bornes 5-480 ;
//   · SUPER_ADMIN est inerte de bout en bout ;
//   · un code de rôle inconnu donne un état vide propre, pas un écran blanc.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import RoleDetailPage from '@/pages/settings/roles/RoleDetailPage.js';
import { supabase } from '@/lib/supabase.js';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const MOCK_ROLES = [
  { code: 'MANAGER',     name: 'Manager',     description: 'Shop manager', is_system: false, session_timeout_minutes: 60 },
  { code: 'SUPER_ADMIN', name: 'Super Admin', description: null,           is_system: true,  session_timeout_minutes: 480 },
];

const MOCK_PERMISSIONS = [
  { code: 'orders.refund',   module: 'orders',   action: 'refund', description: null },
  { code: 'settings.read',   module: 'settings', action: 'read',   description: 'View settings' },
  { code: 'settings.update', module: 'settings', action: 'update', description: 'Update settings' },
];

const MOCK_GRANTS = [
  { role_code: 'MANAGER',     permission_code: 'settings.read',   is_granted: true },
  { role_code: 'SUPER_ADMIN', permission_code: 'settings.read',   is_granted: true },
  { role_code: 'SUPER_ADMIN', permission_code: 'settings.update', is_granted: true },
  { role_code: 'SUPER_ADMIN', permission_code: 'orders.refund',   is_granted: true },
];

const MOCK_OVERRIDES = [
  {
    user_profile_id: 'u-1',
    permission_code: 'orders.refund',
    is_granted:      true,
    reason:          'Covers the evening shift alone',
    expires_at:      '2026-12-31T00:00:00Z',
    granted_at:      '2026-08-01T00:00:00Z',
    granted_by:      'u-9',
  },
];

const MOCK_USERS = [
  { id: 'u-1', full_name: 'Ayu',  role_code: 'MANAGER',     deleted_at: null, is_active: true },
  { id: 'u-9', full_name: 'Mamat', role_code: 'SUPER_ADMIN', deleted_at: null, is_active: true },
];

let failTables = false;

vi.mock('@/lib/supabase.js', () => {
  function buildChain(table: string): unknown {
    const dataFor =
      table === 'roles'                     ? MOCK_ROLES :
      table === 'permissions'               ? MOCK_PERMISSIONS :
      table === 'role_permissions'          ? MOCK_GRANTS :
      table === 'user_permission_overrides' ? MOCK_OVERRIDES :
      table === 'user_profiles'             ? MOCK_USERS :
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

function renderPage(roleCode = 'MANAGER') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/backoffice/settings/roles/${roleCode}`]}>
        <Routes>
          <Route path="/backoffice/settings/roles/:roleCode" element={<RoleDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('RoleDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    failTables = false;
  });

  it('renders the role, the sign-in banner, and its granted count', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Manager' })).toBeInTheDocument();
    expect(screen.getByTestId('rbac-banner')).toHaveTextContent(/next sign-in/i);
    expect(screen.getByTestId('role-permissions-total')).toHaveTextContent('1 / 3');
    expect(screen.getByTestId('module-count-settings')).toHaveTextContent('1 / 2');
  });

  it('toggling a permission calls set_role_permission_v1 for this role', async () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.fn() mock, no `this` to lose
    const rpcSpy = vi.mocked(supabase.rpc);
    renderPage();
    const box = await screen.findByTestId('role-perm-settings.update');
    expect(box).not.toBeChecked();
    fireEvent.click(box);
    await waitFor(() => {
      expect(rpcSpy).toHaveBeenCalledWith('set_role_permission_v1', {
        p_role_code:       'MANAGER',
        p_permission_code: 'settings.update',
        p_granted:         true,
      });
    });
  });

  it('saves the session timeout through update_role_session_timeout_v2', async () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.fn() mock, no `this` to lose
    const rpcSpy = vi.mocked(supabase.rpc);
    renderPage();
    const input = await screen.findByTestId('role-timeout-input');
    expect(input).toHaveValue(60);
    expect(screen.getByTestId('role-timeout-save')).toBeDisabled(); // pas encore sale
    fireEvent.change(input, { target: { value: '45' } });
    fireEvent.click(screen.getByTestId('role-timeout-save'));
    await waitFor(() => {
      expect(rpcSpy).toHaveBeenCalledWith('update_role_session_timeout_v2', {
        p_role_code: 'MANAGER',
        p_minutes:   45,
      });
    });
  });

  it('refuses a timeout outside the 5–480 bounds', async () => {
    renderPage();
    const input = await screen.findByTestId('role-timeout-input');
    fireEvent.change(input, { target: { value: '4' } });
    expect(screen.getByTestId('role-timeout-invalid')).toBeInTheDocument();
    expect(screen.getByTestId('role-timeout-save')).toBeDisabled();
  });

  it('lists the overrides of the people holding this role', async () => {
    renderPage();
    expect(await screen.findByText('Ayu')).toBeInTheDocument();
    // `orders.refund` apparaît AUSSI dans le panneau des permissions du rôle :
    // on désigne la ligne d'exception par ce qui n'existe que là.
    expect(screen.getByText('Grant')).toBeInTheDocument();
    expect(screen.getByText('Covers the evening shift alone')).toBeInTheDocument();
    expect(screen.getByTestId('override-remove-orders.refund')).toBeInTheDocument();
  });

  it('locks every control on the SUPER_ADMIN role', async () => {
    renderPage('SUPER_ADMIN');
    expect(await screen.findByTestId('role-permissions-locked')).toBeInTheDocument();
    expect(screen.getByTestId('role-perm-settings.read')).toBeDisabled();
    // Aucun profil éligible : l'ajout d'exception est fermé, pas seulement vide.
    expect(screen.getByTestId('override-add-btn')).toBeDisabled();
  });

  it('says so when the role code matches nothing', async () => {
    renderPage('NOPE');
    expect(await screen.findByTestId('role-detail-unknown')).toHaveTextContent('NOPE');
    expect(screen.getByRole('heading', { name: /Role not found/i })).toBeInTheDocument();
  });

  // Même bandeau partagé que la liste : la phrase dit ce qui est en jeu, le
  // message serveur passe en diagnostic, et « Try again » relance la requête.
  it('surfaces a load failure', async () => {
    failTables = true;
    renderPage();
    const banner = await screen.findByTestId('role-detail-error');
    expect(banner).toHaveTextContent(/This role could not be loaded/i);
    expect(banner).toHaveAttribute('role', 'alert');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
