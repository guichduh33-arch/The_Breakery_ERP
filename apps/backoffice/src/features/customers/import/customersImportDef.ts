// apps/backoffice/src/features/customers/import/customersImportDef.ts
import type { EntityImportDef } from '@/features/data-import/entityImportDef.js';
import { CUSTOMERS_LIST_QUERY_KEY } from '@/features/customers/hooks/useCustomersList.js';

export const customersImportDef: EntityImportDef = {
  entity: 'customers',
  sheetName: 'Customers',
  rpcName: 'import_customers_v1',
  columns: [
    { key: 'name',                   required: true,  type: 'text' },
    { key: 'phone',                  required: false, type: 'text' },
    { key: 'email',                  required: false, type: 'text' },
    { key: 'customer_type',          required: false, type: 'text' },
    { key: 'category',               required: false, type: 'text' },
    { key: 'birth_date',             required: false, type: 'text' },
    { key: 'marketing_consent',      required: false, type: 'boolean' },
    { key: 'b2b_company_name',       required: false, type: 'text' },
    { key: 'b2b_tax_id',             required: false, type: 'text' },
    { key: 'b2b_payment_terms_days', required: false, type: 'number' },
    { key: 'b2b_credit_limit',       required: false, type: 'number' },
  ],
  example: {
    name: 'Budi Santoso', phone: '081234567890', email: 'budi@example.com',
    customer_type: 'retail', category: 'Regular', marketing_consent: true,
  },
  queryKeysToInvalidate: [CUSTOMERS_LIST_QUERY_KEY],
};
