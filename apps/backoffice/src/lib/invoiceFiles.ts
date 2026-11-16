export const INVOICE_ACCEPT = 'image/jpeg,application/pdf';
export const INVOICE_MAX_SIZE = 5 * 1024 * 1024;
export type InvoiceMime = 'image/jpeg' | 'application/pdf';

export function validateInvoiceFile(file: File): asserts file is File & { type: InvoiceMime } {
  if (file.type !== 'image/jpeg' && file.type !== 'application/pdf') throw new Error('Choose a JPEG or PDF invoice.');
  if (file.size === 0) throw new Error('The invoice file is empty.');
  if (file.size > INVOICE_MAX_SIZE) throw new Error('Invoice is too large (max 5 MB).');
}

export async function invoiceFileDigest(file: File): Promise<string> {
  validateInvoiceFile(file);
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

/** Le serveur confirme aussi l'existence et les métadonnées de l'objet privé. */
export function isInvoicePath(path: string | null | undefined, prefix: string): boolean {
  return typeof path === 'string' && path.startsWith(prefix) && /\.(jpe?g|pdf)$/.test(path);
}

export const INVOICE_PAYMENT_MESSAGE = 'Attach a JPEG or PDF invoice before recording payment.';
export const INVOICE_APPROVAL_MESSAGE = 'Attach a JPEG or PDF invoice before validating this cash expense.';

export function invoiceErrorMessage(message: string): string {
  if (message.includes('invoice_required_before_approval')) return INVOICE_APPROVAL_MESSAGE;
  if (message.includes('invoice_required_before_payment')) return INVOICE_PAYMENT_MESSAGE;
  return message;
}
