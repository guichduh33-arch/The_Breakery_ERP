import * as XLSX from 'xlsx';

export interface CountProduct { id: string; sku: string; name: string; unit: string | null }
export interface CountImportRow { productId: string; sku: string; unit: string; quantity: number; notes: string }
const headers = ['sku', 'name', 'unit', 'counted_qty', 'notes'];
function cellText(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : '';
}

export function buildOpnameWorkbook(products: readonly CountProduct[]): XLSX.WorkBook {
  const sheet = XLSX.utils.aoa_to_sheet([
    headers, ...products.map((p) => [p.sku, p.name, p.unit ?? 'pcs', '', '']),
  ]);
  sheet['!cols'] = [20, 40, 12, 18, 40].map((wch) => ({ wch }));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Stock count');
  return book;
}

export function parseOpnameWorkbook(buffer: ArrayBuffer, products: readonly CountProduct[]) {
  const book = XLSX.read(buffer, { type: 'array' });
  const sheet = book.Sheets['Stock count'];
  if (!sheet) throw new Error('Missing "Stock count" sheet. Use the downloaded template.');
  const cells = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', blankrows: true });
  if (headers.some((h, i) => cells[0]?.[i] !== h)) throw new Error('Invalid headers. Use the downloaded template.');
  const bySku = new Map(products.map((p) => [p.sku, p]));
  const seen = new Set<string>();
  const rows: CountImportRow[] = [];
  const errors: string[] = [];
  cells.slice(1).forEach((row, index) => {
    if (row.every((v) => cellText(v).trim() === '')) return;
    const sku = cellText(row[0]).trim();
    const product = bySku.get(sku);
    const fail = (message: string) => { errors.push(`Row ${String(index + 2)}: ${message}`); };
    if (!product) { fail(`Unknown inventory SKU "${sku}".`); return; }
    if (seen.has(sku)) { fail(`Duplicate SKU "${sku}".`); return; }
    seen.add(sku);
    if (cellText(row[2]).trim() !== (product.unit ?? 'pcs')) { fail(`Unit must be ${product.unit ?? 'pcs'} for ${sku}.`); return; }
    const raw = row[3];
    const cell = sheet[XLSX.utils.encode_cell({ r: index + 1, c: 3 })] as XLSX.CellObject | undefined;
    if (cell?.f) { fail('Enter a quantity, not a formula.'); return; }
    if (raw === undefined || raw === null || cellText(raw).trim() === '') return;
    const value = cellText(raw).trim();
    const quantity = Number(value);
    if ((typeof raw !== 'number' && typeof raw !== 'string') || !/^\d+(?:\.\d{1,3})?$/.test(value)
      || !Number.isFinite(quantity) || quantity < 0 || quantity > 9999999.999) {
      fail('Quantity must be between 0 and 9999999.999, with at most 3 decimals.'); return;
    }
    rows.push({ productId: product.id, sku, unit: product.unit ?? 'pcs', quantity, notes: cellText(row[4]).trim() });
  });
  return { rows, errors };
}
