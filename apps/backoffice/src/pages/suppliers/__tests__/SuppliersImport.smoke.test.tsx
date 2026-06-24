// apps/backoffice/src/pages/suppliers/__tests__/SuppliersImport.smoke.test.tsx
import { describe, it, expect } from 'vitest';
import { suppliersImportDef } from '@/features/suppliers/import/suppliersImportDef.js';
import { buildTemplateWorkbook } from '@/features/data-import/buildEntityWorkbook.js';
import { parseEntityWorkbook } from '@/features/data-import/parseEntityWorkbook.js';
import * as XLSX from 'xlsx';

describe('suppliersImportDef', () => {
  it('produces a template that round-trips with the required columns', () => {
    const buf = XLSX.write(buildTemplateWorkbook(suppliersImportDef), { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const { rows, structureErrors } = parseEntityWorkbook(buf, suppliersImportDef);
    expect(structureErrors).toEqual([]);
    expect(rows[0]?.code).toBe('SUP-FLOUR');
    expect(rows[0]?.is_active).toBe(true);
  });
});
