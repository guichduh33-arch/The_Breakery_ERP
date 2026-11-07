// Contrat de présentation uniquement ; les valeurs sont lues dans la table validée.
export interface InvoicePrintOptions {
  heading: string;
  business_name: string;
  contact_text: string;
  payment_instructions: string;
  footer_message: string;
  show_logo: boolean;
  show_contact: boolean;
  show_unit_prices: boolean;
  show_due_date: boolean;
  density: string;
  paper_width_mm: number;
  paper_height_mm: number;
  margin_left_mm: number;
  margin_right_mm: number;
  margin_top_mm: number;
  margin_bottom_mm: number;
  offset_x_mm: number;
  offset_y_mm: number;
}

export const DEFAULT_INVOICE_PRINT_OPTIONS: InvoicePrintOptions = {
  heading: 'INVOICE', business_name: '', contact_text: '', payment_instructions: '',
  footer_message: 'Thank you for choosing The Breakery.', show_logo: true, show_contact: true,
  show_unit_prices: true, show_due_date: true, density: 'comfortable',
  paper_width_mm: 210, paper_height_mm: 297, margin_left_mm: 12, margin_right_mm: 12,
  margin_top_mm: 12, margin_bottom_mm: 12, offset_x_mm: 0, offset_y_mm: 0,
};
