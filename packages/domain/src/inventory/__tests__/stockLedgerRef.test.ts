// packages/domain/src/inventory/__tests__/stockLedgerRef.test.ts
import { describe, it, expect } from 'vitest';
import {
  movementTypeLabel,
  movementRefPrefix,
  buildMovementRefNo,
  assignRefNos,
  movementOrigin,
} from '../stockLedgerRef.js';

describe('movementOrigin', () => {
  it('shows the order number for a sale', () => {
    expect(movementOrigin({ movementType: 'sale', referenceLabel: 'ORD-0042', reason: null }))
      .toBe('Sale · order ORD-0042');
  });
  it('falls back to "POS sale" when no order number', () => {
    expect(movementOrigin({ movementType: 'sale', referenceLabel: null, reason: null }))
      .toBe('POS sale');
  });
  it('appends the reason for a waste movement', () => {
    expect(movementOrigin({ movementType: 'waste', referenceLabel: null, reason: 'expired lot' }))
      .toBe('Waste / spoilage — expired lot');
  });
  it('labels a purchase and a production consumption', () => {
    expect(movementOrigin({ movementType: 'purchase', referenceLabel: null, reason: null }))
      .toBe('Purchase received');
    expect(movementOrigin({ movementType: 'production_out', referenceLabel: null, reason: null }))
      .toBe('Production consumption');
  });
  it('falls back to the raw movement_type for unknown values', () => {
    expect(movementOrigin({ movementType: 'mystery', referenceLabel: null, reason: '  ' }))
      .toBe('mystery');
  });

  it('labels every known movement_type (no ref, no reason)', () => {
    const cases: Record<string, string> = {
      sale:                  'POS sale',
      sale_void:             'Sale void',
      purchase:              'Purchase received',
      purchase_return:       'Purchase return',
      incoming:              'Stock in',
      transfer_in:           'Transfer in',
      transfer_out:          'Transfer out',
      production_in:         'Production output',
      production_out:        'Production consumption',
      adjustment:            'Manual adjustment',
      adjustment_in:         'Manual adjustment',
      adjustment_out:        'Manual adjustment',
      opname_in:             'Stock opname',
      opname_out:            'Stock opname',
      waste:                 'Waste / spoilage',
      cost_price_correction: 'Cost correction',
      reservation_hold:      'Reservation hold',
      reservation_release:   'Reservation release',
    };
    for (const [type, expected] of Object.entries(cases)) {
      expect(movementOrigin({ movementType: type, referenceLabel: null, reason: null })).toBe(expected);
    }
  });

  it('includes the ref for sale_void and purchase when present', () => {
    expect(movementOrigin({ movementType: 'sale_void', referenceLabel: 'ORD-9', reason: null }))
      .toBe('Sale void · order ORD-9');
    expect(movementOrigin({ movementType: 'purchase', referenceLabel: 'PO-7', reason: null }))
      .toBe('Purchase · PO-7');
  });
});

describe('movementTypeLabel', () => {
  it('maps sale to POS_SALE', () => {
    expect(movementTypeLabel('sale')).toBe('POS_SALE');
  });
  it('maps opname_in/opname_out to OPNAME', () => {
    expect(movementTypeLabel('opname_in')).toBe('OPNAME');
    expect(movementTypeLabel('opname_out')).toBe('OPNAME');
  });
  it('maps cost_price_correction to COST_CORRECTION', () => {
    expect(movementTypeLabel('cost_price_correction')).toBe('COST_CORRECTION');
  });
  it('uppercases everything else', () => {
    expect(movementTypeLabel('production_in')).toBe('PRODUCTION_IN');
    expect(movementTypeLabel('transfer_out')).toBe('TRANSFER_OUT');
  });
});

describe('movementRefPrefix', () => {
  it('keys the prefix off the movement family', () => {
    expect(movementRefPrefix('sale')).toBe('SL');
    expect(movementRefPrefix('sale_void')).toBe('SL');
    expect(movementRefPrefix('production_in')).toBe('SP');
    expect(movementRefPrefix('production_out')).toBe('SP');
    expect(movementRefPrefix('purchase')).toBe('PO');
    expect(movementRefPrefix('incoming')).toBe('IN');
    expect(movementRefPrefix('transfer_in')).toBe('TR');
    expect(movementRefPrefix('adjustment')).toBe('AD');
    expect(movementRefPrefix('opname_in')).toBe('OP');
    expect(movementRefPrefix('waste')).toBe('WS');
    expect(movementRefPrefix('cost_price_correction')).toBe('CC');
  });
  it('falls back to MV for unknown types', () => {
    expect(movementRefPrefix('something_new')).toBe('MV');
  });
});

describe('buildMovementRefNo', () => {
  it('formats PREFIX + yymmdd + 8-digit seq', () => {
    expect(
      buildMovementRefNo({ movementType: 'opname_in', date: '2026-06-15T06:40:33Z', seq: 81 }),
    ).toBe('OP26061500000081');
  });
  it('zero-pads the sequence to 8 digits', () => {
    expect(
      buildMovementRefNo({ movementType: 'sale', date: '2026-06-15T00:00:00Z', seq: 30825 }),
    ).toBe('SL26061500030825');
  });
});

describe('assignRefNos', () => {
  it('shares one code across all lines of the same reference_id', () => {
    const map = assignRefNos([
      { id: 'a', movementType: 'sale', referenceId: 'order-1', createdAt: '2026-06-15T08:00:00Z' },
      { id: 'b', movementType: 'sale', referenceId: 'order-1', createdAt: '2026-06-15T08:00:00Z' },
    ]);
    expect(map.get('a')).toBe(map.get('b'));
    expect(map.get('a')).toBe('SL26061500000001');
  });

  it('gives each null-reference row its own code', () => {
    const map = assignRefNos([
      { id: 'a', movementType: 'adjustment', referenceId: null, createdAt: '2026-06-15T08:00:00Z' },
      { id: 'b', movementType: 'adjustment', referenceId: null, createdAt: '2026-06-15T08:00:00Z' },
    ]);
    expect(map.get('a')).not.toBe(map.get('b'));
    expect(map.get('a')).toBe('AD26061500000001');
    expect(map.get('b')).toBe('AD26061500000002');
  });

  it('sequences per prefix, in order of first appearance', () => {
    const map = assignRefNos([
      { id: 'a', movementType: 'sale',       referenceId: 'o1',  createdAt: '2026-06-15T08:00:00Z' },
      { id: 'b', movementType: 'adjustment', referenceId: null,  createdAt: '2026-06-15T08:01:00Z' },
      { id: 'c', movementType: 'sale',       referenceId: 'o2',  createdAt: '2026-06-15T08:02:00Z' },
    ]);
    expect(map.get('a')).toBe('SL26061500000001');
    expect(map.get('b')).toBe('AD26061500000001');
    expect(map.get('c')).toBe('SL26061500000002');
  });
});
