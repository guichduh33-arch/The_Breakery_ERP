// packages/domain/src/accounting/__tests__/types.test.ts
//
// Session 13 / Phase 1.A — unit tests for the accounting domain types.

import { describe, it, expect } from 'vitest';
import {
  MAPPING_KEYS,
  isMappingKey,
  REFERENCE_TYPES_CANONICAL,
  isCanonicalReferenceType,
  FISCAL_PERIOD_STATUSES,
  isFiscalPeriodEditable,
} from '../types';

describe('MAPPING_KEYS', () => {
  it('contains at least 24 keys (per D11 seed) — extra keys allowed for downstream needs', () => {
    // D11 enumerates 24 canonical keys ; we permit additions (e.g. LOYALTY_LIABILITY)
    // as long as the canonical 24 stay present. The pgTAP test T1 asserts ≥ 24 at DB level.
    expect(MAPPING_KEYS.length).toBeGreaterThanOrEqual(24);
  });

  it('has no duplicates', () => {
    expect(new Set(MAPPING_KEYS).size).toBe(MAPPING_KEYS.length);
  });

  it('all keys are SCREAMING_SNAKE_CASE', () => {
    for (const k of MAPPING_KEYS) {
      expect(k).toMatch(/^[A-Z][A-Z0-9_]*$/);
    }
  });

  it('contains the four sales-payment channels', () => {
    expect(MAPPING_KEYS).toContain('SALE_PAYMENT_CASH');
    expect(MAPPING_KEYS).toContain('SALE_PAYMENT_QRIS');
    expect(MAPPING_KEYS).toContain('SALE_PAYMENT_DEBIT');
    expect(MAPPING_KEYS).toContain('SALE_PAYMENT_CREDIT_CARD');
  });

  it('contains the stock-movement-JE keys (D20)', () => {
    expect(MAPPING_KEYS).toContain('WASTE_EXPENSE');
    expect(MAPPING_KEYS).toContain('ADJUSTMENT_INCOME');
    expect(MAPPING_KEYS).toContain('ADJUSTMENT_EXPENSE');
    expect(MAPPING_KEYS).toContain('OPNAME_INCOME');
    expect(MAPPING_KEYS).toContain('OPNAME_EXPENSE');
    expect(MAPPING_KEYS).toContain('PRODUCTION_COGS');
  });
});

describe('isMappingKey', () => {
  it('accepts a known key', () => {
    expect(isMappingKey('SALE_POS_REVENUE')).toBe(true);
  });

  it('rejects an unknown key', () => {
    expect(isMappingKey('NOT_A_KEY')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isMappingKey('')).toBe(false);
  });
});

describe('REFERENCE_TYPES_CANONICAL', () => {
  it('contains 18 entries (17 from D13 + stock_movement)', () => {
    expect(REFERENCE_TYPES_CANONICAL.length).toBe(18);
  });

  it('does NOT include the legacy aliases `void` and `refund`', () => {
    expect(REFERENCE_TYPES_CANONICAL).not.toContain('void');
    expect(REFERENCE_TYPES_CANONICAL).not.toContain('refund');
  });

  it('includes the new sale_refund canonical', () => {
    expect(REFERENCE_TYPES_CANONICAL).toContain('sale_refund');
  });

  it('includes stock_movement (D20)', () => {
    expect(REFERENCE_TYPES_CANONICAL).toContain('stock_movement');
  });
});

describe('isCanonicalReferenceType', () => {
  it('accepts a canonical type', () => {
    expect(isCanonicalReferenceType('sale_refund')).toBe(true);
  });

  it('rejects a legacy alias', () => {
    expect(isCanonicalReferenceType('refund')).toBe(false);
    expect(isCanonicalReferenceType('void')).toBe(false);
  });
});

describe('FISCAL_PERIOD_STATUSES + isFiscalPeriodEditable', () => {
  it('lists four statuses', () => {
    expect(FISCAL_PERIOD_STATUSES).toEqual(['draft', 'open', 'closed', 'locked']);
  });

  it('draft is editable', () => {
    expect(isFiscalPeriodEditable('draft')).toBe(true);
  });

  it('open is editable', () => {
    expect(isFiscalPeriodEditable('open')).toBe(true);
  });

  it('closed is NOT editable', () => {
    expect(isFiscalPeriodEditable('closed')).toBe(false);
  });

  it('locked is NOT editable', () => {
    expect(isFiscalPeriodEditable('locked')).toBe(false);
  });
});
