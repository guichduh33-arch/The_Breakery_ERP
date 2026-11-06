import { rgb, type PDFPage } from 'https://esm.sh/pdf-lib@1.17.1';
import type { LayoutContext } from '../pdf-layout.ts';
import type { InvoicePrintOptions } from '../invoice-print-options.ts';

export const MM_TO_PT = 72 / 25.4;

/** Flux paginé : aucune ligne de facture n'est coupée au bas d'une feuille. */
export class InvoiceCanvas {
  readonly pages: PDFPage[] = [];
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  readonly fontSize: number;
  readonly lineHeight: number;
  readonly width: number;
  readonly height: number;
  readonly printableWidth: number;
  y = 0;
  private page!: PDFPage;
  private bodyTop = 0;
  private compactHeader = false;
  private readonly characters: Set<number>;

  constructor(private ctx: LayoutContext, readonly options: InvoicePrintOptions, private invoiceNumber: string) {
    this.width = options.paper_width_mm * MM_TO_PT;
    this.height = options.paper_height_mm * MM_TO_PT;
    this.left = (options.margin_left_mm + options.offset_x_mm) * MM_TO_PT;
    this.right = this.width - (options.margin_right_mm - options.offset_x_mm) * MM_TO_PT;
    this.top = this.height - (options.margin_top_mm + options.offset_y_mm) * MM_TO_PT;
    this.bottom = (options.margin_bottom_mm - options.offset_y_mm) * MM_TO_PT + 16;
    this.printableWidth = this.right - this.left;
    this.fontSize = options.density === 'compact' ? 8 : 9;
    this.lineHeight = this.fontSize + 4;
    this.characters = new Set(ctx.font.getCharacterSet());
    this.newPage();
    // Un petit papier conserve tous les textes ; seuls les repères répétés
    // restent dans l'en-tête borné. Les détails coulent sur autant de pages que nécessaire.
    if (this.compactHeader) {
      this.paragraph(options.business_name || ctx.business.name, true);
      this.paragraph(options.heading, true);
      if (options.show_contact) this.paragraph(this.contact());
      if (ctx.business.npwp) this.paragraph(`NPWP: ${ctx.business.npwp}`);
      this.y -= 8;
    }
  }

  private safe(value: string) {
    return Array.from(value, (character) => {
      const code = character.codePointAt(0)!;
      return this.characters.has(code) ? character : `[U+${code.toString(16).toUpperCase()}]`;
    }).join('');
  }

  wrap(value: string, width: number, bold = false, size = this.fontSize): string[] {
    const font = bold ? this.ctx.fontBold : this.ctx.font;
    const result: string[] = [];
    for (const paragraph of value.split(/\r\n|\r|\n/).map((line) => this.safe(line))) {
      let line = '';
      for (const character of paragraph) {
        if (line && font.widthOfTextAtSize(line + character, size) > width) {
          const space = line.lastIndexOf(' ');
          if (space > 0) { result.push(line.slice(0, space)); line = line.slice(space + 1); }
          else { result.push(line); line = ''; }
        }
        line += character;
      }
      result.push(line.trimEnd());
    }
    return result;
  }

  private text(value: string, x: number, y: number, bold = false, size = this.fontSize, maxWidth?: number, alignRight = false) {
    const text = this.safe(value);
    const font = bold ? this.ctx.fontBold : this.ctx.font;
    const naturalWidth = font.widthOfTextAtSize(text, size);
    const fittedSize = maxWidth && naturalWidth > maxWidth ? size * maxWidth / naturalWidth : size;
    this.page.drawText(text, { x: alignRight ? x - font.widthOfTextAtSize(text, fittedSize) : x,
      y, size: fittedSize, font, color: rgb(0, 0, 0) });
  }

  private newPage() {
    this.page = this.ctx.doc.addPage([this.width, this.height]);
    this.pages.push(this.page);
    let businessX = this.left;
    if (this.options.show_logo && this.ctx.logo) {
      const factor = Math.min(25 / this.ctx.logo.height, this.printableWidth * .17 / this.ctx.logo.width);
      const width = this.ctx.logo.width * factor;
      this.page.drawImage(this.ctx.logo, { x: this.left, y: this.top - 25, width, height: this.ctx.logo.height * factor });
      businessX += width + 7;
    }
    const businessWidth = this.printableWidth * .55 - (businessX - this.left) - 10;
    const businessLines = this.wrap(this.options.business_name || this.ctx.business.name, businessWidth, true, 11);
    const contactLines = this.options.show_contact ? this.wrap(this.contact(), businessWidth, false, 8) : [];
    const taxLines = this.ctx.business.npwp ? this.wrap(`NPWP: ${this.ctx.business.npwp}`, businessWidth, false, 8) : [];
    const headingLines = this.wrap(this.options.heading, this.printableWidth * .4, true, 13);
    const headerHeight = Math.max(11 + businessLines.length * 14 + (contactLines.length + taxLines.length) * 11,
      29 + headingLines.length * 16, this.options.show_logo && this.ctx.logo ? 30 : 0) + 22;
    this.compactHeader = this.top - headerHeight - this.bottom < this.lineHeight * 3;
    if (this.compactHeader) {
      this.text(businessLines.join(' '), businessX, this.top - 11, true, 11, businessWidth);
      this.text(headingLines.join(' '), this.right, this.top - 12, true, 13, this.printableWidth * .4, true);
      this.text(this.invoiceNumber, this.right, this.top - 28, false, 8, this.printableWidth * .4, true);
      if (taxLines.length) this.text(taxLines.join(' '), this.left, this.top - 44, false, 8, this.printableWidth);
      this.y = this.top - 53;
      this.rule(); this.y -= 14; this.bodyTop = this.y;
      return;
    }
    let by = this.top - 11;
    for (const line of businessLines) {
      this.text(line, businessX, by, true, 11); by -= 14;
    }
    if (this.options.show_contact) {
      for (const line of contactLines) {
        this.text(line, businessX, by, false, 8); by -= 11;
      }
    }
    // L'identifiant fiscal reste canonique même lorsque les coordonnées sont masquées.
    if (this.ctx.business.npwp) {
      for (const line of taxLines) {
        this.text(line, businessX, by, false, 8); by -= 11;
      }
    }
    let hy = this.top - 12;
    for (const line of headingLines) {
      this.text(line, this.right, hy, true, 13, this.printableWidth * .4, true); hy -= 16;
    }
    this.text(this.invoiceNumber, this.right, hy - 2, false, 8, this.printableWidth * .4, true);
    this.y = Math.min(by, hy - 15, this.top - (this.options.show_logo && this.ctx.logo ? 30 : 0)) - 8;
    this.rule();
    this.y -= 14;
    this.bodyTop = this.y;
  }

  private contact(): string {
    return this.options.contact_text || [this.ctx.business.address, this.ctx.business.phone].filter(Boolean).join('\n');
  }

  ensure(height = this.lineHeight): boolean {
    if (this.y - height >= this.bottom) return false;
    this.newPage();
    return true;
  }

  rule() {
    this.page.drawLine({ start: { x: this.left, y: this.y }, end: { x: this.right, y: this.y }, thickness: .4, color: rgb(0, 0, 0) });
  }

  paragraph(value: string, bold = false, right = false) {
    for (const line of this.wrap(value, this.printableWidth, bold)) {
      this.ensure();
      this.text(line, right ? this.right : this.left, this.y, bold, this.fontSize, this.printableWidth, right);
      this.y -= this.lineHeight;
    }
  }

  metadata(left: string[], right: string[]) {
    const a = left.flatMap((line) => this.wrap(line, this.printableWidth * .52));
    const b = right.flatMap((line) => this.wrap(line, this.printableWidth * .44));
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      this.ensure();
      if (a[i]) this.text(a[i], this.left, this.y, i === 0);
      if (b[i]) this.text(b[i], this.right, this.y, false, this.fontSize, this.printableWidth * .44, true);
      this.y -= this.lineHeight;
    }
    this.y -= 10;
  }

  tableHeader() {
    this.ensure(this.lineHeight * 2);
    this.text('Item', this.left, this.y, true);
    this.text('Qty', this.left + this.printableWidth * (this.options.show_unit_prices ? .59 : .70), this.y, true, this.fontSize, undefined, true);
    if (this.options.show_unit_prices) this.text('Unit price', this.left + this.printableWidth * .78, this.y, true, this.fontSize, undefined, true);
    this.text('Total', this.right, this.y, true, this.fontSize, undefined, true);
    this.y -= 5; this.rule(); this.y -= this.lineHeight;
  }

  item(name: string, quantity: string, unit: string, total: string) {
    const names = this.wrap(name, this.printableWidth * (this.options.show_unit_prices ? .45 : .58));
    for (let i = 0; i < names.length; i++) {
      if (this.ensure()) this.tableHeader();
      this.text(names[i]!, this.left, this.y);
      if (i === 0) {
        this.text(quantity, this.left + this.printableWidth * (this.options.show_unit_prices ? .59 : .70), this.y, false, this.fontSize, this.printableWidth * .12, true);
        if (this.options.show_unit_prices) this.text(unit, this.left + this.printableWidth * .78, this.y, false, this.fontSize, this.printableWidth * .17, true);
        this.text(total, this.right, this.y, false, this.fontSize, this.printableWidth * .20, true);
      }
      this.y -= this.lineHeight;
    }
    this.y -= 3;
  }

  total(label: string, value: string, bold: boolean) {
    this.ensure(this.lineHeight);
    this.text(label, this.left + this.printableWidth * .50, this.y, bold, this.fontSize, this.printableWidth * .23);
    this.text(value, this.right, this.y, bold, this.fontSize, this.printableWidth * .24, true);
    this.y -= this.lineHeight;
  }

  finish() {
    const lines = this.wrap(this.options.footer_message, this.printableWidth, false, 8);
    const footerHeight = lines.length * 11;
    if (this.options.footer_message) {
      if (footerHeight <= this.bodyTop - this.bottom) {
        this.ensure(footerHeight);
        this.y = this.bottom + footerHeight;
        for (const line of lines) {
          const x = this.left + (this.printableWidth - this.ctx.font.widthOfTextAtSize(line, 8)) / 2;
          this.text(line, x, this.y, false, 8); this.y -= 11;
        }
      } else this.paragraph(this.options.footer_message);
    }
    for (let i = 0; i < this.pages.length; i++) {
      this.pages[i]!.drawText(`Page ${i + 1} / ${this.pages.length}`, { x: this.left,
        y: this.bottom - 12, size: 7, font: this.ctx.font, color: rgb(0, 0, 0) });
    }
  }
}
