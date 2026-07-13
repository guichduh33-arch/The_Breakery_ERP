// apps/pos/src/features/floor-plan/sections.ts
//
// S75 lot 1 — real `table_sections` grouping, replacing the S14
// `sort_order >= 100` Interior/Terrace heuristic.
//
// Rules (task-4-brief.md):
//   - Group tables by their joined `table_sections` row, ordered by
//     `table_sections.sort_order`.
//   - Tables with `section_id === null` (legacy/unsectioned) are merged
//     into a real "Interior" section if one is present in the input; if
//     none exists, they are parked in a synthetic `unsectioned` bucket
//     (label "Interior") sorted first (sortOrder -1).
//   - Table order within a bucket follows input order (the server already
//     sorts by `sort_order`); NULL-section tables merged into a real
//     Interior bucket are appended after that section's own tables — a
//     known, accepted limitation: a NULL table whose server position
//     interleaves with Interior's own tables loses its relative slot.
//     Backfill migration _161 assigned section_id to every existing row,
//     so NULL rows are rare/transient (fresh BO-created tables only).

import type { RestaurantTable } from '@breakery/domain';

export interface FloorSection {
  key: string;
  label: string;
  tables: RestaurantTable[];
}

const UNSECTIONED_KEY = 'unsectioned';
const UNSECTIONED_LABEL = 'Interior';

interface Bucket extends FloorSection {
  sortOrder: number;
}

export function bucketTablesBySection(tables: RestaurantTable[]): FloorSection[] {
  const bySectionId = new Map<string, Bucket>();
  const nullTables: RestaurantTable[] = [];

  for (const table of tables) {
    if (table.section_id !== null && table.table_sections) {
      const key = table.section_id;
      let bucket = bySectionId.get(key);
      if (!bucket) {
        bucket = {
          key,
          label: table.table_sections.name,
          tables: [],
          sortOrder: table.table_sections.sort_order,
        };
        bySectionId.set(key, bucket);
      }
      bucket.tables.push(table);
    } else {
      nullTables.push(table);
    }
  }

  if (nullTables.length > 0) {
    const interiorBucket = Array.from(bySectionId.values()).find(
      (bucket) => bucket.label === UNSECTIONED_LABEL,
    );
    if (interiorBucket) {
      interiorBucket.tables.push(...nullTables);
    } else {
      bySectionId.set(UNSECTIONED_KEY, {
        key: UNSECTIONED_KEY,
        label: UNSECTIONED_LABEL,
        tables: [...nullTables],
        sortOrder: -1,
      });
    }
  }

  return Array.from(bySectionId.values())
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(({ key, label, tables: sectionTables }) => ({ key, label, tables: sectionTables }));
}
