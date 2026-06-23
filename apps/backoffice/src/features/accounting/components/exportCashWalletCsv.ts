// apps/backoffice/src/features/accounting/components/exportCashWalletCsv.ts
// Cash Wallets module — CSV export for the active wallet ledger.
// Delegates CSV body construction to @breakery/domain buildCsv (RFC 4180 + UTF-8 BOM + id-ID locale).
// Blob/download glue is kept local (browser-only).
import { buildCsv, downloadCsv, type CsvColumn } from '@breakery/domain';
import type { WalletLedgerRow } from '../hooks/useCashWalletLedger.js';

const COLUMNS: CsvColumn<WalletLedgerRow>[] = [
  { header: 'Date',        accessor: (r) => r.row_date,         format: 'date' },
  { header: 'Remark',      accessor: (r) => r.remark ?? '',     format: 'text' },
  { header: 'Category',    accessor: (r) => r.category ?? '',   format: 'text' },
  { header: 'Description', accessor: (r) => r.description ?? '', format: 'text' },
  { header: 'Supplier',    accessor: (r) => r.supplier ?? '',   format: 'text' },
  { header: 'In',          accessor: (r) => r.in_amount ?? 0,   format: 'idr' },
  { header: 'Out',         accessor: (r) => r.out_amount ?? 0,  format: 'idr' },
  { header: 'Saldo',       accessor: (r) => r.saldo,            format: 'idr' },
];

export function exportCashWalletCsv(rows: WalletLedgerRow[], walletName: string): void {
  const csv = buildCsv(rows, COLUMNS, { bom: true, locale: 'id-ID' });
  const slug = walletName.toLowerCase().replace(/\s+/g, '-');
  downloadCsv(csv, `cash-${slug}.csv`);
}
