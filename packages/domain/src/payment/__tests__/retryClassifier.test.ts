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
