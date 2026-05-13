// apps/backoffice/src/features/users/__tests__/UserFormDialog.smoke.test.tsx
//
// Session 13 / Phase 5.D — smoke test for UserFormDialog.
//
// Goals :
//   1. Renders the four core fields (employee_code, full_name, role, pin).
//   2. Validates locally (pin must be 4-8 digits, names min length) before RPC call.
//   3. Calls create_user_v1 RPC with trimmed/uppercased fields on submit.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { UserFormDialog } from '../components/UserFormDialog.js';

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
  const onCreated = vi.fn();
  const utils = render(
    <QueryClientProvider client={qc}>
      <UserFormDialog
        onClose={onClose}
        onCreated={onCreated}
        roles={[
          { code: 'MANAGER', name: 'Manager' },
          { code: 'CASHIER', name: 'Cashier' },
        ]}
      />
    </QueryClientProvider>,
  );
  return { ...utils, onClose, onCreated };
}

describe('UserFormDialog — smoke', () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it('renders all four core fields', () => {
    renderDialog();
    expect(screen.getByLabelText(/employee code/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/full name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/role/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/pin/i)).toBeInTheDocument();
  });

  it('blocks submission until pin is 4-8 digits', async () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText(/employee code/i), { target: { value: 'EMP010' } });
    fireEvent.change(screen.getByLabelText(/full name/i),     { target: { value: 'Test User' } });
    fireEvent.change(screen.getByLabelText(/pin/i),           { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: /create user/i }));

    expect(rpcMock).not.toHaveBeenCalled();
    expect(await screen.findByText(/4 to 8 digits/i)).toBeInTheDocument();
  });

  it('submits with trimmed/uppercased employee_code on valid input', async () => {
    rpcMock.mockResolvedValueOnce({
      data: '00000000-0000-0000-0000-000000000999',
      error: null,
    });
    const { onClose, onCreated } = renderDialog();
    fireEvent.change(screen.getByLabelText(/employee code/i), { target: { value: '  emp010 ' } });
    fireEvent.change(screen.getByLabelText(/full name/i),     { target: { value: '  Test User  ' } });
    fireEvent.change(screen.getByLabelText(/pin/i),           { target: { value: '1234' } });
    fireEvent.click(screen.getByRole('button', { name: /create user/i }));

    await waitFor(() => {
      expect(rpcMock).toHaveBeenCalledWith('create_user_v1', {
        p_employee_code: 'EMP010',
        p_full_name:     'Test User',
        p_role_code:     'MANAGER',  // first in list
        p_pin:           '1234',
      });
    });
    await waitFor(() => { expect(onCreated).toHaveBeenCalled(); });
    await waitFor(() => { expect(onClose).toHaveBeenCalled(); });
  });
});
