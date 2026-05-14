// packages/domain/src/inventory/__tests__/validateTransfer.test.ts
// Session 12 — Phase 3 — unit tests for the stock-transfer validators.

import { describe, expect, it } from 'vitest';
import type {
  TransferInput,
  TransferReceiveInput,
} from '../types.js';
import {
  validateTransferInput,
  validateTransferReceive,
} from '../validateTransfer.js';

const SECTION_A = '11111111-1111-1111-1111-111111111111';
const SECTION_B = '22222222-2222-2222-2222-222222222222';
const PRODUCT_1 = 'product-1';
const PRODUCT_2 = 'product-2';
const ITEM_1 = 'item-1';
const ITEM_2 = 'item-2';

describe('validateTransferInput', () => {
  it('accepts a valid two-item transfer between different sections', () => {
    const input: TransferInput = {
      from_section_id: SECTION_A,
      to_section_id: SECTION_B,
      items: [
        { product_id: PRODUCT_1, quantity: 5 },
        { product_id: PRODUCT_2, quantity: 2.5, unit: 'kg' },
      ],
      notes: 'restocking bar from cellar',
    };
    expect(validateTransferInput(input)).toEqual({ valid: true });
  });

  it('rejects from_section_id === to_section_id', () => {
    const input: TransferInput = {
      from_section_id: SECTION_A,
      to_section_id: SECTION_A,
      items: [{ product_id: PRODUCT_1, quantity: 1 }],
    };
    expect(validateTransferInput(input)).toEqual({
      valid: false,
      code: 'from_to_same_section',
    });
  });

  it('rejects empty items array', () => {
    const input: TransferInput = {
      from_section_id: SECTION_A,
      to_section_id: SECTION_B,
      items: [],
    };
    expect(validateTransferInput(input)).toEqual({
      valid: false,
      code: 'items_required',
    });
  });

  it('rejects non-array items (e.g. undefined coerced via cast)', () => {
    const input = {
      from_section_id: SECTION_A,
      to_section_id: SECTION_B,
      items: undefined as unknown as TransferInput['items'],
    } as TransferInput;
    expect(validateTransferInput(input)).toEqual({
      valid: false,
      code: 'items_required',
    });
  });

  it('rejects an item missing product_id', () => {
    const input: TransferInput = {
      from_section_id: SECTION_A,
      to_section_id: SECTION_B,
      items: [{ product_id: '', quantity: 1 }],
    };
    expect(validateTransferInput(input)).toEqual({
      valid: false,
      code: 'product_id_required',
    });
  });

  it('rejects quantity = 0 as not strictly positive', () => {
    const input: TransferInput = {
      from_section_id: SECTION_A,
      to_section_id: SECTION_B,
      items: [{ product_id: PRODUCT_1, quantity: 0 }],
    };
    expect(validateTransferInput(input)).toEqual({
      valid: false,
      code: 'quantity_must_be_positive',
      detail: PRODUCT_1,
    });
  });

  it('rejects negative quantity', () => {
    const input: TransferInput = {
      from_section_id: SECTION_A,
      to_section_id: SECTION_B,
      items: [{ product_id: PRODUCT_1, quantity: -1 }],
    };
    expect(validateTransferInput(input)).toEqual({
      valid: false,
      code: 'quantity_must_be_positive',
      detail: PRODUCT_1,
    });
  });

  it('rejects duplicate product_id across items and includes the duplicate id as detail', () => {
    const input: TransferInput = {
      from_section_id: SECTION_A,
      to_section_id: SECTION_B,
      items: [
        { product_id: PRODUCT_1, quantity: 1 },
        { product_id: PRODUCT_2, quantity: 2 },
        { product_id: PRODUCT_1, quantity: 3 },
      ],
    };
    expect(validateTransferInput(input)).toEqual({
      valid: false,
      code: 'duplicate_product_in_items',
      detail: PRODUCT_1,
    });
  });
});

describe('validateTransferReceive', () => {
  const requested = new Map<string, number>([
    [ITEM_1, 10],
    [ITEM_2, 4],
  ]);

  it('accepts a valid receive with partial + full quantities within bounds', () => {
    const input: TransferReceiveInput = {
      transfer_id: 'transfer-1',
      items: [
        { item_id: ITEM_1, quantity_received: 10 },
        { item_id: ITEM_2, quantity_received: 3 },
      ],
    };
    expect(validateTransferReceive(input, requested)).toEqual({ valid: true });
  });

  it('rejects empty received items array', () => {
    const input: TransferReceiveInput = {
      transfer_id: 'transfer-1',
      items: [],
    };
    expect(validateTransferReceive(input, requested)).toEqual({
      valid: false,
      code: 'received_items_required',
    });
  });

  it('rejects a received line missing item_id', () => {
    const input: TransferReceiveInput = {
      transfer_id: 'transfer-1',
      items: [{ item_id: '', quantity_received: 1 }],
    };
    expect(validateTransferReceive(input, requested)).toEqual({
      valid: false,
      code: 'item_id_required',
    });
  });

  it('rejects negative quantity_received with the offending item_id as detail', () => {
    const input: TransferReceiveInput = {
      transfer_id: 'transfer-1',
      items: [{ item_id: ITEM_1, quantity_received: -1 }],
    };
    expect(validateTransferReceive(input, requested)).toEqual({
      valid: false,
      code: 'quantity_received_invalid',
      detail: ITEM_1,
    });
  });

  it('rejects quantity_received greater than the originally requested qty', () => {
    const input: TransferReceiveInput = {
      transfer_id: 'transfer-1',
      items: [{ item_id: ITEM_1, quantity_received: 11 }],
    };
    expect(validateTransferReceive(input, requested)).toEqual({
      valid: false,
      code: 'quantity_received_invalid',
      detail: ITEM_1,
    });
  });

  it('rejects duplicate item_id in received array', () => {
    const input: TransferReceiveInput = {
      transfer_id: 'transfer-1',
      items: [
        { item_id: ITEM_1, quantity_received: 5 },
        { item_id: ITEM_1, quantity_received: 5 },
      ],
    };
    expect(validateTransferReceive(input, requested)).toEqual({
      valid: false,
      code: 'duplicate_item_in_received',
      detail: ITEM_1,
    });
  });

  it('rejects an unknown item_id not present in the requested Map', () => {
    const input: TransferReceiveInput = {
      transfer_id: 'transfer-1',
      items: [{ item_id: 'item-ghost', quantity_received: 1 }],
    };
    expect(validateTransferReceive(input, requested)).toEqual({
      valid: false,
      code: 'quantity_received_invalid',
      detail: 'item-ghost',
    });
  });

  it('accepts quantity_received exactly equal to the requested qty (boundary)', () => {
    const input: TransferReceiveInput = {
      transfer_id: 'transfer-1',
      items: [{ item_id: ITEM_1, quantity_received: 10 }],
    };
    expect(validateTransferReceive(input, requested)).toEqual({ valid: true });
  });

  it('accepts quantity_received exactly equal to 0 (short-shipment) within bounds', () => {
    const input: TransferReceiveInput = {
      transfer_id: 'transfer-1',
      items: [{ item_id: ITEM_1, quantity_received: 0 }],
    };
    expect(validateTransferReceive(input, requested)).toEqual({ valid: true });
  });
});
