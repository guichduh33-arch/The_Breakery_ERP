// apps/backoffice/src/features/suppliers/import/suppliersImportDef.ts
import type { EntityImportDef } from '@/features/data-import/entityImportDef.js';
import { SUPPLIERS_QUERY_KEY } from '@/features/suppliers/hooks/useSuppliersList.js';

export const suppliersImportDef: EntityImportDef = {
  entity: 'suppliers',
  sheetName: 'Suppliers',
  rpcName: 'import_suppliers_v1',
  columns: [
    { key: 'code',               required: true,  type: 'text' },
    { key: 'name',               required: true,  type: 'text' },
    { key: 'contact_phone',      required: false, type: 'text' },
    { key: 'contact_email',      required: false, type: 'text' },
    { key: 'address',            required: false, type: 'text' },
    { key: 'payment_terms_days', required: false, type: 'number' },
    { key: 'notes',              required: false, type: 'text' },
    { key: 'is_active',          required: false, type: 'boolean' },
  ],
  example: {
    code: 'SUP-FLOUR', name: 'PT Tepung Jaya', contact_phone: '+62 812 0000 0000',
    contact_email: 'sales@tepungjaya.co.id', address: 'Jakarta', payment_terms_days: 30, is_active: true,
  },
  queryKeysToInvalidate: [SUPPLIERS_QUERY_KEY],
};
