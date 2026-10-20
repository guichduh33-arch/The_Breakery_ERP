import { vi } from 'vitest';

/** Gestionnaire partagé : les verrous sans ifAvailable attendent leur tour. */
export function installPrintLocks() {
  const tails = new Map<string, Promise<void>>();
  const held = new Set<string>();
  const request = vi.fn((name: string, options: LockOptions, callback: (lock: Lock | null) => unknown) => {
    const previous = tails.get(name);
    if (options.ifAvailable && previous) return Promise.resolve().then(() => callback(null));
    const operation = (previous ?? Promise.resolve()).then(async () => {
      held.add(name);
      try { return await callback({ name, mode: 'exclusive' }); } finally { held.delete(name); }
    });
    const settled = operation.then(() => undefined, () => undefined);
    tails.set(name, settled);
    void settled.then(() => { if (tails.get(name) === settled) tails.delete(name); });
    return operation;
  });
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request } });
  return { request, held };
}
