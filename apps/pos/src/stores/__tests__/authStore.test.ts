// apps/pos/src/stores/__tests__/authStore.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAuthStore } from '../authStore';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      setSession: vi.fn(),
      signOut: vi.fn().mockResolvedValue({}),
    },
  },
  supabaseUrl: 'http://localhost:54321',
}));

describe('authStore initial state', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: null, sessionToken: null, permissions: [], isAuthenticated: false, isLoading: false, error: null });
  });

  it('is unauthenticated by default', () => {
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });

  it('hasPermission returns false when no permissions', () => {
    expect(useAuthStore.getState().hasPermission('pos.sale.create')).toBe(false);
  });

  it('hasPermission returns true when granted', () => {
    useAuthStore.setState({ permissions: ['pos.sale.create'] });
    expect(useAuthStore.getState().hasPermission('pos.sale.create')).toBe(true);
  });
});
