import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
vi.mock('@/lib/supabase', () => ({ supabaseUrl: 'https://example.invalid' }));
import { IdleTimeoutMount } from '@/components/IdleTimeoutMount';
import { useAuthStore } from '@/stores/authStore';
import { localSessionFromServer } from '../localSession';
const now = Date.parse('2026-09-30T12:00:00Z');
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  useAuthStore.setState({ isAuthenticated: true, isLocked: false, sessionToken: 't', sessionTimeoutMinutes: 5,
    user: { id: 'u', full_name: 'Test', employee_code: 'E', role_code: 'cashier' },
    localSession: localSessionFromServer({ server_now: new Date(now).toISOString(), created_at: new Date(now - 60_000).toISOString(),
      last_activity_at: new Date(now - 290_000).toISOString() }, 5, 't', 'u', [], now) });
});
afterEach(() => vi.useRealTimers());
describe('échéances terminal', () => {
  it('reload/remontage ne redonne pas cinq minutes', () => {
    const view = render(<IdleTimeoutMount />);
    void act(() => vi.advanceTimersByTime(5_000));
    view.unmount();
    render(<IdleTimeoutMount />);
    void act(() => vi.advanceTimersByTime(5_000));
    expect(useAuthStore.getState().isLocked).toBe(true);
  });
  it('activité réelle renouvelle idle mais jamais la deadline absolue', () => {
    render(<IdleTimeoutMount />);
    const deadline = useAuthStore.getState().localSession!.expiresAt;
    void act(() => vi.advanceTimersByTime(5_000));
    fireEvent.keyDown(window, { key: 'a' });
    expect(useAuthStore.getState().localSession!.expiresAt).toBe(deadline);
    void act(() => vi.advanceTimersByTime(299_999));
    expect(useAuthStore.getState().isLocked).toBe(false);
    void act(() => vi.advanceTimersByTime(1));
    expect(useAuthStore.getState().isLocked).toBe(true);
  });
});
