// apps/pos/src/lib/__tests__/secureContextPolyfill.test.ts
import { describe, it, expect } from 'vitest';
import { randomUuidV4 } from '../secureContextPolyfill';

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('randomUuidV4', () => {
  it('produces RFC 4122 v4 UUIDs', () => {
    for (let i = 0; i < 50; i++) {
      expect(randomUuidV4()).toMatch(UUID_V4_RE);
    }
  });

  it('produces unique values', () => {
    const seen = new Set(Array.from({ length: 200 }, () => randomUuidV4()));
    expect(seen.size).toBe(200);
  });
});
