// Fenêtre de désactivation / réactivation (S1-07) : arguments envoyés à la
// fonction, motif exigé, refus métier rendus lisibles sans fermer la fenêtre.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SetUserActiveDialog } from '../components/SetUserActiveDialog.js';

const rpcMock = vi.fn();
vi.mock('@/lib/supabase.js', () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) as unknown },
}));

const USER_ID = '00000000-0000-0000-0000-000000000001';

function renderDialog(activate: boolean) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <SetUserActiveDialog userId={USER_ID} fullName="Ayu" activate={activate} onClose={onClose} />
    </QueryClientProvider>,
  );
  return { onClose };
}

describe('SetUserActiveDialog', () => {
  beforeEach(() => { rpcMock.mockReset(); });

  it('deactivates with a trimmed reason, then closes', async () => {
    rpcMock.mockResolvedValueOnce({ data: { is_active: false, revoked_session_count: 1 }, error: null });
    const { onClose } = renderDialog(false);
    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: '  left the company ' } });
    fireEvent.click(screen.getByRole('button', { name: /deactivate user/i }));
    await waitFor(() => { expect(onClose).toHaveBeenCalledTimes(1); });
    expect(rpcMock).toHaveBeenCalledWith('set_user_active_v1', {
      p_user_id: USER_ID, p_is_active: false, p_reason: 'left the company',
    });
  });

  it('reactivates with p_is_active true', async () => {
    rpcMock.mockResolvedValueOnce({ data: { is_active: true, revoked_session_count: 0 }, error: null });
    renderDialog(true);
    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: 'back from leave' } });
    fireEvent.click(screen.getByRole('button', { name: /reactivate user/i }));
    await waitFor(() => { expect(rpcMock).toHaveBeenCalledTimes(1); });
    expect(rpcMock.mock.calls[0]?.[1]).toMatchObject({ p_is_active: true });
  });

  it('requires a reason before calling the server', () => {
    renderDialog(false);
    fireEvent.click(screen.getByRole('button', { name: /deactivate user/i }));
    expect(screen.getByTestId('set-active-error')).toHaveTextContent(/at least 3 characters/i);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('shows the last-admin refusal and stays open', async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'LAST_ADMIN_PROTECTED: cannot deactivate the last remaining admin', code: 'P0001' },
    });
    const { onClose } = renderDialog(false);
    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: 'test attempt' } });
    fireEvent.click(screen.getByRole('button', { name: /deactivate user/i }));
    await waitFor(() => { expect(screen.getByTestId('set-active-error')).toHaveTextContent(/last active/i); });
    expect(onClose).not.toHaveBeenCalled();
  });
});
