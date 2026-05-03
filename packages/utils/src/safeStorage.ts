// packages/utils/src/safeStorage.ts
// Wrappage localStorage/sessionStorage Capacitor-ready.
/* eslint-disable @typescript-eslint/require-await */
// En web : sessionStorage (tab-scoped, cleared on close).
// En Capacitor (futur) : @capacitor/preferences.
// L'API est asynchrone partout pour préparer Capacitor.

export interface SafeStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  clear(): Promise<void>;
}

function isWeb(): boolean {
  return typeof sessionStorage !== 'undefined';
}

export const safeStorage: SafeStorage = {
  async get(key) {
    /* v8 ignore next */
    if (!isWeb()) return null;
    try {
      return sessionStorage.getItem(key);
    } catch {
      return null;
    }
  },
  async set(key, value) {
    /* v8 ignore next */
    if (!isWeb()) return;
    try {
      sessionStorage.setItem(key, value);
    } catch {
      // ignore quota / disabled storage
    }
  },
  async remove(key) {
    /* v8 ignore next */
    if (!isWeb()) return;
    try {
      sessionStorage.removeItem(key);
    } catch {
      // ignore
    }
  },
  async clear() {
    /* v8 ignore next */
    if (!isWeb()) return;
    try {
      sessionStorage.clear();
    } catch {
      // ignore
    }
  },
};
