export interface ActivitySession {
  sessionToken: string | null;
  isAuthenticated: boolean;
  isLocked?: boolean;
}

interface SessionActivityOptions {
  getSession: () => ActivitySession;
  send: (token: string) => Promise<void>;
  onExpired: () => void;
  target?: EventTarget;
  isOnline?: () => boolean;
}

const EVENTS = ['mousedown', 'keydown', 'touchstart', 'scroll'];
const MIN_INTERVAL_MS = 60_000;

/** Activité utilisateur uniquement : aucun tick périodique ni rattrapage hors ligne. */
export function startSessionActivity({
  getSession, send, onExpired, target = window, isOnline = () => navigator.onLine,
}: SessionActivityOptions): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: string | null = null;
  let lastToken: string | null = null;
  let lastAttempt = -Infinity;
  let sending = false;
  let disposed = false;

  const eligibleToken = (): string | null => {
    const session = getSession();
    return session.isAuthenticated && !session.isLocked && isOnline() ? session.sessionToken : null;
  };

  const flush = async (): Promise<void> => {
    timer = undefined;
    const token = pending;
    pending = null;
    if (disposed || !token || token !== eligibleToken()) return;
    if (sending) { pending = token; return; }
    sending = true;
    lastToken = token;
    lastAttempt = Date.now();
    try {
      await send(token);
    } catch (error: unknown) {
      if (!disposed && (error as { status?: number }).status === 401 && getSession().sessionToken === token) onExpired();
      // Une panne réseau conserve l'état local ; seule une NOUVELLE activité peut réessayer.
    } finally {
      sending = false;
      if (!disposed && pending && timer === undefined) schedule();
    }
  };

  const schedule = (): void => {
    if (timer !== undefined || sending) return;
    const delay = pending === lastToken ? Math.max(0, MIN_INTERVAL_MS - (Date.now() - lastAttempt)) : 0;
    if (delay === 0) void flush();
    else timer = setTimeout(() => { void flush(); }, delay);
  };

  const activity = (): void => {
    pending = eligibleToken();
    if (!pending) {
      clearTimeout(timer);
      timer = undefined;
      return;
    }
    schedule();
  };
  for (const event of EVENTS) target.addEventListener(event, activity, { passive: true });
  return () => {
    disposed = true;
    pending = null;
    clearTimeout(timer);
    for (const event of EVENTS) target.removeEventListener(event, activity);
  };
}
