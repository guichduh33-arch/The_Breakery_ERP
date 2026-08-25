// apps/backoffice/src/features/settings/roles/__tests__/CreateRoleDialog.smoke.test.tsx
//
// ADR-032 — ce que ces tests figent :
//   · le bandeau de la page ouvre bien le dialogue (sans bouton, la RPC est
//     injoignable depuis l'écran, ce qui est tout le lot) ;
//   · un rôle vierge poste `create_role_v1` avec le code et le nom SEULS —
//     les arguments optionnels sont OMIS, pas posés à null : c'est ce qui
//     laisse le COALESCE serveur retomber sur ses défauts ;
//   · un clone poste `p_clone_from`, et le timeout saisi voyage en NOMBRE ;
//   · la validation client refuse l'envoi sur un code hors format et sur un
//     timeout hors bornes — elle double le serveur, elle ne le remplace pas.

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
  { code: 'CASHIER',     name: 'Cashier',     description: null, is_system: true,  session_timeout_minutes: 30 },
  { code: 'MANAGER',     name: 'Manager',     description: null, is_system: false, session_timeout_minutes: 60 },
  { code: 'SUPER_ADMIN', name: 'Super Admin', description: null, is_system: true,  session_timeout_minutes: 480 },
];

const MOCK_PERMISSIONS = [
  { code: 'settings.read', module: 'settings', action: 'read', description: null },
];

vi.mock('@/lib/supabase.js', () => {
  function buildChain(table: string): unknown {
    const dataFor =
      table === 'roles'       ? MOCK_ROLES :
      table === 'permissions' ? MOCK_PERMISSIONS :
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
      rpc: vi.fn().mockResolvedValue({ data: 'CASHIER_SENIOR', error: null }),
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

/** Ouvre le dialogue et rend la main quand son champ « code » est monté. */
async function openDialog(): Promise<void> {
  fireEvent.click(await screen.findByTestId('role-create-btn'));
  await screen.findByTestId('create-role-dialog');
}

describe('CreateRoleDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens from the page toolbar', async () => {
    renderPage();
    expect(screen.queryByTestId('create-role-dialog')).not.toBeInTheDocument();
    await openDialog();
    expect(screen.getByTestId('new-role-code')).toBeInTheDocument();
  });

  it('creates a blank role with the code and name only', async () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.fn() mock, no `this` to lose
    const rpcSpy = vi.mocked(supabase.rpc);
    renderPage();
    await openDialog();

    fireEvent.change(screen.getByTestId('new-role-code'), { target: { value: 'CASHIER_SENIOR' } });
    fireEvent.change(screen.getByTestId('new-role-name'), { target: { value: 'Cashier Senior' } });
    fireEvent.click(screen.getByTestId('new-role-submit'));

    await waitFor(() => {
      expect(rpcSpy).toHaveBeenCalledWith('create_role_v1', {
        p_code: 'CASHIER_SENIOR',
        p_name: 'Cashier Senior',
      });
    });
  });

  it('creates a cloned role with its description, timeout and source', async () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.fn() mock, no `this` to lose
    const rpcSpy = vi.mocked(supabase.rpc);
    renderPage();
    await openDialog();

    fireEvent.change(screen.getByTestId('new-role-code'), { target: { value: 'CASHIER_SENIOR' } });
    fireEvent.change(screen.getByTestId('new-role-name'), { target: { value: 'Cashier Senior' } });
    fireEvent.change(screen.getByTestId('new-role-description'), { target: { value: 'Senior counter staff' } });
    fireEvent.change(screen.getByTestId('new-role-timeout'), { target: { value: '45' } });
    fireEvent.change(screen.getByTestId('new-role-clone'), { target: { value: 'CASHIER' } });
    fireEvent.click(screen.getByTestId('new-role-submit'));

    await waitFor(() => {
      expect(rpcSpy).toHaveBeenCalledWith('create_role_v1', {
        p_code:                    'CASHIER_SENIOR',
        p_name:                    'Cashier Senior',
        p_description:             'Senior counter staff',
        p_session_timeout_minutes: 45,
        p_clone_from:              'CASHIER',
      });
    });
  });

  it('lists every role as a clone source, system ones included', async () => {
    renderPage();
    await openDialog();
    const select = await screen.findByTestId('new-role-clone');
    const values = Array.from(select.querySelectorAll('option')).map((o) => o.getAttribute('value'));
    expect(values).toEqual(['', 'CASHIER', 'MANAGER', 'SUPER_ADMIN']);
  });

  it('refuses a code that does not match the server format', async () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.fn() mock, no `this` to lose
    const rpcSpy = vi.mocked(supabase.rpc);
    renderPage();
    await openDialog();

    fireEvent.change(screen.getByTestId('new-role-code'), { target: { value: '9NOPE' } });
    fireEvent.change(screen.getByTestId('new-role-name'), { target: { value: 'Cashier Senior' } });

    expect(screen.getByTestId('new-role-code-invalid')).toBeInTheDocument();
    expect(screen.getByTestId('new-role-submit')).toBeDisabled();
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('refuses a timeout outside the 5–480 bounds', async () => {
    renderPage();
    await openDialog();

    fireEvent.change(screen.getByTestId('new-role-code'), { target: { value: 'CASHIER_SENIOR' } });
    fireEvent.change(screen.getByTestId('new-role-name'), { target: { value: 'Cashier Senior' } });
    fireEvent.change(screen.getByTestId('new-role-timeout'), { target: { value: '600' } });

    expect(screen.getByTestId('new-role-timeout-invalid')).toBeInTheDocument();
    expect(screen.getByTestId('new-role-submit')).toBeDisabled();
  });
});
