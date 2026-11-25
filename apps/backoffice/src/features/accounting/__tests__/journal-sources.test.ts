// apps/backoffice/src/features/accounting/__tests__/journal-sources.test.ts
//
// Les familles d'émetteurs filtrables du journal : les écritures de l'ADR-047
// (dotation, sortie d'équipement) doivent y être nommées, sans doublon.

import { describe, expect, it } from 'vitest';
import { JOURNAL_SOURCE_OPTIONS } from '@/features/accounting/utils/journalSources.js';

describe('JOURNAL_SOURCE_OPTIONS', () => {
  it('names the ADR-047 entry families', () => {
    expect(JOURNAL_SOURCE_OPTIONS).toContainEqual({ value: 'fixed_asset_depreciation', label: 'Depreciation' });
    expect(JOURNAL_SOURCE_OPTIONS).toContainEqual({ value: 'fixed_asset_disposal', label: 'Asset disposal' });
  });

  it('declares each family once', () => {
    const values = JOURNAL_SOURCE_OPTIONS.map((o) => o.value);
    expect(new Set(values).size).toBe(values.length);
  });
});
