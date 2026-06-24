// apps/backoffice/src/pages/customers/__tests__/CustomersImport.smoke.test.tsx
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { customersImportDef } from '@/features/customers/import/customersImportDef.js';
import { buildTemplateWorkbook } from '@/features/data-import/buildEntityWorkbook.js';
import { parseEntityWorkbook } from '@/features/data-import/parseEntityWorkbook.js';

describe('customersImportDef', () => {
  it('template round-trips with name required and consent boolean', () => {
    const buf = XLSX.write(buildTemplateWorkbook(customersImportDef), { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const { rows, structureErrors } = parseEntityWorkbook(buf, customersImportDef);
    expect(structureErrors).toEqual([]);
    expect(rows[0]?.name).toBe('Budi Santoso');
    expect(rows[0]?.marketing_consent).toBe(true);
  });
});
