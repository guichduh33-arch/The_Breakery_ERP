/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useAuthStore } from '@/stores/authStore';
import { TerminalLockedOverlay } from '@/features/auth/TerminalLockedOverlay';

describe('POS lock terminal wiring', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: { id: 'u1', full_name: 'Bob', role_code: 'CASHIER', employee_code: 'E1' },
      sessionToken: 'tok', permissions: [], isAuthenticated: true, isLoading: false,
      error: null, sessionTimeoutMinutes: 30, isLocked: true,
      login: async () => {}, unlock: () => {},
    } as never);
  });

  it('renders TerminalLockedOverlay when authStore.isLocked is true', () => {
    render(<TerminalLockedOverlay />);
    expect(screen.getByRole('heading', { name: /terminal locked/i })).toBeInTheDocument();
  });
});
