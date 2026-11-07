import { describe, expect, it } from 'vitest';
import type { AuditLogRow } from '../../hooks/useAuditLogs.js';
import { auditEvidenceNote, auditReviewCue, auditSourceLabel } from '../auditReview.js';
import { auditSafeDetails } from '../auditValues.js';

const row: AuditLogRow = { id: 'audit:1', actor_id: 'profile', actor_name: 'Named account',
  action: 'shift.close', entity_type: 'pos_session', entity_id: 'shift', source: 'audit',
  created_at: '2026-11-07T02:00:00Z', metadata: {}, payload: null };

describe('audit review evidence', () => {
  it('flags a card discrepancy even when the cash discrepancy is zero', () => {
    expect(auditReviewCue({ ...row, metadata: { variance: '0', variance_card: '-5000' } })).toContain('Register discrepancy');
    expect(auditReviewCue({ ...row, metadata: { variance: 0, variance_card: 0, variance_qris: 0 } })).toBeNull();
    expect(auditReviewCue({ ...row, metadata: { variance: 'unknown' } })).toBeNull();
  });
  it('distinguishes manual drawer requests from sale-triggered requests', () => {
    const drawer = { ...row, source: 'pos', action: 'pos.cash_drawer_opened' };
    expect(auditReviewCue({ ...drawer, payload: { trigger: 'manual', opened: false } })).toContain('Manual drawer request');
    expect(auditReviewCue({ ...drawer, payload: { trigger: 'sale', opened: true } })).toBeNull();
  });
  it('does not identify a person from a rejected sign-in against a named account', () => {
    expect(auditEvidenceNote({ ...row, action: 'login.failed' })).toContain('named account was targeted');
    expect(auditEvidenceNote({ ...row, action: 'login.failed' })).toContain('does not identify the person');
  });
  it('flags recorded cash withdrawals and changed customer terms for verification', () => {
    expect(auditReviewCue({ ...row, action: 'shift.cash_movement', metadata: { direction: 'out' } })).toContain('Cash withdrawal recorded');
    expect(auditReviewCue({ ...row, action: 'shift.cash_movement', metadata: { direction: 'in' } })).toBeNull();
    expect(auditReviewCue({ ...row, action: 'customer.update_credit_terms' })).toContain('Customer terms changed');
  });
  it('keeps device reports distinct from server records and tolerates future sources', () => {
    expect(auditSourceLabel('pos')).toBe('POS device report');
    expect(auditSourceLabel('audit')).toBe('Server audit');
    expect(auditSourceLabel('future')).toBe('Other recorded source');
    expect(auditEvidenceNote({ ...row, source: 'pos' })).toContain('does not prove physical printing');
  });
  it('masks nested secrets while retaining useful business and authorisation references', () => {
    const safe = auditSafeDetails({ reason: 'Count corrected', authorization_id: 'ref', pin_validated: true,
      data: [{ pin_hash: 'hash-secret', access_token: 'token-secret' }],
      setting: { key: 'api_key', old: 'old-secret', new: 'new-secret' } });
    expect(safe).not.toContain('hash-secret');
    expect(safe).not.toContain('token-secret');
    expect(safe).not.toContain('old-secret');
    expect(safe).not.toContain('new-secret');
    expect(safe).toContain('Count corrected');
    expect(safe).toContain('"authorization_id": "ref"');
    expect(safe).toContain('"pin_validated": true');
  });
});
