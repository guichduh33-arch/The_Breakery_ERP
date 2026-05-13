// packages/domain/src/lan/__tests__/messageDedup.test.ts
// Session 13 / Phase 5.A — unit tests for MessageDedup.

import { describe, it, expect } from 'vitest';
import { MessageDedup } from '../messageDedup.js';

function fixedClock(start = 0) {
  let t = start;
  return {
    now: () => t,
    advance(ms: number) {
      t += ms;
    },
  };
}

describe('MessageDedup', () => {
  it('returns false on first sighting, true on second', () => {
    const dedup = new MessageDedup();
    expect(dedup.seen('msg-1')).toBe(false);
    expect(dedup.seen('msg-1')).toBe(true);
  });

  it('treats different ids independently', () => {
    const dedup = new MessageDedup();
    expect(dedup.seen('a')).toBe(false);
    expect(dedup.seen('b')).toBe(false);
    expect(dedup.seen('a')).toBe(true);
    expect(dedup.seen('b')).toBe(true);
  });

  it('expires entries past the TTL', () => {
    const clock = fixedClock(1000);
    const dedup = new MessageDedup({ ttlMs: 5_000, now: clock.now });
    expect(dedup.seen('msg-1')).toBe(false);
    clock.advance(4_999);
    expect(dedup.seen('msg-1')).toBe(true); // still in window
    clock.advance(2);
    expect(dedup.seen('msg-1')).toBe(false); // expired → re-recorded
  });

  it('enforces maxSize via FIFO eviction', () => {
    const dedup = new MessageDedup({ maxSize: 3, ttlMs: 60_000 });
    dedup.seen('a');
    dedup.seen('b');
    dedup.seen('c');
    dedup.seen('d'); // evicts 'a'
    expect(dedup.size()).toBe(3);
    // 'a' was evicted → re-record returns false
    expect(dedup.seen('a')).toBe(false);
    // 'd' still cached → returns true
    expect(dedup.seen('d')).toBe(true);
  });

  it('counts dropped duplicates', () => {
    const dedup = new MessageDedup();
    dedup.seen('x');
    dedup.seen('x');
    dedup.seen('x');
    expect(dedup.droppedCount()).toBe(2);
  });

  it('clear() resets state', () => {
    const dedup = new MessageDedup();
    dedup.seen('a');
    dedup.seen('a');
    expect(dedup.droppedCount()).toBe(1);
    dedup.clear();
    expect(dedup.size()).toBe(0);
    expect(dedup.droppedCount()).toBe(0);
    expect(dedup.seen('a')).toBe(false);
  });

  it('prune() opportunistically removes expired entries', () => {
    const clock = fixedClock(0);
    const dedup = new MessageDedup({ ttlMs: 1_000, now: clock.now });
    dedup.seen('old');
    clock.advance(2_000);
    dedup.seen('new'); // triggers prune
    expect(dedup.size()).toBe(1);
  });

  it('size() returns 0 after clear', () => {
    const dedup = new MessageDedup();
    dedup.seen('a');
    dedup.seen('b');
    dedup.clear();
    expect(dedup.size()).toBe(0);
  });
});
