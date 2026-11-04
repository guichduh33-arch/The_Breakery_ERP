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
    expect(describeAuditLog(row)).toContain('Existing order paid · T104112026076');
    expect(describeAuditLog(row)).toContain('100.000');
  });
  it('resolves named, system and unavailable actors', () => {
    expect(auditActorName(row)).toBe('Made');
    expect(auditActorName({ ...row, actor_id: null, actor_name: null })).toBe('System');
    expect(auditActorName({ ...row, actor_name: null })).toBe('Former or unavailable user');
  });
  it('keeps unknown future actions readable and tolerates legacy context', () => {
    expect(auditActionLabel('receipt_template.update')).toBe('Receipt template updated');
    expect(describeAuditLog({ ...row, action: 'custom.new_event', metadata: null })).toBe('Custom new event');
    expect(describeAuditLog({ ...row, action: 'pos.item_qty_changed', metadata: [], payload: { name: 'Coffee', qty: 2 } }))
      .toBe('Item quantity changed · Coffee · Quantity 2');
  });
});
