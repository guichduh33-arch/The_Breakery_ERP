// apps/backoffice/src/pages/settings/security/__tests__/SecuritySettingsPage.smoke.test.tsx
// Session 19 / Phase 3.A — Smoke test for the per-role timeout editor.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import SecuritySettingsPage from '@/pages/settings/security/SecuritySettingsPage.js';

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
      rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
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
    currentPerms.clear();
    currentPerms.add('settings.read');
    currentPerms.add('settings.update');
  });

  it('renders the 2 mocked roles with their timeouts', async () => {
    renderPage();
    expect(await screen.findByText('CASHIER')).toBeInTheDocument();
    expect(screen.getByText('ADMIN')).toBeInTheDocument();
    await waitFor(() => {
      const cashierInput = screen.getByTestId('timeout-input-CASHIER') as HTMLInputElement;
      expect(cashierInput.value).toBe('30');
      const adminInput = screen.getByTestId('timeout-input-ADMIN') as HTMLInputElement;
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

  it('hides the page entirely when settings.read is missing', () => {
    currentPerms.clear();
    renderPage();
    expect(screen.getByText(/do not have permission/i)).toBeInTheDocument();
  });
});
