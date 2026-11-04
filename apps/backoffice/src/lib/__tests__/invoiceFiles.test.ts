import { describe, expect, it } from 'vitest';
import { INVOICE_MAX_SIZE, isInvoicePath, validateInvoiceFile } from '../invoiceFiles.js';

describe('payment invoice files', () => {
  it.each(['image/jpeg', 'application/pdf'])('accepts a nonempty %s invoice', type => {
    expect(() => validateInvoiceFile(new File(['invoice'], 'invoice', { type }))).not.toThrow();
  });
  it.each(['image/png', 'image/webp', 'text/html', ''])('rejects new %s uploads', type => {
    expect(() => validateInvoiceFile(new File(['invoice'], 'invoice.pdf', { type }))).toThrow('JPEG or PDF');
  });
  it('rejects empty and oversized files', () => {
    expect(() => validateInvoiceFile(new File([], 'invoice.pdf', { type: 'application/pdf' }))).toThrow('empty');
    expect(() => validateInvoiceFile(new File([new Uint8Array(INVOICE_MAX_SIZE + 1)], 'invoice.pdf', { type: 'application/pdf' }))).toThrow('max 5 MB');
  });
  it('requires the entity prefix and a supported extension', () => {
    expect(isInvoicePath('expenses/a/file.pdf', 'expenses/a/')).toBe(true);
    expect(isInvoicePath('expenses/b/file.pdf', 'expenses/a/')).toBe(false);
    expect(isInvoicePath('expenses/a/file.png', 'expenses/a/')).toBe(false);
    expect(isInvoicePath(null, 'expenses/a/')).toBe(false);
  });
});
