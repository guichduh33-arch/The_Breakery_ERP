import { describe, expect, it } from 'vitest';
import type { AuditLogRow } from '../../hooks/useAuditLogs.js';
import { auditActorName, auditActionLabel, describeAuditLog } from '../auditDescription.js';

const row: AuditLogRow = {
  id: 'audit:1', actor_id: 'profile-1', actor_name: 'Made', source: 'audit',
  action: 'order.pay_existing', entity_type: 'orders', entity_id: 'order-1',
  created_at: '2026-11-04T06:10:54Z', payload: null,
  metadata: { order_number: 'T104112026076', total: 100000 },
};

describe('audit descriptions', () => {
  it('describes the payment in the reported screenshot', () => {
    expect(describeAuditLog(row)).toContain('Payment recorded on an existing order · T104112026076');
    expect(describeAuditLog(row)).toContain('100.000');
  });
  it('resolves named, system and unavailable actors', () => {
    expect(auditActorName(row)).toBe('Made');
    expect(auditActorName({ ...row, actor_id: null, actor_name: null })).toBe('System / actor not recorded');
    expect(auditActorName({ ...row, actor_name: null })).toBe('Former or unavailable user');
  });
  it('keeps unknown future actions readable and tolerates legacy context', () => {
    expect(auditActionLabel('receipt_template.update')).toBe('Receipt template updated');
    expect(describeAuditLog({ ...row, action: 'custom.new_event', metadata: null })).toBe('Custom new event');
    expect(describeAuditLog({ ...row, action: 'pos.item_qty_changed', metadata: [], payload: { name: 'Coffee', qty: 2 } }))
      .toBe('Cart item quantity changed · Coffee · Quantity 2');
  });
  it('shows signed cash variances and preserves zero counts from numeric strings', () => {
    const description = describeAuditLog({ ...row, action: 'shift.close', metadata: {
      expected_cash: '500000', counted_cash: '0', variance: '-500000', variance_card: 0,
    } });
    expect(description).toContain('Expected cash');
    expect(description).toContain('Counted cash');
    expect(description).toContain('Cash variance -Rp 500.000');
  });
  it('recovers permission, role and explicit user DENY details from payload', () => {
    expect(describeAuditLog({ ...row, action: 'role.permission_granted', metadata: {},
      payload: { role_code: 'ADMIN', permission_code: 'orders.void' } }))
      .toContain('Role: ADMIN · Permission: orders.void');
    expect(describeAuditLog({ ...row, action: 'user.permission_override_set', metadata: {},
      payload: { permission_code: 'reports.export', is_granted: false } })).toContain('Access denied');
  });
  it('shows the before/after quantity and its unit without turning it into money', () => {
    const text = describeAuditLog({ ...row, action: 'display.adjust', metadata: {
      old_qty: '3', new_qty: '0', unit: 'pcs', reason: 'Corrected count',
    } });
    expect(text).toContain('Quantity 3 → 0 pcs');
    expect(text).not.toContain('Rp');
  });
  it('shows known price changes while keeping secret and unknown fields out of summaries', () => {
    const text = describeAuditLog({ ...row, action: 'product.update', metadata: {}, payload: {
      before: { retail_price: 10000, pin_hash: 'old-secret' },
      after: { retail_price: 12000, pin_hash: 'new-secret' },
    } });
    expect(text).toContain('Retail price:');
    expect(text).toContain('10.000');
    expect(text).toContain('12.000');
    expect(text).not.toContain('secret');
  });
  it('does not claim a successful print when the device reports failure', () => {
    const text = describeAuditLog({ ...row, source: 'pos', action: 'pos.receipt_reprinted',
      metadata: {}, payload: { printed: false } });
    expect(text).toBe('Receipt reprint requested · Device reports failure');
  });
  it('describes a cash withdrawal with its amount, direction and business reason', () => {
    expect(describeAuditLog({ ...row, action: 'shift.cash_movement', metadata: {
      amount: '50000', direction: 'out', reason_code: 'bank_transfer', reason: 'Deposit to bank',
    } })).toBe('Cash register movement recorded · Rp 50.000 · Cash out · Bank transfer · Deposit to bank');
  });
  it('preserves payload changes over legacy context and explains cleared limits without mutating input', () => {
    const before = Object.freeze({ credit_limit: 100000 });
    const after = Object.freeze({ credit_limit: null });
    const text = describeAuditLog({ ...row, action: 'customer.update_credit_terms', metadata: {
      field: 'credit_limit', before: 50000, after: 200000,
    }, payload: { before, after } });
    expect(text).toContain('Credit limit: Rp 100.000 → Not set');
    expect(before.credit_limit).toBe(100000);
    expect(after.credit_limit).toBeNull();
  });
});
