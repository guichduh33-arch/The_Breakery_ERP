import type { CartItem } from '@breakery/domain';
import type { Database } from '@breakery/supabase';

export type CounterFireArgs = Database['public']['Functions']['fire_counter_order_v10']['Args'];
export interface CounterFireScope {
  project: string;
  userId: string;
  session: string | null;
  shiftId: string;
}
export interface CounterFireAttempt {
  version: 1;
  scope: CounterFireScope;
  args: CounterFireArgs;
  items: CartItem[];
  additional: boolean;
  tableNumber?: string;
}
const KEY = 'breakery.counter-fire-attempt.v1';

export function hasPendingCounterFire(): boolean {
  // Un snapshot illisible reste une tentative à récupérer, jamais un feu vert.
  try { return sessionStorage.getItem(KEY) !== null; } catch { return true; }
}

/** Même onglet, même requête : une réponse perdue ne crée pas une nouvelle commande. */
export function readCounterFire(): CounterFireAttempt | null {
  const raw = sessionStorage.getItem(KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as CounterFireAttempt;
    if (value.version !== 1 || !value.scope || !value.args?.p_client_uuid
      || !Array.isArray(value.args.p_items) || !Array.isArray(value.items)
      || typeof value.scope.project !== 'string' || typeof value.scope.userId !== 'string'
      || typeof value.scope.shiftId !== 'string') throw new Error();
    return value;
  } catch {
    throw new Error('Saved order send could not be read — ask a manager to recover this terminal');
  }
}

export function resumeCounterFire(scope: CounterFireScope): CounterFireAttempt | null {
  const saved = readCounterFire();
  if (saved && (saved.scope.project !== scope.project || saved.scope.userId !== scope.userId
    || saved.scope.session !== scope.session || saved.scope.shiftId !== scope.shiftId)) {
    throw new Error('Resume the saved order send with the original cashier, session and shift');
  }
  return saved;
}

export function saveCounterFire(attempt: CounterFireAttempt): CounterFireAttempt {
  const raw = JSON.stringify(attempt);
  // L'écriture précède le départ réseau ; une saturation du stockage interdit l'envoi.
  sessionStorage.setItem(KEY, raw);
  return JSON.parse(raw) as CounterFireAttempt;
}

export function clearCounterFire(): void { sessionStorage.removeItem(KEY); }

/** Un refus Postgres explicite précède le commit ; transport/ACK restent incertains. */
export function isDefiniteFireRefusal(error: { code?: string }): boolean {
  return /^(22|23|42|P000)/.test(error.code ?? '');
}

/** Le jeton de session ne voyage pas dans le snapshot de reprise. */
export async function counterFireScope(userId: string, token: string | null, shiftId: string): Promise<CounterFireScope> {
  const digest = token ? await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)) : null;
  const configuredProject: unknown = import.meta.env.VITE_SUPABASE_URL;
  return { project: typeof configuredProject === 'string' ? configuredProject : '', userId, shiftId,
    session: digest ? Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('') : null };
}
