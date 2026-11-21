// Le filtre de la page Payments oubliait `edc` et `store_credit`, que la
// modale d'enregistrement enregistre : une seule liste pour les deux.
import { describe, expect, it } from 'vitest';
import { B2B_PAYMENT_METHODS, b2bPaymentMethodLabel } from '../b2bPaymentMethods.js';

describe('B2B payment methods', () => {
  it('include every method the record modal can write', () => {
    expect(B2B_PAYMENT_METHODS).toEqual(['cash', 'transfer', 'qris', 'card', 'edc', 'store_credit']);
  });

  it('label known methods and keep any other enum value readable', () => {
    expect(b2bPaymentMethodLabel('edc')).toBe('EDC');
    expect(b2bPaymentMethodLabel('store_credit')).toBe('Store credit');
    expect(b2bPaymentMethodLabel('transfer')).toBe('Bank transfer');
    expect(b2bPaymentMethodLabel('go_pay_x')).toBe('go pay x');
  });
});
