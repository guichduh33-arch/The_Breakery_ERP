import { beforeEach, describe, expect, it, vi } from 'vitest';
import { counterFireScope } from '@/features/cart/hooks/counterFireRecovery';
import { readCashMovement, resumeCashMovement, saveCashMovement, type CashMovementAttempt } from '../hooks/cashMovementRecovery';
let attempt: CashMovementAttempt;
beforeEach(async () => {
  sessionStorage.clear();
  attempt = { version: 1, scope: await counterFireScope('cashier', 'token', 'shift'),
    input: { session_id: 'shift', direction: 'in', amount: 100000, reason: 'Float top-up',
      reason_code: 'misc', idempotency_key: 'uuid' } };
});
describe('reprise cash dans le même onglet', () => {
  it('conserve la requête exacte et la clé après modification de l’objet original', async () => {
    const original = structuredClone(attempt);
    saveCashMovement(original); original.input.amount = 200000;
    expect(await resumeCashMovement('cashier', 'token', 'shift')).toEqual(attempt);
  });
  it.each(['project', 'userId', 'session', 'shiftId'] as const)('refuse une portée différente %s sans effacer', async (key) => {
    const other = structuredClone(attempt); other.scope[key] = 'other';
    if (key === 'shiftId') other.input.session_id = 'other';
    saveCashMovement(other);
    await expect(resumeCashMovement('cashier', 'token', 'shift')).rejects.toThrow('original cashier');
    expect(readCashMovement()).toEqual(other);
  });
  it('refuse une tentative corrompue avant reprise', () => {
    sessionStorage.setItem('breakery.cash-movement-attempt.v1', JSON.stringify({ ...attempt, input: { ...attempt.input, amount: -1 } }));
    expect(readCashMovement).toThrow('could not be read');
  });
  it('échoue avant tout départ quand le stockage est plein', () => {
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); });
    try { expect(() => saveCashMovement(attempt)).toThrow('Quota exceeded'); }
    finally { write.mockRestore(); }
    expect(readCashMovement()).toBeNull();
  });
});
