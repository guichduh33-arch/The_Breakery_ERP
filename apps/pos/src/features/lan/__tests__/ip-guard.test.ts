// ADR-030 — reprise de la couverture qui vivait côté back-office
// (features/lan-devices/__tests__/bridge-api.test.ts), déménagée avec le garde.
import { describe, it, expect } from 'vitest';
import { isPrivatePrefix } from '../utils/ipGuard';

describe('isPrivatePrefix', () => {
  it('accepts the private ranges', () => {
    expect(isPrivatePrefix('192.168.1')).toBe(true);
    expect(isPrivatePrefix('10.0.0')).toBe(true);
    expect(isPrivatePrefix('172.16.5')).toBe(true);
    expect(isPrivatePrefix('172.31.0')).toBe(true);
    expect(isPrivatePrefix('127.0.0')).toBe(true);
  });

  it('rejects public and out-of-range prefixes', () => {
    expect(isPrivatePrefix('8.8.8')).toBe(false);
    expect(isPrivatePrefix('172.15.0')).toBe(false);
    expect(isPrivatePrefix('172.32.0')).toBe(false);
    expect(isPrivatePrefix('256.168.1')).toBe(false);
  });

  it('rejects malformed input', () => {
    expect(isPrivatePrefix('192.168')).toBe(false);
    expect(isPrivatePrefix('192.168.1.1')).toBe(false);
    expect(isPrivatePrefix('')).toBe(false);
    expect(isPrivatePrefix('not-an-ip')).toBe(false);
  });
});
