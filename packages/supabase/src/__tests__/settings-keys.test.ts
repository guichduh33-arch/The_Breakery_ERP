// S73 Phase 3 — conformance guard for the shared settings-keys dictionary
// (packages/supabase/src/settings-keys.ts). Keeps the dictionary the single
// source of truth: no key duplicated across categories, every category
// populated.
import { describe, it, expect } from 'vitest';
import { SETTING_KEYS, SETTINGS_CATEGORIES } from '../settings-keys.js';

describe('settings-keys dictionary', () => {
  it('every category has at least one key and no duplicates across categories', () => {
    const all = SETTINGS_CATEGORIES.flatMap((c) => SETTING_KEYS[c]);
    expect(new Set(all).size).toBe(all.length);
    for (const category of SETTINGS_CATEGORIES) {
      expect(SETTING_KEYS[category].length).toBeGreaterThan(0);
    }
  });
});
