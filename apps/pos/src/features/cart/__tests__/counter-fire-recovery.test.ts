import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearCounterFire, hasPendingCounterFire, resumeCounterFire, saveCounterFire, type CounterFireAttempt } from '../hooks/counterFireRecovery';
import { beginOrderSend, finishOrderSend, isOrderSending } from '@/stores/orderSendGuard';
import { useCartStore } from '@/stores/cartStore';
vi.mock('@/features/audit/emitPosEvent', () => ({ emitPosEvent: vi.fn() }));

const attempt: CounterFireAttempt = {
  version: 1, scope: { project: 'dev', userId: 'cashier', session: 'session', shiftId: 'shift' },
  args: { p_client_uuid: 'uuid', p_session_id: 'shift', p_items: [{ client_line_id: 'line', quantity: 1 }] },
  items: [{ id: 'line', product_id: 'product', name: 'Coffee', quantity: 1, unit_price: 20000, modifiers: [] }],
  additional: false,
};
beforeEach(() => { sessionStorage.clear(); finishOrderSend(); });
describe('reprise durable d’un envoi caisse', () => {
  it('relit la clé et le contenu figé même si le brouillon d’origine a changé', () => {
    const original = structuredClone(attempt);
    saveCounterFire(original);
    original.items[0]!.quantity = 4;
    expect(resumeCounterFire(attempt.scope)).toEqual(attempt);
    expect(hasPendingCounterFire()).toBe(true);
  });
  it.each(['project', 'userId', 'session', 'shiftId'] as const)('refuse un autre contexte %s sans effacer la tentative', (key) => {
    saveCounterFire(attempt);
    expect(() => resumeCounterFire({ ...attempt.scope, [key]: 'other' })).toThrow('original cashier');
    expect(resumeCounterFire(attempt.scope)).toEqual(attempt);
  });
  it('verrouille les mutations et le paiement après un échec, mais autorise le retry manuel', () => {
    useCartStore.setState({ cart: { items: [], order_type: 'take_out' } });
    saveCounterFire(attempt);
    beginOrderSend(); finishOrderSend();
    expect(isOrderSending()).toBe(true);
    useCartStore.getState().setOrderType('dine_in');
    expect(useCartStore.getState().cart.order_type).toBe('take_out');
    clearCounterFire();
    expect(isOrderSending()).toBe(false);
    useCartStore.getState().setOrderType('dine_in');
    expect(useCartStore.getState().cart.order_type).toBe('dine_in');
  });
  it('une sauvegarde illisible reste verrouillée et exige une récupération', () => {
    sessionStorage.setItem('breakery.counter-fire-attempt.v1', '{');
    expect(isOrderSending()).toBe(true);
    expect(() => resumeCounterFire(attempt.scope)).toThrow('could not be read');
  });
});
