// apps/backoffice/src/features/users/__tests__/DeleteUserDialog.lastAdmin.test.tsx
//
// Session 13 / Phase 5.D — DeleteUserDialog surfaces LAST_ADMIN_PROTECTED.
//
// Asserts : when the RPC returns an error whose message contains
// "LAST_ADMIN_PROTECTED", the dialog renders a guard message via the
// `data-testid="last-admin-guard"` slot and the close handler is NOT called.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DeleteUserDialog } from '../components/DeleteUserDialog.js';

const rpcMock = vi.fn();
vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}));

function renderDialog() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onClose = vi.fn();
  const utils = render(
    <QueryClientProvider client={qc}>
      <DeleteUserDialog
        userId="00000000-0000-0000-0000-000000000001"
        fullName="Mamat (Owner)"
        onClose={onClose}
      />
    </QueryClientProvider>,
  );
  return { ...utils, onClose };
}

describe('DeleteUserDialog — last-admin guard', () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it('surfaces LAST_ADMIN_PROTECTED guard message and keeps dialog open', async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: {
        message: 'LAST_ADMIN_PROTECTED: cannot delete the last remaining admin',
        code: 'P0001',
      },
    });

    const { onClose } = renderDialog();
    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: 'test attempt' } });
    fireEvent.click(screen.getByRole('button', { name: /delete user/i }));

    await waitFor(() => {
      expect(screen.getByTestId('last-admin-guard')).toBeInTheDocument();
    });
    expect(screen.getByTestId('last-admin-guard').textContent ?? '')
      .toMatch(/last remaining/i);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes dialog when RPC returns success', async () => {
    rpcMock.mockResolvedValueOnce({
      data: { deleted_at: '2026-05-14T12:00:00Z', revoked_session_count: 1 },
      error: null,
    });

    const { onClose } = renderDialog();
    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: 'left the company' } });
    fireEvent.click(screen.getByRole('button', { name: /delete user/i }));

    await waitFor(() => { expect(onClose).toHaveBeenCalled(); });
  });
});
