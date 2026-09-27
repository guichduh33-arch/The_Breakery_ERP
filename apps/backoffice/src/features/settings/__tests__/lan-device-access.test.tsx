import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const { invoke, state } = vi.hoisted(() => ({ invoke: vi.fn(), state: { allowed: true } }));
vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (select: (value: unknown) => unknown) =>
    select({ hasPermission: () => state.allowed, sessionToken: 'session-test' }),
}));
vi.mock('@/lib/supabase.js', () => ({ supabase: { functions: { invoke } } }));
import { LanDeviceAccess } from '../../lan-devices/components/LanDeviceAccess';
function mount() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <LanDeviceAccess />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  state.allowed = true;
  invoke.mockImplementation((_name: string, { body }: { body: { action: string } }) =>
    Promise.resolve({
      error: null,
      data:
        body.action === 'list'
          ? [
              {
                id: 'device',
                name: 'Counter',
                code: 'POS',
                is_active: true,
                paired_at: '2026-09-27',
                revoked_at: null,
                permissions: ['orders.publish'],
              },
            ]
          : body.action === 'issue'
            ? { pairing_code: 'test-activation', expires_at: '2026-09-27T14:00:00Z' }
            : { ok: true },
    }),
  );
});
describe('LAN terminal authorization', () => {
  it('does not fetch or offer controls without management permission', () => {
    state.allowed = false;
    mount();
    expect(screen.queryByText('Authorized LAN terminals')).not.toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalled();
  });
  it.each([
    ['Create activation code', 'issue'],
    ['Revoke', 'revoke'],
  ])('confirms %s under the employee session', async (label, action) => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: label }));
    expect(invoke).not.toHaveBeenCalledWith(
      'lan-device-access',
      expect.objectContaining({ body: { action, device_id: 'device' } }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('lan-device-access', {
        body: { action, device_id: 'device' },
        headers: { 'x-session-token': 'session-test' },
      }),
    );
    if (action === 'issue') expect(await screen.findByText('test-activation')).toBeInTheDocument();
  });
  it('saves explicitly selected capabilities', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Permissions' }));
    fireEvent.click(screen.getByLabelText('Open cash drawer'));
    fireEvent.click(screen.getByRole('button', { name: 'Save permissions' }));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('lan-device-access', {
        body: {
          action: 'permissions',
          device_id: 'device',
          permissions: ['orders.publish', 'drawer.open'],
        },
        headers: { 'x-session-token': 'session-test' },
      }),
    );
  });
});
