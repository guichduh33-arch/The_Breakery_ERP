import { beforeEach, describe, expect, it } from 'vitest';
import { draftError, emptyDraft, readDraft, requestFor, writeDraft } from '../drafts.js';

describe('kitchen drafts', () => {
  beforeEach(() => localStorage.clear());
  it('isolates drafts by user and station', () => {
    const draft = emptyDraft('chef-a', 'pastry');
    draft.rows = [{ productId: 'bread', name: 'Bread', unit: 'pcs', quantity: '5', waste: '0', wasteReason: '', note: '' }];
    writeDraft(draft);
    expect(readDraft('chef-a', 'pastry').rows).toHaveLength(1);
    expect(readDraft('chef-b', 'pastry').rows).toHaveLength(0);
    expect(readDraft('chef-a', 'bakery').rows).toHaveLength(0);
  });
  it('persists the exact pending request across reloads', () => {
    const draft = emptyDraft('chef', 'station');
    draft.rows = [{ productId: 'bread', name: 'Bread', unit: 'pcs', quantity: '5', waste: '1', wasteReason: 'mis_baked', note: 'First batch' }];
    draft.pending = requestFor(draft, 'same-key');
    writeDraft(draft);
    expect(readDraft('chef', 'station').pending).toEqual(draft.pending);
  });
  it('refuses an altered pending payload instead of silently creating a new submission', () => {
    const draft = emptyDraft('chef', 'station');
    draft.pending = { ...requestFor(draft, 'same-key'), section_id: 'other' };
    writeDraft(draft);
    expect(() => readDraft('chef', 'station')).toThrow('Invalid saved draft');
  });
  it('requires a waste reason and preserves old drafts without relabelling their day', () => {
    const draft = emptyDraft('chef', 'station');
    draft.rows = [{ productId: 'bread', name: 'Bread', unit: 'pcs', quantity: '5', waste: '1', wasteReason: '', note: '' }];
    expect(draftError(draft)).toMatch(/reason/);
    draft.rows[0]!.wasteReason = 'mis_baked';
    expect(draftError(draft)).toBeNull();
    draft.day = '2000-01-01';
    writeDraft(draft);
    expect(draftError(readDraft('chef', 'station'))).toMatch(/another day/);
    expect(readDraft('chef', 'station').day).toBe('2000-01-01');
  });
});
