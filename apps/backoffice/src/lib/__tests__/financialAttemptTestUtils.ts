import { vi } from 'vitest';
import { create } from 'zustand';

export const financialTestAuth = create(() => ({
  user: { id: 'profile-a', full_name: 'Operator A', role_code: 'ADMIN', employee_code: 'A' },
  sessionToken: 'session-a-secret', isAuthenticated: true, isLoading: false,
  hasPermission: (_code: string): boolean => true,
}));

export function resetFinancialSession() {
  financialTestAuth.setState({ user: { id: 'profile-a', full_name: 'Operator A', role_code: 'ADMIN', employee_code: 'A' },
    sessionToken: 'session-a-secret', isAuthenticated: true, isLoading: false, hasPermission: () => true });
}

/** Deux documents partagent ce gestionnaire, comme les Web Locks d'une origine. */
export function installFinancialBrowser() {
  localStorage.clear();
  const held = new Set<string>();
  const request = vi.fn(async (name: string, options: LockOptions, callback: (lock: Lock | null) => Promise<unknown>) => {
    if (!options.ifAvailable || options.mode !== 'exclusive') throw new Error('Expected exclusive native lock');
    if (held.has(name)) return callback(null);
    held.add(name);
    try { return await callback({ name, mode: 'exclusive' }); }
    finally { held.delete(name); }
  });
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request } });
  return { request, held };
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
