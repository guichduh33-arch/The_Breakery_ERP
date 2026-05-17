import { describe, it, expect } from 'vitest';
import { evaluatePinStrength } from '../pin-strength';

describe('evaluatePinStrength', () => {
  describe('repetition', () => {
    it.each(['111111', '000000', '999999', '222222'])('detects %s', (pin) => {
      const r = evaluatePinStrength(pin);
      expect(r.weak).toBe(true);
      expect(r.reason).toBe('repetition');
    });

    it('treats 11 (too short) as not-weak', () => {
      expect(evaluatePinStrength('11')).toEqual({ weak: false, reason: null });
    });
  });

  describe('sequence', () => {
    it.each(['123456', '012345', '234567', '345678', '456789'])('detects ascending %s', (pin) => {
      expect(evaluatePinStrength(pin)).toEqual({ weak: true, reason: 'sequence' });
    });

    it.each(['654321', '987654', '543210'])('detects descending %s', (pin) => {
      expect(evaluatePinStrength(pin)).toEqual({ weak: true, reason: 'sequence' });
    });

    it('does NOT flag near-sequences like 123457', () => {
      expect(evaluatePinStrength('123457')).toEqual({ weak: false, reason: null });
    });
  });

  describe('common', () => {
    it.each(['121212', '159753', '147258', '112233', '696969'])('flags top-100 leaked PINs (%s)', (pin) => {
      const r = evaluatePinStrength(pin);
      expect(r.weak).toBe(true);
      expect(r.reason).toBe('common');
    });
  });

  describe('strong', () => {
    it.each(['285741', '936027', '472913', '601834'])('passes strong PIN %s', (pin) => {
      expect(evaluatePinStrength(pin)).toEqual({ weak: false, reason: null });
    });
  });

  describe('input guards', () => {
    it('null returns not-weak', () => {
      expect(evaluatePinStrength(null)).toEqual({ weak: false, reason: null });
    });
    it('empty string returns not-weak', () => {
      expect(evaluatePinStrength('')).toEqual({ weak: false, reason: null });
    });
    it('non-digit characters return not-weak (defensive — invalid format)', () => {
      expect(evaluatePinStrength('abcd56')).toEqual({ weak: false, reason: null });
    });
  });
});
