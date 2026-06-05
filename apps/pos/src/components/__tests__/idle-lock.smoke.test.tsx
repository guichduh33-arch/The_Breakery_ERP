// apps/pos/src/components/__tests__/idle-lock.smoke.test.tsx
//
// DEV-S36-C-01 — POS idle now LOCKS the terminal (session-preserving) instead
// of logging out. lock() keeps the shift + cart; <TerminalLockedOverlay>
// handles re-PIN. Ratified reversal of the S35 "manual lock only" decision.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

let capturedOnTimeout: (() => void) | undefined;
vi.mock('@breakery/ui', async (orig) => {
  const actual = await orig<typeof import('@breakery/ui')>();
  return {
    ...actual,
    useIdleTimeout: (args: { onTimeout: () => void }) => {
      capturedOnTimeout = args.onTimeout;
    },
  };
});
vi.mock('@/lib/supabase', () => ({ supabaseUrl: 'http://test.local' }));
vi.mock('@breakery/supabase', async (orig) => {
  const actual = await orig<typeof import('@breakery/supabase')>();
  return { ...actual, getSession: vi.fn(), logoutSession: vi.fn(), setSupabaseAccessToken: vi.fn() };
});

import { IdleTimeoutMount } from '../IdleTimeoutMount';
import { useAuthStore } from '@/stores/authStore';

beforeEach(() => {
  capturedOnTimeout = undefined;
  useAuthStore.setState({ isAuthenticated: true, sessionTimeoutMinutes: 30, isLocked: false } as never);
});

describe('POS idle → lock (DEV-S36-C-01)', () => {
  it('locks instead of logging out on idle when authenticated', () => {
    render(<IdleTimeoutMount />);
    expect(typeof capturedOnTimeout).toBe('function');
    capturedOnTimeout?.();
    const s = useAuthStore.getState();
    expect(s.isLocked).toBe(true);
    expect(s.isAuthenticated).toBe(true); // session preserved — NOT logged out
  });

  it('does nothing when not authenticated (login screen)', () => {
    useAuthStore.setState({ isAuthenticated: false, isLocked: false } as never);
    render(<IdleTimeoutMount />);
    capturedOnTimeout?.();
    expect(useAuthStore.getState().isLocked).toBe(false);
  });
});
