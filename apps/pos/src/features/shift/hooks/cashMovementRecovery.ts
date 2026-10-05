import { counterFireScope, type CounterFireScope } from '@/features/cart/hooks/counterFireRecovery';
import type { CashMovementInput, CashMovementReasonCode } from './useCashMovement';

export interface CashMovementAttempt {
  version: 1;
  scope: CounterFireScope;
  input: CashMovementInput & { idempotency_key: string; reason_code: CashMovementReasonCode };
}
const KEY = 'breakery.cash-movement-attempt.v1';
const REASONS = new Set(['misc', 'apport_owner', 'bank_transfer', 'replenishment']);
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validation à la frontière du stockage avant toute reprise d'argent. */
export function readCashMovement(): CashMovementAttempt | null {
  const raw = sessionStorage.getItem(KEY);
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!record(value) || value.version !== 1 || !record(value.scope) || !record(value.input)) throw new Error();
    const { scope, input } = value;
    if (typeof scope.project !== 'string' || typeof scope.userId !== 'string'
      || typeof scope.shiftId !== 'string' || (scope.session !== null && typeof scope.session !== 'string')
      || typeof input.session_id !== 'string' || input.session_id !== scope.shiftId
      || (input.direction !== 'in' && input.direction !== 'out')
      || typeof input.amount !== 'number' || !Number.isFinite(input.amount) || input.amount <= 0
      || typeof input.reason !== 'string' || input.reason.trim().length < 3
      || typeof input.idempotency_key !== 'string' || !input.idempotency_key
      || typeof input.reason_code !== 'string' || !REASONS.has(input.reason_code)) throw new Error();
    return value as unknown as CashMovementAttempt;
  } catch {
    throw new Error('Saved cash movement could not be read — ask a manager to recover this terminal');
  }
}

export async function resumeCashMovement(userId: string, token: string | null, shiftId: string): Promise<CashMovementAttempt | null> {
  const saved = readCashMovement();
  if (!saved) return null;
  const scope = await counterFireScope(userId, token, shiftId);
  if (saved.scope.project !== scope.project || saved.scope.userId !== scope.userId
    || saved.scope.session !== scope.session || saved.scope.shiftId !== scope.shiftId) {
    throw new Error('Resume the saved cash movement with the original cashier, session and shift');
  }
  return saved;
}

export function saveCashMovement(attempt: CashMovementAttempt): CashMovementAttempt {
  // Si cette écriture échoue, aucun départ RPC n'est permis.
  sessionStorage.setItem(KEY, JSON.stringify(attempt));
  return readCashMovement()!;
}
export function clearCashMovement(): void { sessionStorage.removeItem(KEY); }
