// Gravité, seuils et répétitions du journal, sur une période complète.
import { describe, expect, it } from 'vitest';
import type { AuditLogRow } from '../../hooks/useAuditLogs.js';
import { DEFAULT_AUDIT_THRESHOLDS, auditReviewCue, auditRowSeverity } from '../auditReview.js';
import { buildAuditSignals } from '../auditSignals.js';
import { describeAuditLog } from '../auditDescription.js';

let counter = 0;
function row(action: string, at: string, metadata: unknown = {}, payload: unknown = null, actor = 'actor-1'): AuditLogRow {
  counter += 1;
  return { id: `r${String(counter).padStart(4, '0')}`, actor_id: actor, actor_name: 'Ayu', action, entity_type: 'x',
    entity_id: null, metadata, payload, source: action.startsWith('pos.') ? 'pos' : 'audit', created_at: at };
}
const at = (minute: number, second = 0): string =>
  `2026-11-14T02:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}.000+00:00`;

describe('register discrepancy severity', () => {
  const close = (metadata: Record<string, unknown>): AuditLogRow => row('shift.close', at(0), metadata);
  it('separates a small cash gap from a large card gap', () => {
    expect(auditRowSeverity(close({ variance: 1000, variance_card: 0 }))).toBe('low');
    expect(auditRowSeverity(close({ variance: 8000, variance_card: 0 }))).toBe('medium');
    expect(auditRowSeverity(close({ variance: 8000, variance_card: -60000 }))).toBe('high');
    expect(auditRowSeverity(close({ variance: 0, variance_card: 0, variance_qris: 0 }))).toBeNull();
  });
  it('follows the configured threshold and the server approval flag', () => {
    const strict = { ...DEFAULT_AUDIT_THRESHOLDS, varianceAbs: 5000 };
    expect(auditRowSeverity(close({ variance: 8000 }), strict)).toBe('high');
    // Même frontière que la clôture du POS : l'écart doit DÉPASSER le seuil.
    expect(auditRowSeverity(close({ variance: 5000 }), strict)).toBe('medium');
    // Un seuil réglé à zéro rend fort tout écart non nul.
    expect(auditRowSeverity(close({ variance: 1 }), { ...DEFAULT_AUDIT_THRESHOLDS, varianceAbs: 0 })).toBe('high');
    expect(auditRowSeverity(close({ variance: 1000, pin_approval_required: true }))).toBe('high');
  });
});

describe('negative stock override', () => {
  const movement = (metadata: Record<string, unknown>): AuditLogRow => row('stock.movement', at(0), metadata);
  it('ignores the permission flag carried by every production entry', () => {
    const entry = movement({ movement_type: 'production_in', allow_negative: true, new_current_stock: 24 });
    expect(auditReviewCue(entry)).toBeNull();
    expect(auditRowSeverity(entry)).toBeNull();
    expect(describeAuditLog(entry)).not.toContain('Negative stock override');
    expect(auditReviewCue(movement({ movement_type: 'production_in', allow_negative: true }))).toBeNull();
  });
  it('still flags a movement that ends below zero and other forced operations', () => {
    const forced = movement({ movement_type: 'production_in', allow_negative: true, new_current_stock: -3 });
    expect(auditReviewCue(forced)).toContain('Negative stock override');
    expect(describeAuditLog(forced)).toContain('Negative stock override');
    expect(auditReviewCue(movement({ movement_type: 'sale', allow_negative: true }))).toContain('Negative stock override');
    expect(auditReviewCue(row('production.create', at(0), { force_negative: true }))).toContain('Negative stock override');
  });
  it('groups a burst of real overrides by the same account', () => {
    const burst = [0, 2, 4].map((minute) => ({ ...movement({ allow_negative: true, new_current_stock: -1 }), created_at: at(minute) }));
    const alone = { ...movement({ allow_negative: true, new_current_stock: -1 }), created_at: at(55) };
    const signals = buildAuditSignals([...burst, alone]);
    expect(burst.map((r) => signals.get(r.id)?.groupSize)).toEqual([3, 3, 3]);
    expect(new Set(burst.map((r) => signals.get(r.id)?.group)).size).toBe(1);
    expect(signals.get(alone.id)).toEqual({ severity: 'medium', group: null, groupSize: null });
  });
});

describe('repetitions over the whole period', () => {
  it('raises four reprints of one receipt in two minutes above an isolated reprint', () => {
    const same = [at(10, 0), at(10, 30), at(11, 0), at(11, 50)].map((when) =>
      row('pos.receipt_reprinted', when, { order_number: 'T1-0042' }, { printed: true }));
    const other = row('pos.receipt_reprinted', at(40), { order_number: 'T1-0099' }, { printed: true });
    const signals = buildAuditSignals([...same, other]);
    for (const r of same) expect(signals.get(r.id)).toMatchObject({ severity: 'high', groupSize: 4 });
    expect(signals.get(other.id)).toEqual({ severity: 'low', group: null, groupSize: null });
  });
  it('counts the copies of one receipt over the whole period, even hours apart', () => {
    const copies = ['2026-11-14T01:00:00Z', '2026-11-14T04:00:00Z', '2026-11-14T07:00:00Z']
      .map((when) => row('pos.receipt_reprinted', when, { order_number: 'T1-0042' }));
    const signals = buildAuditSignals(copies);
    for (const r of copies) expect(signals.get(r.id)).toMatchObject({ severity: 'high', groupSize: 3 });
  });
  it('joins the copies of one receipt known by its number on one line and by its id on another', () => {
    const order = '11111111-1111-4111-8111-111111111111';
    const sale = { ...row('order.complete', at(0), { order_number: 'T1-0042', total: 1000 }), entity_type: 'orders', entity_id: order };
    const byNumber = row('pos.receipt_reprinted', at(5), { order_number: 'T1-0042' });
    const byId = { ...row('pos.receipt_reprinted', at(6)), entity_type: 'order', entity_id: order };
    const signals = buildAuditSignals([sale, byNumber, byId]);
    expect(signals.get(byNumber.id)?.groupSize).toBe(2);
    expect(signals.get(byId.id)?.group).toBe(signals.get(byNumber.id)?.group);
  });
  it('does not join failed payments that carry no amount', () => {
    const fails = [0, 1].map((m) => row('pos.payment_failed', at(m), { reason: 'insufficient_stock' }));
    const signals = buildAuditSignals(fails);
    for (const r of fails) expect(signals.get(r.id)).toEqual({ severity: 'low', group: null, groupSize: null });
  });
  it('still separates failed payments of one amount that are far apart', () => {
    const fails = [0, 45].map((m) => row('pos.payment_failed', at(m), { amount: 595000 }));
    const signals = buildAuditSignals(fails);
    for (const r of fails) expect(signals.get(r.id)?.group).toBeNull();
  });
  it('signals a failed payment, and more strongly two attempts for the same amount', () => {
    const single = row('pos.payment_failed', at(0), { amount: 40000, reason: 'insufficient_stock' }, { kind: 'fatal' });
    const twice = [5, 6].map((m) => row('pos.payment_failed', at(m), { amount: 595000, reason: 'combo_group_violation' }, { kind: 'fatal' }));
    expect(auditReviewCue(single)).toContain('Payment attempt rejected');
    const signals = buildAuditSignals([single, ...twice]);
    expect(signals.get(single.id)?.severity).toBe('low');
    for (const r of twice) expect(signals.get(r.id)).toMatchObject({ severity: 'medium', groupSize: 2 });
  });
  it('raises repeated manager PIN failures by one account', () => {
    const fails = [0, 1, 2].map((m) => row('manager_pin.failed', at(m), { function: 'void_order' }));
    const signals = buildAuditSignals(fails);
    for (const r of fails) expect(signals.get(r.id)).toMatchObject({ severity: 'high', groupSize: 3 });
  });
});

describe('notes typed key by key', () => {
  it('gives one group to the keystrokes of one note and keeps a later note apart', () => {
    const note = (when: string, notes: string): AuditLogRow => row('pos.note_added', when, { device_id: 'tablet-1' }, { notes });
    const typing = [note(at(10, 12), 'n'), note(at(10, 13), 'no'), note(at(10, 14), 'no sugar')];
    const later = note(at(30), 'extra hot');
    const signals = buildAuditSignals([...typing, later]);
    expect(typing.map((r) => signals.get(r.id)?.groupSize)).toEqual([3, 3, 3]);
    expect(new Set(typing.map((r) => signals.get(r.id)?.group)).size).toBe(1);
    expect(signals.get(later.id)).toEqual({ severity: null, group: null, groupSize: null });
  });
});

describe('recomputed product costs', () => {
  const cost = (before: number, after: number, when: string): AuditLogRow =>
    row('product.cost_recomputed', when, { old_cost: before, new_cost: after, source: 'recipe_edit' });
  it('keeps small changes quiet and grades the larger ones', () => {
    expect(auditRowSeverity(cost(1000, 1009, at(0)))).toBeNull();
    expect(auditRowSeverity(cost(1000, 1060, at(0)))).toBe('low');
    expect(auditRowSeverity(cost(1000, 1300, at(0)))).toBe('medium');
    expect(auditRowSeverity(cost(0, 1300, at(0)))).toBeNull();
  });
  it('gives one group to the lines written by one recalculation', () => {
    const batch = [cost(1000, 1009, at(3, 10)), cost(2000, 2010, at(3, 10)), cost(500, 800, at(3, 11))];
    const nextBatch = [cost(1000, 1001, at(20)), cost(900, 901, at(20))];
    const signals = buildAuditSignals([...batch, ...nextBatch]);
    expect(new Set(batch.map((r) => signals.get(r.id)?.group)).size).toBe(1);
    expect(signals.get(batch[0]!.id)?.groupSize).toBe(3);
    expect(signals.get(batch[2]!.id)?.severity).toBe('medium');
    expect(signals.get(batch[0]!.id)?.severity).toBeNull();
    expect(signals.get(nextBatch[0]!.id)?.group).not.toBe(signals.get(batch[0]!.id)?.group);
  });
});
