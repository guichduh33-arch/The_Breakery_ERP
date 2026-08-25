// apps/backoffice/src/features/settings/roles/__tests__/DeleteRoleAction.smoke.test.tsx
//
// ADR-032 — ce que ces tests figent :
//   · un rôle système est INERTE, et la raison est écrite à côté du bouton :
//     un contrôle qui promet une action que le serveur refuse est un piège ;
//   · un rôle porté est inerte lui aussi, avec le compte des employés à
//     réassigner — c'est le seul chiffre qui dit quoi faire ensuite ;
//   · un rôle libre passe par une confirmation qui répète son nom, puis poste
//     `delete_role_v1` avec son code.

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
  { code: 'MANAGER',        name: 'Manager',        description: null, is_system: false, session_timeout_minutes: 60 },
  { code: 'CASHIER_SENIOR', name: 'Cashier Senior', description: null, is_system: false, session_timeout_minutes: 30 },
  { code: 'SUPER_ADMIN',    name: 'Super Admin',    description: null, is_system: true,  session_timeout_minutes: 480 },
];

const MOCK_PERMISSIONS = [
  { code: 'settings.read', module: 'settings', action: 'read', description: null },
];

// Deux porteurs de MANAGER, dont un archivé : la garde serveur compte
// `user_profiles` SANS filtrer `deleted_at`, l'écran doit compter pareil.
const MOCK_USERS = [
  { id: 'u-1', full_name: 'Ayu',   role_code: 'MANAGER',     deleted_at: null,                     is_active: true  },
  { id: 'u-2', full_name: 'Budi',  role_code: 'MANAGER',     deleted_at: '2026-07-01T00:00:00Z',   is_active: false },
  { id: 'u-9', full_name: 'Mamat', role_code: 'SUPER_ADMIN', deleted_at: null,                     is_active: true  },
];

vi.mock('@/lib/supabase.js', () => {
  function buildChain(table: string): unknown {
    const dataFor =
      table === 'roles'                     ? MOCK_ROLES :
      table === 'permissions'               ? MOCK_PERMISSIONS :
      table === 'user_profiles'             ? MOCK_USERS :
      table === 'role_permissions'          ? [] :
      table === 'user_permission_overrides' ? [] :
      [];
    const chain: Record<string, unknown> = {
      then: (resolve: (v: unknown) => void) => { resolve({ data: dataFor, error: null }); },
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

function renderPage(roleCode: string) {
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

describe('DeleteRoleAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('locks the action on a system role and says why', async () => {
    renderPage('SUPER_ADMIN');
    expect(await screen.findByTestId('role-delete-btn')).toBeDisabled();
    expect(screen.getByTestId('role-delete-reason'))
      .toHaveTextContent('System roles cannot be deleted.');
  });

  it('locks the action while employees still hold the role, and counts them', async () => {
    renderPage('MANAGER');
    // Le compte arrive APRÈS le rôle (deux requêtes distinctes) : tant qu'il
    // n'est pas là, le bouton reste fermé sur « Checking… ». On attend l'état
    // établi, pas le premier rendu.
    await waitFor(() => {
      // Deux profils portent MANAGER, dont un archivé — le serveur les compte tous.
      expect(screen.getByTestId('role-delete-reason'))
        .toHaveTextContent('Reassign 2 employees first');
    });
    expect(screen.getByTestId('role-delete-btn')).toBeDisabled();
  });

  it('confirms with the role name, then calls delete_role_v1', async () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.fn() mock, no `this` to lose
    const rpcSpy = vi.mocked(supabase.rpc);
    renderPage('CASHIER_SENIOR');

    const btn = await screen.findByTestId('role-delete-btn');
    // Le bouton n'ouvre qu'une fois le compte des porteurs connu.
    await waitFor(() => { expect(btn).not.toBeDisabled(); });
    expect(screen.queryByTestId('role-delete-reason')).not.toBeInTheDocument();

    fireEvent.click(btn);
    const dialog = await screen.findByTestId('role-delete-dialog');
    expect(dialog).toHaveTextContent('Cashier Senior');
    expect(dialog).toHaveTextContent('CASHIER_SENIOR');

    fireEvent.click(screen.getByTestId('role-delete-confirm'));
    await waitFor(() => {
      expect(rpcSpy).toHaveBeenCalledWith('delete_role_v1', { p_code: 'CASHIER_SENIOR' });
    });
  });
});
