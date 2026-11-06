import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, type B2bInvoiceData } from '../../functions/_shared/pdf-templates/b2b_invoice.ts';
import { DEFAULT_INVOICE_PRINT_OPTIONS } from '../../functions/_shared/invoice-print-options.ts';
import { MM_TO_PT } from '../../functions/_shared/pdf-templates/invoice-canvas.ts';
import type { LayoutContext } from '../../functions/_shared/pdf-layout.ts';

vi.mock('https://esm.sh/pdf-lib@1.17.1', () => ({ rgb: () => ({}) }));

const font = { getCharacterSet: () => [...Array.from({ length: 224 }, (_, i) => i + 32), 0x2014],
  widthOfTextAtSize: (text: string, size: number) => text.length * size * .5 };
const pages: { drawText: ReturnType<typeof vi.fn>; drawLine: ReturnType<typeof vi.fn>; drawImage: ReturnType<typeof vi.fn> }[] = [];
const addPage = vi.fn((_size: number[]) => {
  const page = { drawText: vi.fn(), drawLine: vi.fn(), drawImage: vi.fn() };
  pages.push(page); return page;
});
function context(overrides = {}): LayoutContext {
  return { doc: { addPage }, font, fontBold: font, business: { name: 'The Breakery', address: 'Business address' },
    invoiceTemplate: { ...DEFAULT_INVOICE_PRINT_OPTIONS, ...overrides } } as unknown as LayoutContext;
}
function invoice(count = 2): B2bInvoiceData {
  return { invoice: { invoice_number: 'INV-001', order_number: 'BO-001', invoice_date: '2026-11-06',
    due_date: '2026-11-20', status: 'b2b_pending', subtotal: 1450, tax_amount: 0, total: 1450, notes: null },
  customer: { company_name: 'Example company', tax_id: null, name: 'Example customer', payment_terms_days: 14 },
  lines: Array.from({ length: count }, (_, i) => ({ name: `PRODUCT-${i}`, quantity: 1, unit_price: 125, line_total: 725 })),
  payment: { amount_paid: 200, outstanding: 1250 } };
}
const texts = () => pages.flatMap((page) => page.drawText.mock.calls.map(([text]) => String(text)));

describe('B2B configurable invoice PDF', () => {
  beforeEach(() => { pages.length = 0; vi.clearAllMocks(); });
  it('uses exact custom paper dimensions and print offsets', async () => {
    await render(context({ paper_width_mm: 241.3, paper_height_mm: 139.7,
      offset_x_mm: 2, offset_y_mm: 1, show_logo: false }), invoice(), null);
    expect(addPage.mock.calls[0]?.[0]).toEqual([241.3 * MM_TO_PT, 139.7 * MM_TO_PT]);
    const business = pages[0]!.drawText.mock.calls.find(([text]) => text === 'The Breakery');
    expect(business?.[1].x).toBeCloseTo(14 * MM_TO_PT, 8);
    expect(business?.[1].y).toBeCloseTo((139.7 - 13) * MM_TO_PT - 11, 8);
  });
  it('keeps every item when a short carbon form needs several pages', async () => {
    await render(context({ paper_width_mm: 241.3, paper_height_mm: 139.7, density: 'compact' }), invoice(80), null);
    expect(pages.length).toBeGreaterThan(1);
    for (let i = 0; i < 80; i++) expect(texts()).toContain(`PRODUCT-${i}`);
    expect(texts()).toContain(`Page 1 / ${pages.length}`);
    expect(texts()).toContain(`Page ${pages.length} / ${pages.length}`);
    for (const page of pages) for (const [, options] of page.drawText.mock.calls) {
      expect(options.y).toBeGreaterThanOrEqual(0);
      expect(options.y).toBeLessThanOrEqual(139.7 * MM_TO_PT);
    }
  });
  it('prints authoritative amounts without rounding to the nearest hundred', async () => {
    await render(context(), invoice(), null);
    expect(texts()).toContain('Rp 125');
    expect(texts()).toContain('Rp 1.450');
    expect(texts()).toContain('Rp 1.250');
    expect(texts()).not.toContain('Rp 1.500');
  });
  it('applies saved wording and visibility flags without changing totals', async () => {
    await render(context({ heading: 'COMMERCIAL INVOICE', business_name: 'Invoice business', contact_text: 'Invoice contact',
      payment_instructions: 'Reference INV-001', footer_message: 'Custom footer', show_unit_prices: false,
      show_due_date: false, show_logo: false }), invoice(), null);
    expect(texts()).toEqual(expect.arrayContaining(['COMMERCIAL INVOICE', 'Invoice business', 'Invoice contact', 'Reference INV-001', 'Custom footer', 'Rp 1.450']));
    expect(texts()).not.toContain('Unit price');
    expect(texts()).not.toContain('Rp 125');
    expect(texts().some((text) => text.startsWith('Due:'))).toBe(false);
  });
  it('wraps long wording and preserves unsupported Unicode as an explicit escape', async () => {
    const data = invoice();
    data.lines[0]!.name = '茶';
    await render(context({ footer_message: 'A footer sentence. '.repeat(20) }), data, null);
    expect(texts()).toContain('[U+8336]');
    expect(texts().filter((text) => text.includes('footer sentence')).length).toBeGreaterThan(1);
  });
  it('keeps the canonical business tax ID when optional contact text is hidden', async () => {
    const ctx = context({ show_contact: false });
    ctx.business.npwp = 'SAMPLE-TAX-ID';
    await render(ctx, invoice(), null);
    expect(texts()).toContain('NPWP: SAMPLE-TAX-ID');
    expect(texts()).not.toContain('Business address');
  });
  it('preserves multiline contact, notes and payment instructions without escaping line breaks', async () => {
    const data = invoice();
    data.invoice.notes = 'First note\r\nSecond note';
    await render(context({ contact_text: 'First contact\nSecond contact', payment_instructions: 'First instruction\rLast instruction' }), data, null);
    expect(texts()).toEqual(expect.arrayContaining(['First contact', 'Second contact', 'First note', 'Second note', 'First instruction', 'Last instruction']));
    expect(texts().some((text) => text.includes('[U+A]') || text.includes('[U+D]'))).toBe(false);
  });
  it('paginates all long header text on the smallest accepted paper', async () => {
    const contact = Array.from({ length: 60 }, (_, i) => `WORD${i}`).join(' ');
    const ctx = context({ paper_width_mm: 100, paper_height_mm: 100, margin_left_mm: 10,
      margin_right_mm: 10, margin_top_mm: 12.5, margin_bottom_mm: 12.5, contact_text: contact });
    ctx.business.npwp = 'SAMPLE-TAX-ID';
    await render(ctx, invoice(10), null);
    const printed = texts().join(' ');
    for (let i = 0; i < 60; i++) expect(printed).toContain(`WORD${i}`);
    for (let i = 0; i < 10; i++) expect(texts()).toContain(`PRODUCT-${i}`);
    expect(texts()).toContain('NPWP: SAMPLE-TAX-ID');
    for (const page of pages) for (const [, options] of page.drawText.mock.calls) {
      expect(options.y).toBeGreaterThanOrEqual(12.5 * MM_TO_PT);
      expect(options.y).toBeLessThanOrEqual(87.5 * MM_TO_PT);
    }
  });
});
