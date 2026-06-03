/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useAuthStore } from '@/stores/authStore';
import { TerminalLockedOverlay } from '../TerminalLockedOverlay';

const loginMock = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({
    user: { id: 'u1', full_name: 'Alice', role_code: 'CASHIER', employee_code: 'E1' },
    sessionToken: 'tok', permissions: [], isAuthenticated: true, isLoading: false,
    error: null, sessionTimeoutMinutes: 30, isLocked: true,
    login: loginMock, unlock: () => useAuthStore.setState({ isLocked: false } as never),
  } as never);
});

describe('TerminalLockedOverlay', () => {
  it('renders the locked state with the current user name', () => {
    render(<TerminalLockedOverlay />);
    expect(screen.getByText(/locked/i)).toBeInTheDocument();
    expect(screen.getByText(/Alice/)).toBeInTheDocument();
  });

  it('a correct PIN re-auths via login() and unlocks', async () => {
    render(<TerminalLockedOverlay />);
    // NumpadPin uses a `Numpad` (digit buttons aria-labelled "0".."9") and an
    // explicit "Verify" button — it does NOT auto-submit. Enter 6 digits then
    // click Verify to fire onSubmit(pin).
    for (const d of '123456') {
      fireEvent.click(screen.getByRole('button', { name: d }));
    }
    fireEvent.click(screen.getByRole('button', { name: /verify/i }));
    await waitFor(() => expect(loginMock).toHaveBeenCalledWith('u1', '123456'));
    await waitFor(() => expect(useAuthStore.getState().isLocked).toBe(false));
  });

  it('clears the PIN buffer after a wrong attempt so the next PIN is not concatenated', async () => {
    loginMock.mockRejectedValueOnce(new Error('bad')).mockResolvedValueOnce(undefined);
    render(<TerminalLockedOverlay />);
    // wrong PIN
    for (const d of '111111') fireEvent.click(screen.getByRole('button', { name: d }));
    fireEvent.click(screen.getByRole('button', { name: /verify/i }));
    await waitFor(() => expect(screen.getByText(/incorrect pin/i)).toBeInTheDocument());
    // second attempt — if the buffer were NOT reset, Numpad maxLength=6 would keep '111111'
    for (const d of '222222') fireEvent.click(screen.getByRole('button', { name: d }));
    fireEvent.click(screen.getByRole('button', { name: /verify/i }));
    await waitFor(() => expect(loginMock).toHaveBeenLastCalledWith('u1', '222222'));
  });
});
