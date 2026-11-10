// apps/backoffice/src/features/orders/__tests__/export-orders-csv.test.ts
//
// S3-21 — l'export CSV de la liste porte l'heure de création, l'heure de
// paiement et la table ; un paiement ou une table absents sortent vides.

import type * as DomainModule from '@breakery/domain';
import { describe, it, expect, vi } from 'vitest';
import { downloadCsv } from '@breakery/domain';
import { exportOrdersCsv } from '../exportOrdersCsv.js';
import type { OrdersListLine } from '../hooks/useOrdersList.js';

vi.mock('@breakery/domain', async (original) => ({
  ...await original<typeof DomainModule>(), downloadCsv: vi.fn(),
}));

const BASE: OrdersListLine = {
  id: 'o-1', order_number: 'ORD-001', order_type: 'dine_in', status: 'paid', total: 100_000,
  created_at: '2026-05-15T02:00:00Z', paid_at: '2026-05-15T03:30:00Z', table_number: 'T-07',
  customer_id: null, customer_name: null, customer_type: null, served_by: null,
  served_by_name: null, terminal_id: null, refund_status: 'none', has_modifiers: false,
  payment_method_primary: 'cash', items_count: 2,
};

describe('exportOrdersCsv', () => {
  it('writes Created, Paid and Table, blank when paid or table is missing', () => {
    exportOrdersCsv(
      [BASE, { ...BASE, id: 'o-2', order_number: 'ORD-002', status: 'draft', paid_at: null, table_number: null }],
      '2026-05-01', '2026-05-31',
    );
    expect(downloadCsv).toHaveBeenCalledTimes(1);
    const [csv, filename] = vi.mocked(downloadCsv).mock.calls[0] as [string, string];
    expect(filename).toBe('orders-2026-05-01_2026-05-31.csv');
    const rows = csv.replace(/^﻿/, '').trim().split('\r\n');
    expect(rows[0]).toBe('Order #,Created,Paid,Table,Type,Customer,Items,Amount,Status,Payment');
    // Horodatage métier WITA (UTC+8).
    expect(rows[1]).toMatch(/^ORD-001,2026-05-15 10:00:00,2026-05-15 11:30:00,T-07,dine_in,/);
    expect(rows[2]).toMatch(/^ORD-002,2026-05-15 10:00:00,,,dine_in,/);
  });
});
