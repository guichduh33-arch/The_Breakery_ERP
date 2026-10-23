import { describe, it, expect } from 'vitest';
import { isAllowedOrigin, ownOrigin } from '../originGuard.js';

const ALLOWED = ['https://shop.test'];
const OWN = 'https://pos.the-breakery.com:3001';

describe('ownOrigin', () => {
  it('builds the origin from the TLS flag and the Host header', () => {
    expect(ownOrigin(true, 'pos.the-breakery.com:3001')).toBe(OWN);
    expect(ownOrigin(false, '127.0.0.1:8080')).toBe('http://127.0.0.1:8080');
  });

  it('lower-cases the host', () => {
    expect(ownOrigin(true, 'POS.The-Breakery.com:3001')).toBe(OWN);
  });

  it('is null without a Host header', () => {
    expect(ownOrigin(true, undefined)).toBeNull();
    expect(ownOrigin(true, '')).toBeNull();
  });
});

describe('isAllowedOrigin', () => {
  it('lets a request without Origin through (non-browser clients)', () => {
    expect(isAllowedOrigin(undefined, OWN, ALLOWED)).toBe(true);
  });

  it('accepts an allow-listed origin', () => {
    expect(isAllowedOrigin('https://shop.test', OWN, ALLOWED)).toBe(true);
  });

  // Régression boutique du 2026-10-23 : la SPA servie par le pont recevait
  // 403 origin_forbidden sur ses propres scripts, d'où un écran blanc.
  it('accepts the bridge own origin even when it is not allow-listed', () => {
    expect(isAllowedOrigin(OWN, OWN, ALLOWED)).toBe(true);
    expect(isAllowedOrigin(OWN, OWN, [])).toBe(true);
  });

  it('compares the own origin case-insensitively', () => {
    expect(isAllowedOrigin('https://POS.the-breakery.com:3001', OWN, ALLOWED)).toBe(true);
  });

  it('refuses a foreign origin', () => {
    expect(isAllowedOrigin('https://evil.test', OWN, ALLOWED)).toBe(false);
  });

  it('refuses the same host on another port', () => {
    expect(isAllowedOrigin('https://pos.the-breakery.com:3443', OWN, ALLOWED)).toBe(false);
  });

  it('refuses the same host over plain http', () => {
    expect(isAllowedOrigin('http://pos.the-breakery.com:3001', OWN, ALLOWED)).toBe(false);
  });

  it('refuses the opaque null origin', () => {
    expect(isAllowedOrigin('null', OWN, ALLOWED)).toBe(false);
  });

  it('falls back to the allow-list alone without a Host', () => {
    expect(isAllowedOrigin(OWN, null, ALLOWED)).toBe(false);
    expect(isAllowedOrigin('https://shop.test', null, ALLOWED)).toBe(true);
  });
});
