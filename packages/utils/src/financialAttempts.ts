export interface FinancialAttemptScope<O extends string = string> {
  environment: string; profileId: string; operation: O; target: string;
}
export type FinancialAttemptSlot<P, O extends string = string> = {
  version: 1; revision: string; operation: O; target: string;
} & ({ status: 'resolved' } | { status: 'pending'; idempotencyKey: string; payload: P });

export class FinancialAttemptError extends Error {
  constructor(message: string, public readonly definitive = false) { super(message); }
}
export const PENDING_MESSAGE = 'The result is unconfirmed. Check this pending attempt using the same details and key before starting another.';
const STORAGE_ERROR = 'Recovery storage is unavailable or invalid. Restore storage before continuing.';
const CHANGE_EVENT = 'financial-attempt-change';
export const FINANCIAL_ATTEMPT_PREFIX = 'breakery:financial-attempt:v1:';
export function financialStorageKey(scope: FinancialAttemptScope): string {
  return FINANCIAL_ATTEMPT_PREFIX + [scope.environment, scope.profileId, scope.operation, scope.target].map(encodeURIComponent).join(':');
}
export function subscribeFinancialAttempts(listener: () => void): () => void {
  window.addEventListener('storage', listener);
  window.addEventListener(CHANGE_EVENT, listener);
  return () => { window.removeEventListener('storage', listener); window.removeEventListener(CHANGE_EVENT, listener); };
}

/** Mécanique commune ; schémas métier et contrôles d'identité restent dans les apps. */
export function createFinancialAttempts<M extends object>(validation: {
  validPayload: (operation: keyof M & string, target: string, value: unknown) => boolean;
  validSlot: (value: unknown, scope: FinancialAttemptScope<keyof M & string>) => boolean;
}) {
  type Operation = keyof M & string;
  type Scope<K extends Operation = Operation> = FinancialAttemptScope<K>;
  type Slot<K extends Operation = Operation> = FinancialAttemptSlot<M[K], K>;
  function readFinancialSlot<K extends Operation>(scope: Scope<K>): Slot<K> | null {
    try {
      const raw = localStorage.getItem(financialStorageKey(scope));
      if (raw === null) return null;
      const value: unknown = JSON.parse(raw);
      if (!validation.validSlot(value, scope)) throw new Error();
      return value as Slot<K>;
    } catch { throw new FinancialAttemptError(STORAGE_ERROR); }
  }
  function writeSlot(scope: Scope, slot: Slot): void {
    try {
      const key = financialStorageKey(scope);
      const value = JSON.stringify(slot);
      localStorage.setItem(key, value);
      if (localStorage.getItem(key) !== value) throw new Error();
      window.dispatchEvent(new Event(CHANGE_EVENT));
    } catch { throw new FinancialAttemptError(STORAGE_ERROR); }
  }
  function pendingFinancialTargets(environment: string, profileId: string, operation: Operation): string[] {
    try {
      const prefix = FINANCIAL_ATTEMPT_PREFIX + [environment, profileId, operation].map(encodeURIComponent).join(':') + ':';
      const targets: string[] = [];
      for (let index = 0; index < localStorage.length; index++) {
        const key = localStorage.key(index);
        if (!key?.startsWith(prefix)) continue;
        const target = decodeURIComponent(key.slice(prefix.length));
        if (readFinancialSlot({ environment, profileId, operation, target })?.status === 'pending') targets.push(target);
      }
      return targets;
    } catch { throw new FinancialAttemptError(STORAGE_ERROR); }
  }
  async function runFinancialAttempt<K extends Operation, R>(options: {
    scope: Scope<K>; expectedRevision: string | null; payload: M[K]; current: () => boolean;
    send: (payload: M[K], key: string) => Promise<R>; onRevision?: (revision: string) => void;
  }): Promise<R> {
    const { scope, current } = options;
    if (!navigator.locks?.request) throw new FinancialAttemptError('Secure tab locking is unavailable. No request was sent. Use a supported browser.');
    let entered = false;
    try {
      return await navigator.locks.request(financialStorageKey(scope), { mode: 'exclusive', ifAvailable: true }, async (lock) => {
        if (!lock) throw new FinancialAttemptError('This operation is being checked in another tab. No request was sent.');
        entered = true;
        if (!current()) throw new FinancialAttemptError('Your session changed. Reopen this form before continuing.');
        const previous = readFinancialSlot(scope);
        if ((previous?.revision ?? null) !== options.expectedRevision) throw new FinancialAttemptError('This operation changed in another tab. Close and reopen this form to check its latest result.');
        const wasPending = previous?.status === 'pending';
        if (!wasPending && !validation.validPayload(scope.operation, scope.target, options.payload)) throw new FinancialAttemptError('The payment or refund details are invalid. No request was sent.');
        const pending: Slot<K> = wasPending ? previous : { version: 1, revision: crypto.randomUUID(), operation: scope.operation,
          target: scope.target, status: 'pending', payload: options.payload, idempotencyKey: crypto.randomUUID() };
        writeSlot(scope, pending);
        options.onRevision?.(pending.revision);
        if (!current()) throw new FinancialAttemptError('Your session changed. Reopen this form before continuing.');
        const resolve = () => {
          const revision = crypto.randomUUID();
          writeSlot(scope, { version: 1, revision, operation: scope.operation, target: scope.target, status: 'resolved' });
          options.onRevision?.(revision);
        };
        try { const result = await options.send(pending.payload, pending.idempotencyKey); resolve(); return result; }
        catch (error) {
          // Un refus de reprise n'invalide jamais le résultat perdu du premier appel.
          if (!wasPending && error instanceof FinancialAttemptError && error.definitive) resolve();
          throw error;
        }
      });
    } catch (error) {
      if (entered || error instanceof FinancialAttemptError) throw error;
      throw new FinancialAttemptError('Secure tab locking failed. No request was sent. Close and reopen this form.');
    }
  }
  return { readFinancialSlot, pendingFinancialTargets, runFinancialAttempt };
}
