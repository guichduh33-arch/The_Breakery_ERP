// S2-11 — les valeurs d'énumération exportées sont exactement celles de Postgres,
// telles que les types générés les portent. Un miroir recopié à la main a déjà
// omis des statuts de commande : ce test l'interdit.
import { describe, it, expect } from 'vitest';
import { Constants } from '../types.generated.js';
import {
  CUSTOMER_TYPES,
  LOYALTY_TXN_TYPES,
  MOVEMENT_TYPES,
  ORDER_STATUSES,
  ORDER_TYPES,
  PAYMENT_METHODS,
  SHIFT_STATUSES,
} from '../enums.js';

const E = Constants.public.Enums;

describe('enum exports mirror the generated Postgres enums', () => {
  it('order statuses list the six real values', () => {
    expect([...ORDER_STATUSES]).toEqual([...E.order_status]);
    expect(ORDER_STATUSES).toHaveLength(6);
  });

  it.each([
    ['ORDER_TYPES', ORDER_TYPES, E.order_type],
    ['PAYMENT_METHODS', PAYMENT_METHODS, E.payment_method],
    ['SHIFT_STATUSES', SHIFT_STATUSES, E.shift_status],
    ['MOVEMENT_TYPES', MOVEMENT_TYPES, E.movement_type],
    ['CUSTOMER_TYPES', CUSTOMER_TYPES, E.customer_type],
    ['LOYALTY_TXN_TYPES', LOYALTY_TXN_TYPES, E.loyalty_txn_type],
  ] as const)('%s equals the generated enum', (_name, exported, generated) => {
    expect([...exported]).toEqual([...generated]);
  });
});
