import { describe, it, expect, beforeEach } from 'vitest';
import { useAuthStore } from '../authStore';

const AUTHED = {
  user: { id: 'u1', full_name: 'Tester', role_code: 'CASHIER', employee_code: 'E1' },
  sessionToken: 'tok',
  permissions: ['pos.sale.create'],
  isAuthenticated: true,
  isLoading: false,
  error: null,
  sessionTimeoutMinutes: 30,
  isLocked: false,
} as const;

describe('authStore lock/unlock', () => {
  beforeEach(() => { useAuthStore.setState({ ...AUTHED } as never); });

  it('lock() sets isLocked true but preserves session, user, permissions', () => {
    useAuthStore.getState().lock();
    const s = useAuthStore.getState();
    expect(s.isLocked).toBe(true);
    expect(s.user?.id).toBe('u1');
    expect(s.sessionToken).toBe('tok');
    expect(s.permissions).toEqual(['pos.sale.create']);
    expect(s.isAuthenticated).toBe(true);
  });

  it('unlock() clears isLocked without touching the session', () => {
    useAuthStore.getState().lock();
    useAuthStore.getState().unlock();
    const s = useAuthStore.getState();
    expect(s.isLocked).toBe(false);
    expect(s.sessionToken).toBe('tok');
  });
});
