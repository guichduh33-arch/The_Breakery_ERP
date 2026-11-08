// ADR-037 : réception à crédit sans facture ; réception cash avec pièce privée.
// Chaque scénario crée son propre PO DEV via l'interface. Aucun solde, compte,
// permission ou fonds n'est créé par la spec ; les écritures métier restent en DEV.
// Sélecteurs issus de POFormDraft, PurchaseOrderDetailPage, ReceiveDialog et
// PoInvoiceUploader. Aucun contournement du bouton cash désactivé sans facture.

import { readFile } from 'node:fs/promises';
import { test, expect, type Page, type Response } from '@playwright/test';
import { openBackofficeSession } from './fixtures/auth';

test.use({ baseURL: process.env.E2E_BO_URL, acceptDownloads: true });

const DEV_URL = 'https://ikcyvlovptebroadgtvd.supabase.co';
const ADMIN_PIN = process.env.E2E_PIN_ADMIN ?? '424242';
const INVOICE_REQUIRED = 'Attach a JPEG or PDF invoice before recording payment.';

// PDF déterministe complet : objets, flux, offsets xref et catalogue cohérents.
// Il ne contient que du texte de test synthétique, aucune facture réelle.
function invoicePdf(): Buffer {
  const stream = 'BT /F1 12 Tf 20 100 Td (DEV E2E supplier invoice) Tj ET\n';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 240 160] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,
  ];
  let document = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(document));
    document += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(document);
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  document += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  document += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(document);
}

function isPoRpc(response: Response, family: string, poId: string): boolean {
  const url = new URL(response.url());
  if (url.origin !== DEV_URL || url.pathname !== `/rest/v1/rpc/${family}`
    || response.request().method() !== 'POST') return false;
  const body: unknown = response.request().postDataJSON();
  return typeof body === 'object' && body !== null && 'p_po_id' in body && body.p_po_id === poId;
}

async function createPo(page: Page, paymentTerms: 'cash' | 'credit'): Promise<string> {
  await page.goto('/backoffice/purchasing/purchase-orders/new');
  await expect(page.getByRole('heading', { name: 'New Purchase Order', exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByLabel('Supplier', { exact: true }).selectOption({ index: 1 });
  await page.getByLabel('Payment terms', { exact: true }).selectOption(paymentTerms);
  await page.getByLabel('Product for line 1', { exact: true }).selectOption({ label: 'Agar-Agar (CON-002)' });
  await page.getByLabel('Quantity for line 1', { exact: true }).fill(paymentTerms === 'credit' ? '5' : '1');
  // La fixture doit avoir un coût réel positif ; ne pas fabriquer un financement.
  expect(Number(await page.getByLabel('Unit cost for line 1', { exact: true }).inputValue())).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Create purchase order', exact: true }).click();
  await expect(page).toHaveURL(/\/purchasing\/purchase-orders\/[0-9a-f-]{36}$/, { timeout: 25_000 });
  const poId = new URL(page.url()).pathname.split('/').pop();
  if (!poId) throw new Error('The created purchase order has no ID.');
  await expect(page.locator('[data-status="pending"]')).toBeVisible({ timeout: 15_000 });
  return poId;
}

async function receivePo(page: Page, poId: string): Promise<void> {
  await page.getByRole('button', { name: 'Receive', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Receive goods' });
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  const confirm = dialog.getByRole('button', { name: 'Confirm receipt', exact: true });
  await expect(confirm).toBeEnabled();
  const [response] = await Promise.all([
    page.waitForResponse(res => isPoRpc(res, 'receive_purchase_order_v5', poId), { timeout: 30_000 }),
    confirm.click(),
  ]);
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ status: 'received', idempotent_replay: false });
  await expect(page.locator('[data-status="received"]')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/je_unbalanced|trigger_failed/i)).not.toBeVisible();
}

test.describe('PO invoice requirements on dev V3', () => {
  test.beforeEach(async ({ page }) => {
    // Échouer AVANT la connexion et toute écriture si la cible n'est pas DEV.
    expect(process.env.VITE_SUPABASE_URL, 'Purchase invoice E2E requires the exact dev V3 target.').toBe(DEV_URL);
    // La configuration déclarée ne suffit pas si un bundle chargé vise une autre base.
    await page.route('https://*.supabase.co/**', async route => {
      if (new URL(route.request().url()).origin !== DEV_URL) {
        await route.abort('blockedbyclient');
        throw new Error('The loaded application requested a Supabase target other than dev V3.');
      }
      await route.continue();
    });
  });

  test('credit PO receives without an invoice and remains unpaid', async ({ page }) => {
    test.setTimeout(120_000);
    await openBackofficeSession(page, { pin: ADMIN_PIN });
    const poId = await createPo(page, 'credit');
    await expect(page.getByText('No invoice attached.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Record payment', exact: true })).toBeDisabled();
    await receivePo(page, poId);
    const paymentsResponse = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.origin === DEV_URL && url.pathname === '/rest/v1/purchase_payments'
        && url.searchParams.get('purchase_order_id') === `eq.${poId}`
        && response.request().method() === 'GET';
    }, { timeout: 30_000 });
    await page.reload();
    const payments = await paymentsResponse;
    expect(payments.status()).toBe(200);
    expect(await payments.json()).toEqual([]);
    await expect(page.locator('[data-status="received"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('UNPAID', { exact: true })).toBeVisible();
    await expect(page.getByText('No invoice attached.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Download invoice', exact: true })).toHaveCount(0);
  });

  test('cash PO requires a PDF, receives, downloads identical bytes and locks the paid invoice', async ({ page }) => {
    test.setTimeout(180_000);
    await openBackofficeSession(page, { pin: ADMIN_PIN });
    const poId = await createPo(page, 'cash');
    const receive = page.getByRole('button', { name: 'Receive', exact: true });
    await expect(page.getByText('No invoice attached.', { exact: true })).toBeVisible();
    await expect(receive).toBeDisabled();
    await expect(receive).toHaveAttribute('title', INVOICE_REQUIRED);
    await expect(page.getByRole('dialog', { name: 'Receive goods' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Record payment', exact: true })).toBeDisabled();

    const invoice = invoicePdf();
    const input = page.getByLabel('Invoice file', { exact: true });
    await expect(input).toBeEnabled({ timeout: 20_000 });
    await input.setInputFiles({ name: 'dev-e2e-invoice.pdf', mimeType: 'application/pdf', buffer: invoice });
    await expect(page.getByText('Invoice change confirmed.', { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Download invoice', exact: true })).toBeEnabled();
    await expect(receive).toBeEnabled();
    await receivePo(page, poId);

    // Recharger les paiements et l'éligibilité depuis le serveur après l'auto-paiement cash.
    const accessResponse = page.waitForResponse(res => isPoRpc(res, 'can_upload_po_invoice_v2', poId), { timeout: 30_000 });
    await page.reload();
    const access = await accessResponse;
    expect(access.status()).toBe(200);
    expect(await access.json()).toBe(false);
    await expect(page.getByText('PAID', { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByLabel('Invoice file', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Remove invoice', exact: true })).toHaveCount(0);

    const [download, response] = await Promise.all([
      page.waitForEvent('download', { timeout: 30_000 }),
      page.waitForResponse(res => res.url() === `${DEV_URL}/functions/v1/download-po-invoice`
        && res.request().method() === 'POST', { timeout: 30_000 }),
      page.getByRole('button', { name: 'Download invoice', exact: true }).click(),
    ]);
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toContain('no-store');
    expect(await response.body()).toEqual(invoice);
    expect(await download.failure()).toBeNull();
    expect(download.suggestedFilename()).toMatch(/\.pdf$/);
    const downloadedPath = await download.path();
    if (!downloadedPath) throw new Error('The invoice download was not saved.');
    expect(await readFile(downloadedPath)).toEqual(invoice);
  });
});
