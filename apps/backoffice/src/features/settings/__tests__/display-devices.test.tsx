import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const { invoke, state } = vi.hoisted(() => ({ invoke: vi.fn(), state: { allowed: true } }));
vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (select: (value: unknown) => unknown) => select({ hasPermission: () => state.allowed, sessionToken: 'session-test' }),
}));
vi.mock('@/lib/supabase.js', () => ({ supabase: { functions: { invoke } } }));
import { DisplayDevices } from '../components/DisplayDevices';
function mount() {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><DisplayDevices /></QueryClientProvider>);
}
beforeEach(() => {
  vi.clearAllMocks(); state.allowed = true;
  invoke.mockImplementation((_name: string, { body }: { body: { action: string } }) => Promise.resolve({
    error: null, data: body.action === 'list'
      ? [{ id: 'device', label: 'Front', paired_at: '2026-09-26', revoked_at: null, pairing_expires_at: '2026-09-26' }]
      : body.action === 'create' ? { id: 'new', pairing_code: 'abcdef0123456789', expires_at: '2026-09-26T14:00:00Z' } : { ok: true },
  }));
});
describe('gestion des écrans autorisés', () => {
  it('ne propose aucune action sans permission', () => {
    state.allowed = false; mount();
    expect(screen.queryByText('Authorized displays')).not.toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalled();
  });
  it('crée le code sous la session courante', async () => {
    mount();
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Counter' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create pairing code' }));
    expect(await screen.findByText('abcd-ef01-2345-6789')).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith('kiosk-issue-jwt', {
      body: { action: 'create', label: 'Counter' }, headers: { 'x-session-token': 'session-test' },
    });
  });
  it('demande confirmation avant la révocation', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke access' }));
    expect(invoke).not.toHaveBeenCalledWith('kiosk-issue-jwt', expect.objectContaining({ body: { action: 'revoke', device_id: 'device' } }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm revoke' }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('kiosk-issue-jwt', {
      body: { action: 'revoke', device_id: 'device' }, headers: { 'x-session-token': 'session-test' },
    }));
  });
});
