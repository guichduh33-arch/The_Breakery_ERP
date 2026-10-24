export interface RevocationStatus { pending: number; busy: boolean; storageError: boolean }
interface RevocationOptions {
  environment: string | (() => string);
  storageKey: string;
  send: (token: string) => Promise<void>;
  storage?: () => Storage;
}

/** Journal tab-scoped sur le support d'auth existant ; seuls les secrets opaques y vivent. */
export function createSessionRevocations({ environment, storageKey, send,
  storage = () => sessionStorage }: RevocationOptions) {
  let resolvedKey: string | null = null;
  const key = () => resolvedKey ??= `${storageKey}:pending-logouts:${encodeURIComponent(typeof environment === 'function' ? environment() : environment)}`;
  const tokens = new Set<string>();
  const listeners = new Set<() => void>();
  let status: RevocationStatus = { pending: 0, busy: false, storageError: false };
  let flight: Promise<void> | null = null;
  let corrupt = false;
  const publish = (next: Partial<RevocationStatus>) => {
    status = { ...status, pending: tokens.size, ...next };
    for (const listener of listeners) listener();
  };
  function load() {
    try {
      const raw = storage().getItem(key());
      if (!raw) return;
      const value: unknown = JSON.parse(raw);
      if (!Array.isArray(value) || !value.every((token: unknown): token is string =>
        typeof token === 'string' && token.length > 0 && token.length <= 1024)) {
        corrupt = true;
        throw new Error('Invalid revocation journal');
      }
      for (const token of value) tokens.add(token);
    } catch { if (corrupt || tokens.size > 0) publish({ storageError: true }); }
  }
  function save(): boolean {
    try {
      if (corrupt) return false;
      const value = JSON.stringify([...tokens]);
      storage().setItem(key(), value);
      if (storage().getItem(key()) !== value) throw new Error('Revocation journal not persisted');
      publish({ storageError: false });
      return true;
    } catch { publish({ storageError: true }); return false; }
  }
  function enqueue(token: string) {
    if (typeof token !== 'string' || !token || token.length > 1024) { publish({ storageError: true }); return; }
    load();
    tokens.add(token);
    // Retirer seulement l'ancienne identité d'auth : panier et files ne sont pas touchés.
    // Cela libère aussi la place si le quota empêchait d'écrire le petit journal.
    try {
      const raw = storage().getItem(storageKey);
      if (raw) {
        const auth = JSON.parse(raw) as { state?: { sessionToken?: unknown } };
        if (auth.state?.sessionToken === token) storage().removeItem(storageKey);
      }
    } catch { publish({ storageError: true }); }
    save();
    publish({});
  }
  function retry(): Promise<void> {
    if (flight) return flight;
    load();
    if (tokens.size > 0) save();
    publish({ busy: true });
    const work = (async () => {
      // Une réponse de A ne possède aucun effet sur l'utilisateur B.
      for (const token of tokens) {
        try { await send(token); } catch { continue; }
        tokens.delete(token);
        save();
      }
      if (tokens.size === 0 && status.storageError) save();
    })();
    flight = work.finally(() => { flight = null; publish({ busy: false }); });
    return flight;
  }
  function start(target: EventTarget = window): () => void {
    const wake = () => { void retry(); };
    // Le LAN peut rester connecté pendant une panne WAN, sans événement online.
    const timer = setInterval(() => { if (tokens.size > 0) wake(); }, 15_000);
    target.addEventListener('online', wake);
    wake();
    return () => { clearInterval(timer); target.removeEventListener('online', wake); };
  }
  // Un import du store n'initialise ni la configuration cloud ni un accès réseau.
  if (typeof environment === 'string') load();
  publish({});
  return { enqueue, retry, start, getSnapshot: () => status,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; } };
}
