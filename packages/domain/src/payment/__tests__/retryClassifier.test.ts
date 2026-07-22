// packages/domain/src/payment/__tests__/retryClassifier.test.ts
//
// Session 13 / Phase 4.A — unit tests for the checkout error classifier.
// Pure domain logic — no IO, no DOM.

import { describe, expect, it } from 'vitest';
import { classifyCheckoutError } from '../retryClassifier.js';

describe('classifyCheckoutError', () => {
  describe('already_paid bucket', () => {
    it.each(['already_paid', 'idempotent_replay', 'duplicate_payment'])(
      'classifies %s as already_paid',
      (code) => {
        const err = Object.assign(new Error('boom'), { details: { error: code } });
        const result = classifyCheckoutError(err);
        expect(result.kind).toBe('already_paid');
        expect(result.userMessage).toMatch(/already finalized/i);
      },
    );

    it('treats uppercase code as case-insensitive', () => {
      const err = Object.assign(new Error('boom'), { details: { error: 'ALREADY_PAID' } });
      expect(classifyCheckoutError(err).kind).toBe('already_paid');
    });
  });

  describe('retryable bucket', () => {
    it.each(['network_error', 'fetch_failed', 'timeout', 'server_error', '5xx', 'PGRST301'])(
      'classifies %s as retryable',
      (code) => {
        const err = Object.assign(new Error('boom'), { details: { error: code } });
        const result = classifyCheckoutError(err);
        expect(result.kind).toBe('retryable');
        expect(result.userMessage).toMatch(/retry/i);
      },
    );

    it('heuristically classifies "Failed to fetch" TypeError as retryable', () => {
      const err = new TypeError('Failed to fetch');
      const result = classifyCheckoutError(err);
      expect(result.kind).toBe('retryable');
      expect(result.userMessage).toMatch(/network/i);
    });

    it('heuristically classifies Firefox NetworkError text as retryable', () => {
      const err = new Error('NetworkError when attempting to fetch resource.');
      expect(classifyCheckoutError(err).kind).toBe('retryable');
    });
  });

  describe('fatal bucket', () => {
    it('maps session_closed to friendly copy', () => {
      const err = Object.assign(new Error('boom'), { details: { error: 'session_closed' } });
      const result = classifyCheckoutError(err);
      expect(result.kind).toBe('fatal');
      expect(result.userMessage).toMatch(/shift is closed/i);
    });

    it('maps fiscal_period_closed to friendly copy', () => {
      const err = Object.assign(new Error('boom'), {
        details: { error: 'fiscal_period_closed' },
      });
      expect(classifyCheckoutError(err).userMessage).toMatch(/fiscal period/i);
    });

    it('maps insufficient_stock to friendly copy', () => {
      const err = Object.assign(new Error('boom'), {
        details: { error: 'insufficient_stock' },
      });
      expect(classifyCheckoutError(err).userMessage).toMatch(/out of stock/i);
    });

    it('maps invalid_promotion to friendly copy', () => {
      const err = Object.assign(new Error('boom'), {
        details: { error: 'invalid_promotion' },
      });
      expect(classifyCheckoutError(err).userMessage).toMatch(/promotion/i);
    });

    it('maps account_locked to the French lockout copy (S38 SEC-06)', () => {
      const err = Object.assign(new Error('account_locked'), {
        details: { error: 'account_locked' },
      });
      const result = classifyCheckoutError(err);
      expect(result.kind).toBe('fatal');
      expect(result.userMessage).toMatch(/verrouillé 15 min/i);
    });

    it('maps discount_requires_authorizer to a clear fatal message (S43 P0-1)', () => {
      // Real shape thrown by useCheckout for EF 409 responses:
      // Object.assign(new Error(code), { details: bodyJson, status: 409 })
      // where bodyJson = { error: 'discount_requires_authorizer', message }.
      const err = Object.assign(new Error('discount_requires_authorizer'), {
        details: {
          error: 'discount_requires_authorizer',
          message: 'Discount requires an authorizing manager (p_discount_authorized_by)',
        },
        status: 409,
      });
      const result = classifyCheckoutError(err);
      expect(result.kind).toBe('fatal');
      expect(result.userMessage).toMatch(/manager/i);
      // Must be the friendly copy, not the generic "Payment failed (<code>)" fallback.
      expect(result.userMessage).not.toContain('discount_requires_authorizer');
    });

    it('maps combo_invalid_component to friendly FR copy (S57 P2.1)', () => {
      const err = Object.assign(new Error('combo_invalid_component'), {
        details: { error: 'combo_invalid_component', message: 'combo_invalid_component: ...' },
        status: 409,
      });
      const result = classifyCheckoutError(err);
      expect(result.kind).toBe('fatal');
      expect(result.userMessage).toMatch(/combo/i);
      // Friendly copy, not the generic "Payment failed (<code>)" fallback.
      expect(result.userMessage).not.toContain('combo_invalid_component');
    });

    it('maps combo_group_violation to friendly FR copy (S57 P2.1)', () => {
      const err = Object.assign(new Error('combo_group_violation'), {
        details: { error: 'combo_group_violation', message: 'combo_group_violation: ...' },
        status: 409,
      });
      const result = classifyCheckoutError(err);
      expect(result.kind).toBe('fatal');
      expect(result.userMessage).toMatch(/combo/i);
      expect(result.userMessage).not.toContain('combo_group_violation');
    });

    it('maps promo_cap_exceeded to friendly FR copy (S57 P2.1)', () => {
      const err = Object.assign(new Error('promo_cap_exceeded'), {
        details: { error: 'promo_cap_exceeded', message: 'promo_cap_exceeded: ...' },
        status: 409,
      });
      const result = classifyCheckoutError(err);
      expect(result.kind).toBe('fatal');
      expect(result.userMessage).toMatch(/promotion/i);
      expect(result.userMessage).not.toContain('promo_cap_exceeded');
    });

    it('maps product_inactive to friendly FR copy (ADR-011 déc. 2)', () => {
      const err = Object.assign(new Error('product_inactive'), {
        details: { error: 'product_inactive', message: 'product_inactive: Croissant est desactive' },
        status: 409,
      });
      const result = classifyCheckoutError(err);
      expect(result.kind).toBe('fatal');
      expect(result.userMessage).toMatch(/désactivé/i);
      expect(result.userMessage).not.toContain('product_inactive');
    });

    it('maps product_is_parent to friendly FR copy (ADR-011 déc. 2)', () => {
      const err = Object.assign(new Error('product_is_parent'), {
        details: { error: 'product_is_parent', message: 'product_is_parent: Croissant est un groupe de variantes' },
        status: 409,
      });
      const result = classifyCheckoutError(err);
      expect(result.kind).toBe('fatal');
      expect(result.userMessage).toMatch(/variante/i);
      expect(result.userMessage).not.toContain('product_is_parent');
    });

    it('maps credit_limit_exceeded to friendly FR copy (S62 D4)', () => {
      const err = Object.assign(new Error('credit_limit_exceeded'), {
        details: { error: 'credit_limit_exceeded', message: 'credit_limit_exceeded: {"allowed":false}' },
        status: 409,
      });
      const result = classifyCheckoutError(err);
      expect(result.kind).toBe('fatal');
      expect(result.userMessage).toMatch(/plafond|crédit/i);
      expect(result.userMessage).not.toContain('credit_limit_exceeded');
    });

    it('falls back to message for unknown codes', () => {
      const err = Object.assign(new Error('weird unknown thing'), {
        details: { error: 'mysterious_error' },
      });
      const result = classifyCheckoutError(err);
      expect(result.kind).toBe('fatal');
      expect(result.userMessage).toContain('mysterious_error');
    });

    it('handles plain non-Error throwables', () => {
      const result = classifyCheckoutError('something broke');
      expect(result.kind).toBe('fatal');
    });

    it('handles null gracefully', () => {
      const result = classifyCheckoutError(null);
      expect(result.kind).toBe('fatal');
    });
  });

  describe('shape probing', () => {
    it('reads code from details.code when details.error is absent', () => {
      const err = { details: { code: 'already_paid' } };
      expect(classifyCheckoutError(err).kind).toBe('already_paid');
    });

    it('prefers details.error over details.code when both present', () => {
      const err = {
        details: { error: 'network_error', code: 'already_paid' },
      };
      expect(classifyCheckoutError(err).kind).toBe('retryable');
    });
  });
});
