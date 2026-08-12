// apps/backoffice/src/features/orders/exportOrdersCsv.ts
//
// Export CSV de la liste des commandes — via le helper partagé buildCsv
// (quoting correct, CRLF, BOM) et l'horodatage métier exact
// formatDateTimeWita (review PR #367 : l'écriture à la main divergeait du
// format maison et cassait sur une virgule dans un nom).
// L'APPELANT porte le gate `reports.export`.

import { buildCsv, downloadCsv } from '@breakery/domain';
import { formatDateTimeWita } from '@breakery/utils';
import type { OrdersListLine } from './hooks/useOrdersList.js';

export function exportOrdersCsv(lines: OrdersListLine[], start: string, end: string): void {
  const csv = buildCsv(lines, [
    { header: 'Order #',  accessor: (o) => o.order_number },
    { header: 'Time',     accessor: (o) => formatDateTimeWita(o.created_at) },
    { header: 'Type',     accessor: (o) => o.order_type },
    { header: 'Customer', accessor: (o) => o.customer_name ?? '' },
    { header: 'Items',    accessor: (o) => o.items_count, format: 'number' },
    { header: 'Amount',   accessor: (o) => o.total, format: 'idr' },
    { header: 'Status',   accessor: (o) => o.status },
    { header: 'Payment',  accessor: (o) => o.payment_method_primary ?? '' },
  ]);
  downloadCsv(csv, `orders-${start}_${end}.csv`);
}
