import { useState, type ChangeEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/BackofficeUi.js';
import { FOCUS_RING } from '@/components/focusRing.js';
import { opnameDetailKey, type OpnameItemRow } from '../hooks/useOpnameDetail.js';
import { OPNAME_LIST_QUERY_KEY } from '../hooks/useOpnameList.js';
import { importCountRows, loadCountProducts } from '../opnameImport.js';
import type { CountImportRow } from '../opnameWorkbook.js';

interface Props {
  countId: string;
  items: readonly OpnameItemRow[];
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
}

export function OpnameFileActions({ countId, items, disabled, onBusyChange }: Props) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<CountImportRow[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const replacements = rows.filter((row) => items.some((item) => item.product_id === row.productId && item.counted_qty !== null)).length;
  function changeBusy(value: boolean) { setBusy(value); onBusyChange(value); }
  async function download() {
    changeBusy(true); setErrors([]);
    try {
      const products = await loadCountProducts();
      if (products.length === 0) throw new Error('No inventory items available.');
      const [{ buildOpnameWorkbook }, XLSX] = await Promise.all([import('../opnameWorkbook.js'), import('xlsx')]);
      XLSX.writeFile(buildOpnameWorkbook(products), 'stock-opname-template.xlsx');
    } catch (error) { setErrors([error instanceof Error ? error.message : 'Download failed.']); }
    finally { changeBusy(false); }
  }
  async function readFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setRows([]); setErrors([]); setMessage(''); changeBusy(true);
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('File must be smaller than 5 MB.');
      const [{ parseOpnameWorkbook }, buffer, products] = await Promise.all([
        import('../opnameWorkbook.js'), file.arrayBuffer(), loadCountProducts(),
      ]);
      const result = parseOpnameWorkbook(buffer, products);
      setErrors(result.errors);
      if (result.errors.length === 0) {
        setRows(result.rows);
        if (result.rows.length === 0) setMessage('No quantities entered. Blank quantities are skipped.');
      }
    } catch (error) { setErrors([error instanceof Error ? error.message : 'File could not be read.']); }
    finally { changeBusy(false); }
  }
  async function confirm() {
    changeBusy(true); setErrors([]); setMessage('');
    let saved = 0;
    try {
      await importCountRows(countId, rows, () => { saved += 1; });
      setMessage(`${String(saved)} counts imported. Validate the count when all items are ready.`);
    } catch (error) {
      setErrors([`${String(saved)} rows saved. Remaining rows were not imported. ${error instanceof Error ? error.message : 'Import failed.'} Retry the remaining rows below.`]);
    } finally {
      setRows((previous) => previous.slice(saved));
      await Promise.all([
        qc.invalidateQueries({ queryKey: opnameDetailKey(countId) }),
        qc.invalidateQueries({ queryKey: OPNAME_LIST_QUERY_KEY }),
      ]);
      changeBusy(false);
    }
  }
  return (
    <section aria-label="Stock count import" className="space-y-3 rounded-md border border-border-subtle bg-bg-elevated p-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" disabled={disabled || busy} onClick={() => { void download(); }}>Download template</Button>
        <label className="text-sm text-text-secondary" htmlFor="opname-file">Import counts (.xlsx)</label>
        <input id="opname-file" type="file" accept=".xlsx" className={`max-w-full rounded-md text-sm text-text-secondary ${FOCUS_RING}`} disabled={disabled || busy} onChange={(event) => { void readFile(event); }} />
      </div>
      <p className="text-sm text-text-secondary">Count in the unit shown. Leave uncounted quantities blank; enter 0 only when none remain. Expected stock is hidden.</p>
      {busy && <p role="status">Processing… Keep this count open.</p>}
      {rows.length > 0 && <>
        <p className="text-sm">{rows.length} rows ready. {replacements} existing counts will be replaced. Notes will also be replaced. Rows are saved individually; an error stops the import and keeps saved rows.</p>
        <div className="max-h-64 overflow-auto">
          <table className="w-full text-sm"><caption className="sr-only">Import preview</caption>
            <thead><tr><th scope="col">SKU</th><th scope="col">Unit</th><th scope="col">Counted</th><th scope="col">Notes</th></tr></thead>
            <tbody>{rows.map((row) => <tr key={row.productId}><td>{row.sku}</td><td>{row.unit}</td><td>{row.quantity}</td><td>{row.notes}</td></tr>)}</tbody>
          </table>
        </div>
        <Button variant="secondary" disabled={disabled || busy} onClick={() => { void confirm(); }}>Confirm import</Button>
        <Button variant="ghost" disabled={busy} onClick={() => { setRows([]); setErrors([]); }}>Discard file</Button>
      </>}
      {errors.length > 0 && <div role="alert" className="text-sm text-danger">{errors.slice(0, 30).map((error, index) => <p key={index}>{error}</p>)}{errors.length > 30 && <p>{errors.length - 30} more errors.</p>}</div>}
      {message && <p role="status" className="text-sm">{message}</p>}
    </section>
  );
}
