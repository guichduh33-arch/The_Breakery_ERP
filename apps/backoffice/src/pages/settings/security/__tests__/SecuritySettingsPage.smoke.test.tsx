// apps/backoffice/src/pages/settings/security/__tests__/SecuritySettingsPage.smoke.test.tsx
// Session 19 / Phase 3.A — Smoke test for the per-role timeout editor.

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

const MOCK_ROLES = [
  { code: 'CASHIER', name: 'Cashier', session_timeout_minutes: 30 },
  { code: 'ADMIN',   name: 'Admin',   session_timeout_minutes: 120 },
];

interface RpcResult { data: unknown; error: { message: string } | null }

interface MockChain {
  select: () => MockChain;
  order:  () => Promise<RpcResult>;
}

vi.mock('@/lib/supabase.js', () => {
  function buildChain(): MockChain {
    const chain: MockChain = {
      select: () => chain,
      order:  () => Promise.resolve({ data: MOCK_ROLES, error: null }),
    };
    return chain;
  }
  return {
    supabase: {
      from: () => buildChain(),
      // ADR-006 déc. 9 : la page charge aussi la catégorie security (PIN policy).
      rpc: vi.fn().mockImplementation((fn: string) => {
        if (fn === 'get_settings_by_category_v7') {
          return Promise.resolve({
            data: { category: 'security', settings: { pin_max_failed: 5, pin_lockout_minutes: 15 } },
            error: null,
          });
        }
        return Promise.resolve({ data: true, error: null });
      }),
    },
  };
});

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

  it('renders the 2 mocked roles with their timeouts', async () => {
    renderPage();
    expect(await screen.findByText('CASHIER')).toBeInTheDocument();
    expect(screen.getByText('ADMIN')).toBeInTheDocument();
    await waitFor(() => {
      const cashierInput = screen.getByTestId<HTMLInputElement>('timeout-input-CASHIER');
      expect(cashierInput.value).toBe('30');
      const adminInput = screen.getByTestId<HTMLInputElement>('timeout-input-ADMIN');
      expect(adminInput.value).toBe('120');
    });
  });

  it('enables the save button when the timeout input changes to a valid value', async () => {
    renderPage();
    const input = await screen.findByTestId('timeout-input-CASHIER');
    const save  = screen.getByTestId('timeout-save-CASHIER');
    expect(save).toBeDisabled(); // not dirty yet
    fireEvent.change(input, { target: { value: '45' } });
    expect(save).not.toBeDisabled();
  });

  it('keeps the save button disabled for out-of-range input', async () => {
    renderPage();
    const input = await screen.findByTestId('timeout-input-CASHIER');
    fireEvent.change(input, { target: { value: '4' } });
    expect(screen.getByTestId('timeout-save-CASHIER')).toBeDisabled();
    expect(screen.getByTestId('timeout-invalid-CASHIER')).toBeInTheDocument();
  });

  it('disables inputs when the user lacks settings.update', async () => {
    currentPerms.delete('settings.update');
    renderPage();
    const input = await screen.findByTestId('timeout-input-CASHIER');
    expect(input).toBeDisabled();
    expect(screen.getByTestId('timeout-save-CASHIER')).toBeDisabled();
  });

  it('still renders read-only content without settings.read (route gate owns access)', async () => {
    currentPerms.clear();
    renderPage();
    expect(screen.getByText(/session timeouts/i)).toBeInTheDocument();
    const input = await screen.findByTestId('timeout-input-CASHIER');
    expect(input).toBeDisabled();
  });

  it('calls update_role_session_timeout_v1 with correct args when save is clicked', async () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.fn() mock, no `this` to lose
    const rpcSpy = vi.mocked(supabase.rpc);
    renderPage();
    const input = await screen.findByTestId('timeout-input-CASHIER');
    fireEvent.change(input, { target: { value: '45' } });
    fireEvent.click(screen.getByTestId('timeout-save-CASHIER'));
    await waitFor(() => {
      expect(rpcSpy).toHaveBeenCalledWith('update_role_session_timeout_v1', {
        p_role_code: 'CASHIER',
        p_minutes: 45,
      });
    });
  });

  // ADR-006 déc. 9 — PIN policy (lockout login configurable).
  it('renders the PIN policy card populated from the security category', async () => {
    renderPage();
    const maxInput = await screen.findByTestId<HTMLInputElement>('pin-input-pin_max_failed');
    expect(maxInput.value).toBe('5');
    expect(screen.getByTestId<HTMLInputElement>('pin-input-pin_lockout_minutes').value).toBe('15');
    expect(screen.getByTestId('pin-policy-save')).toBeDisabled(); // clean
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

  it('saving a dirty PIN field calls set_setting_v9 with the security category', async () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.fn() mock, no `this` to lose
    const rpcSpy = vi.mocked(supabase.rpc);
    renderPage();
    const lockInput = await screen.findByTestId('pin-input-pin_lockout_minutes');
    await waitFor(() => expect(lockInput).not.toBeDisabled());
    fireEvent.change(lockInput, { target: { value: '30' } });
    fireEvent.click(screen.getByTestId('pin-policy-save'));
    await waitFor(() => {
      expect(rpcSpy).toHaveBeenCalledWith('set_setting_v9', {
        p_key: 'pin_lockout_minutes',
        p_value: 30,
        p_category: 'security',
      });
    });
    // La clé propre (pin_max_failed) n'est pas réécrite.
    expect(rpcSpy).not.toHaveBeenCalledWith('set_setting_v9', expect.objectContaining({
      p_key: 'pin_max_failed',
    }));
  });
});
