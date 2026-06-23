// apps/backoffice/src/features/accounting/components/WalletLedgerTable.tsx
// Cash Wallets module — In/Out/Saldo ledger table for a single wallet.
import type { WalletLedgerRow } from '../hooks/useCashWalletLedger.js';

const idr = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });

export function WalletLedgerTable({
  rows,
  loading,
}: {
  rows: WalletLedgerRow[];
  loading: boolean;
}) {
  if (loading) {
    return <div className="p-4 text-sm text-muted-foreground">Loading ledger…</div>;
  }
  if (rows.length === 0) {
    return <div className="p-4 text-sm text-muted-foreground">No movements in this period.</div>;
  }
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-muted-foreground border-b">
          <th className="py-2">Date</th>
          <th>Remark</th>
          <th>Category</th>
          <th>Description</th>
          <th>Supplier</th>
          <th className="text-right">In</th>
          <th className="text-right">Out</th>
          <th className="text-right">Saldo</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-b last:border-0">
            <td className="py-1.5 whitespace-nowrap">{r.row_date}</td>
            <td className="truncate max-w-[220px]">{r.remark}</td>
            <td className="truncate max-w-[140px]">{r.category ?? ''}</td>
            <td className="truncate max-w-[200px]">{r.description ?? ''}</td>
            <td className="truncate max-w-[160px]">{r.supplier ?? ''}</td>
            <td className="text-right tabular-nums">{r.in_amount ? idr.format(r.in_amount) : ''}</td>
            <td className="text-right tabular-nums">{r.out_amount ? idr.format(r.out_amount) : ''}</td>
            <td className="text-right tabular-nums font-medium">{idr.format(r.saldo)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
