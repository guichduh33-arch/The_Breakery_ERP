// apps/backoffice/src/pages/settings/security/__tests__/SecuritySettingsPage.smoke.test.tsx
//
// ADR-006 déc. 9 — politique de verrouillage du PIN.
// ADR-031 — les délais d'inactivité par rôle ont quitté cette page pour la
// fiche du rôle : les tests qui les couvraient vivent désormais dans
// `features/settings/roles/__tests__/RoleDetailPage.smoke.test.tsx`. Ce qui
// reste ici couvre la seule politique globale du login.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import SecuritySettingsPage from '@/pages/settings/security/SecuritySettingsPage.js';
import { supabase } from '@/lib/supabase.js';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const currentPerms = new Set<string>(['settings.read', 'settings.update']);

vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (sel: (s: { hasPermission: (p: string) => boolean }) => unknown) =>
    sel({ hasPermission: (p: string) => currentPerms.has(p) }),
}));

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc: vi.fn().mockImplementation((fn: string) => {
      if (fn === 'get_settings_by_category_v10') {
        return Promise.resolve({
          data: { category: 'security', settings: { pin_max_failed: 5, pin_lockout_minutes: 15 } },
          error: null,
        });
      }
      return Promise.resolve({ data: true, error: null });
    }),
  },
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <SecuritySettingsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SecuritySettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentPerms.clear();
    currentPerms.add('settings.read');
    currentPerms.add('settings.update');
  });

  it('renders the PIN policy card populated from the security category', async () => {
    renderPage();
    const maxInput = await screen.findByTestId<HTMLInputElement>('pin-input-pin_max_failed');
    expect(maxInput.value).toBe('5');
    expect(screen.getByTestId<HTMLInputElement>('pin-input-pin_lockout_minutes').value).toBe('15');
    expect(screen.getByTestId('pin-policy-save')).toBeDisabled(); // clean
  });

  // ADR-031 — la preuve que la table des timeouts est bien PARTIE : elle vivait
  // sous ce titre, et aucune ligne de rôle ne doit subsister ici.
  it('no longer renders the per-role session timeout table', async () => {
    renderPage();
    await screen.findByTestId('pin-input-pin_max_failed');
    expect(screen.queryByText(/session timeouts/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('timeout-input-CASHIER')).not.toBeInTheDocument();
  });

  it('blocks the PIN save for out-of-bounds values', async () => {
    renderPage();
    const maxInput = await screen.findByTestId('pin-input-pin_max_failed');
    // Attendre l'init du draft (l'input reste disabled tant que la catégorie charge).
    await waitFor(() => expect(maxInput).not.toBeDisabled());
    fireEvent.change(maxInput, { target: { value: '11' } });
    expect(screen.getByTestId('pin-invalid-pin_max_failed')).toBeInTheDocument();
    expect(screen.getByTestId('pin-policy-save')).toBeDisabled();
  });

  it('disables the inputs when the user lacks settings.update', async () => {
    currentPerms.delete('settings.update');
    renderPage();
    const maxInput = await screen.findByTestId('pin-input-pin_max_failed');
    expect(maxInput).toBeDisabled();
    expect(screen.getByTestId('pin-policy-save')).toBeDisabled();
  });

  it('saving a dirty PIN field calls set_setting_v13 with the security category', async () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.fn() mock, no `this` to lose
    const rpcSpy = vi.mocked(supabase.rpc);
    renderPage();
    const lockInput = await screen.findByTestId('pin-input-pin_lockout_minutes');
    await waitFor(() => expect(lockInput).not.toBeDisabled());
    fireEvent.change(lockInput, { target: { value: '30' } });
    fireEvent.click(screen.getByTestId('pin-policy-save'));
    await waitFor(() => {
      expect(rpcSpy).toHaveBeenCalledWith('set_setting_v13', {
        p_key: 'pin_lockout_minutes',
        p_value: 30,
        p_category: 'security',
      });
    });
    // La clé propre (pin_max_failed) n'est pas réécrite.
    expect(rpcSpy).not.toHaveBeenCalledWith('set_setting_v13', expect.objectContaining({
      p_key: 'pin_max_failed',
    }));
  });
});
