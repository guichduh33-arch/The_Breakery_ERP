import { test, expect, type Page } from '@playwright/test';
import { openPosSession, loginPOS } from './fixtures/auth';

const sizes = [{ width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1024, height: 768 }, { width: 1280, height: 800 }];
async function fitsViewport(page: Page) {
  const bounds = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight }));
  expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.width);
  expect(bounds.scrollHeight).toBeLessThanOrEqual(bounds.height);
}

test('POS, payment and local display remain usable at all four target sizes', async ({ page }, info) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openPosSession(page);
  for (const size of sizes) {
    await page.setViewportSize(size);
    const checkout = page.getByTestId('checkout-cta');
    await expect(checkout).toBeInViewport();
    await expect(page.getByRole('button', { name: 'Hold', exact: true })).toBeInViewport();
    await fitsViewport(page);
    await page.screenshot({ path: info.outputPath(`pos-${size.width}.png`) });
    if (size.width < 1100) await expect(page.getByRole('button', { name: /view order/i })).toBeInViewport();
  }
  await page.getByRole('button', { name: 'Coffee', exact: true }).click();
  await page.getByRole('button', { name: /^Americano\b/ }).first().click();
  await page.getByTestId('modifier-add-to-cart').click({ timeout: 8_000 }).catch(() => {});
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Open menu', exact: true }).click();
  const [display] = await Promise.all([
    page.waitForEvent('popup'),
    page.getByRole('button', { name: /customer display/i }).click(),
  ]);
  await expect(display.getByText('Americano', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('checkout-cta').click();
  for (const size of sizes) {
    await page.setViewportSize(size);
    const process = page.getByRole('button', { name: 'Process Payment', exact: true });
    await expect(process).toBeInViewport();
    const box = await process.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(56);
    await fitsViewport(page);
    const keypad = page.getByRole('group', { name: 'Numpad', exact: true });
    const digit = keypad.getByRole('button', { name: '1', exact: true });
    await digit.scrollIntoViewIfNeeded();
    await digit.click();
    const backspace = keypad.getByRole('button', { name: 'Backspace', exact: true });
    await backspace.click();
    expect((await backspace.boundingBox())?.height).toBeGreaterThanOrEqual(80);
    await expect(process).toBeInViewport();
    await page.screenshot({ path: info.outputPath(`payment-${size.width}.png`) });
  }
  await page.getByRole('button', { name: 'Back to Cart', exact: true }).click();
  expect(errors).toEqual([]);
  await page.close();
  await expect(display.getByText(/connection to checkout lost/i)).toBeVisible({ timeout: 12_000 });
  await display.close();
});

test('waiter and KDS layouts fit their viewports', async ({ page }, info) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // The seeded owner has sales.create; the seeded cashier is intentionally denied tablet access.
  await loginPOS(page, process.env.E2E_PIN_ADMIN ?? '424242', 'E2E Owner');
  await page.goto('/tablet/order');
  await page.getByRole('button', { name: /^Table .*, Available/ }).first().click();
  await expect(page.getByRole('button', { name: /^Americano\b/ }).first()).toBeAttached({ timeout: 20_000 });
  for (const size of sizes) {
    await page.setViewportSize(size);
    const send = page.getByTestId(size.width < 1100 ? 'tablet-order-send-compact' : 'tablet-order-send');
    await expect(send).toBeInViewport({ timeout: 20_000 });
    await fitsViewport(page);
    await page.screenshot({ path: info.outputPath(`tablet-${size.width}.png`) });
  }
  await page.goto('/kds');
  await expect(page.getByText(/kitchen|bar|no orders/i).first()).toBeVisible({ timeout: 20_000 });
  await page.setViewportSize({ width: 1280, height: 800 });
  await fitsViewport(page);
  await page.screenshot({ path: info.outputPath('kds-1280.png') });
  expect(errors).toEqual([]);
});
