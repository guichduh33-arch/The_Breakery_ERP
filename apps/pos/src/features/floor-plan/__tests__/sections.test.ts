// apps/pos/src/features/floor-plan/__tests__/sections.test.ts
import { describe, expect, it } from 'vitest';
import { bucketTablesBySection } from '../sections';
import type { RestaurantTable } from '@breakery/domain';

const t = (name: string, section: { name: string; sort_order: number } | null, id = name): RestaurantTable => ({
  id, name, seats: 4, sort_order: 0, is_active: true,
  section_id: section ? section.name : null, table_sections: section,
});

describe('bucketTablesBySection', () => {
  it('groups by joined section, ordered by section sort_order', () => {
    const out = bucketTablesBySection([
      t('P1', { name: 'Terrace', sort_order: 100 }),
      t('T1', { name: 'Interior', sort_order: 0 }),
    ]);
    expect(out.map((s) => s.label)).toEqual(['Interior', 'Terrace']);
    expect(out[1]?.tables.map((x) => x.name)).toEqual(['P1']);
  });
  it('parks NULL-section tables under a leading Interior fallback', () => {
    const out = bucketTablesBySection([t('Legacy', null), t('P1', { name: 'Terrace', sort_order: 100 })]);
    expect(out[0]).toMatchObject({ key: 'unsectioned', label: 'Interior' });
    expect(out[0]?.tables.map((x) => x.name)).toEqual(['Legacy']);
  });
  it('merges NULL-section tables into a real Interior section when one exists', () => {
    const out = bucketTablesBySection([t('T1', { name: 'Interior', sort_order: 0 }), t('Legacy', null)]);
    expect(out).toHaveLength(1);
    expect(out[0]?.tables.map((x) => x.name)).toEqual(['T1', 'Legacy']);
  });
});
