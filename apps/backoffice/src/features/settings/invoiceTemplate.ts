import type { Database } from '@breakery/supabase';

export type InvoicePrintTemplate = Database['public']['Tables']['invoice_print_templates']['Row'];
export type InvoiceTemplateSettings = Omit<InvoicePrintTemplate, 'id' | 'revision' | 'updated_at' | 'updated_by'>;

export function templateSettings(row: InvoicePrintTemplate): InvoiceTemplateSettings {
  return {
    heading: row.heading, business_name: row.business_name, contact_text: row.contact_text,
    payment_instructions: row.payment_instructions, footer_message: row.footer_message,
    show_logo: row.show_logo, show_contact: row.show_contact, show_unit_prices: row.show_unit_prices,
    show_due_date: row.show_due_date, density: row.density, paper_width_mm: row.paper_width_mm,
    paper_height_mm: row.paper_height_mm, margin_left_mm: row.margin_left_mm,
    margin_right_mm: row.margin_right_mm, margin_top_mm: row.margin_top_mm,
    margin_bottom_mm: row.margin_bottom_mm, offset_x_mm: row.offset_x_mm, offset_y_mm: row.offset_y_mm,
  };
}

export const PAPER_PRESETS = [
  { value: 'a4', label: 'A4 — 210 × 297 mm', width: 210, height: 297 },
  { value: 'continuous', label: 'Continuous — 9.5 × 11 in', width: 241.3, height: 279.4 },
  { value: 'continuous-half', label: 'Continuous half — 9.5 × 5.5 in', width: 241.3, height: 139.7 },
] as const;

export function invoiceTemplateError(value: InvoiceTemplateSettings): string | null {
  const numbers = [value.paper_width_mm, value.paper_height_mm, value.margin_left_mm,
    value.margin_right_mm, value.margin_top_mm, value.margin_bottom_mm, value.offset_x_mm, value.offset_y_mm];
  if (numbers.some((number) => !Number.isFinite(number))) return 'Enter all paper dimensions in millimetres.';
  if (value.paper_width_mm < 100 || value.paper_width_mm > 420
    || value.paper_height_mm < 100 || value.paper_height_mm > 594) return 'Paper width must be 100–420 mm and height 100–594 mm.';
  if ([value.margin_left_mm, value.margin_right_mm, value.margin_top_mm, value.margin_bottom_mm]
    .some((number) => number < 0 || number > 50)) return 'Margins must be between 0 and 50 mm.';
  if (Math.abs(value.offset_x_mm) > 20 || Math.abs(value.offset_y_mm) > 20) return 'Print offsets must be between −20 and 20 mm.';
  if (value.paper_width_mm - value.margin_left_mm - value.margin_right_mm < 80
    || value.paper_height_mm - value.margin_top_mm - value.margin_bottom_mm < 75) return 'The printable area must be at least 80 × 75 mm.';
  if (value.margin_left_mm + value.offset_x_mm < 0 || value.margin_right_mm - value.offset_x_mm < 0
    || value.margin_top_mm + value.offset_y_mm < 0 || value.margin_bottom_mm - value.offset_y_mm < 0) return 'The print offset moves content outside the paper. Increase the margin or reduce the offset.';
  if (!value.heading.trim() || value.heading.length > 60) return 'Enter an invoice heading of 1–60 characters.';
  if (value.business_name.length > 100 || value.contact_text.length > 500
    || value.payment_instructions.length > 1000 || value.footer_message.length > 500) return 'A template text exceeds its character limit.';
  return null;
}
