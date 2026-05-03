// packages/utils/src/__tests__/safeStorage.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { safeStorage } from '../safeStorage';

describe('safeStorage', () => {
  beforeEach(() => {
    // jsdom provides sessionStorage. Clear it.
    if (typeof sessionStorage !== 'undefined') sessionStorage.clear();
  });

  it('get returns null for missing key', async () => {
    const v = await safeStorage.get('missing');
    expect(v).toBeNull();
  });

  it('set + get roundtrips', async () => {
    await safeStorage.set('foo', 'bar');
    expect(await safeStorage.get('foo')).toBe('bar');
  });

  it('remove deletes the key', async () => {
    await safeStorage.set('foo', 'bar');
    await safeStorage.remove('foo');
    expect(await safeStorage.get('foo')).toBeNull();
  });

  it('returns null silently if sessionStorage throws', async () => {
    const original = sessionStorage.getItem;
    sessionStorage.getItem = vi.fn(() => { throw new Error('quota'); });
    try {
      const v = await safeStorage.get('any');
      expect(v).toBeNull();
    } finally {
      sessionStorage.getItem = original;
    }
  });

  it('clear wipes all keys', async () => {
    await safeStorage.set('a', '1');
    await safeStorage.set('b', '2');
    await safeStorage.clear();
    expect(await safeStorage.get('a')).toBeNull();
    expect(await safeStorage.get('b')).toBeNull();
  });

  it('set does not throw if sessionStorage.setItem throws', async () => {
    const original = sessionStorage.setItem;
    sessionStorage.setItem = vi.fn(() => { throw new Error('quota'); });
    try {
      await expect(safeStorage.set('x', 'y')).resolves.toBeUndefined();
    } finally {
      sessionStorage.setItem = original;
    }
  });

  it('remove does not throw if sessionStorage.removeItem throws', async () => {
    const original = sessionStorage.removeItem;
    sessionStorage.removeItem = vi.fn(() => { throw new Error('quota'); });
    try {
      await expect(safeStorage.remove('x')).resolves.toBeUndefined();
    } finally {
      sessionStorage.removeItem = original;
    }
  });

  it('clear does not throw if sessionStorage.clear throws', async () => {
    const original = sessionStorage.clear;
    sessionStorage.clear = vi.fn(() => { throw new Error('quota'); });
    try {
      await expect(safeStorage.clear()).resolves.toBeUndefined();
    } finally {
      sessionStorage.clear = original;
    }
  });
});
