import { beforeEach, expect, it, vi } from 'vitest';
import type { ReceiptPayload } from '@breakery/domain';
import { runReceiptJob, useReceiptJobs } from '../receiptJobs';
const send = vi.hoisted(() => vi.fn<(payload: ReceiptPayload) => Promise<{ success: boolean; error?: string }>>());
vi.mock('../printService', () => ({ printReceipt: send }));
const receipt: ReceiptPayload = { business: { name: 'Test', address: '' }, order: { id: 'uuid-1', order_number: 'P-001', created_at: '2026-09-10T00:00:00Z', cashier_name: 'Cashier', order_type: 'take_out' }, items: [{ name: 'Coffee', quantity: 1, unit_price: 10000, line_total: 10000 }], totals: { items_total: 10000, redemption_amount: 0, tax_amount: 0, total: 10000 }, payment: { method: 'cash', amount: 10000 } };
beforeEach(() => { useReceiptJobs.setState({ jobs: [] }); send.mockReset().mockResolvedValue({ success: true }); });
it('keeps distinct orders whose daily business numbers repeat', async () => {
  await runReceiptJob(receipt);
  await runReceiptJob({ ...receipt, order: { ...receipt.order, id: 'uuid-2' }, items: [{ ...receipt.items[0]!, name: 'Bread' }] });
  expect(useReceiptJobs.getState().jobs).toHaveLength(2);
  expect(send.mock.calls[1]?.[0].items[0]?.name).toBe('Bread');
  expect(send.mock.calls[1]?.[0].template).toBeUndefined();
});
it('persists an unconfirmed receipt and retries the original composition as a duplicate', async () => {
  send.mockResolvedValueOnce({ success: false, error: 'paper_out' });
  await runReceiptJob(receipt);
  expect(useReceiptJobs.getState().jobs[0]?.status).toBe('unknown');
  await runReceiptJob({ ...receipt, items: [] });
  expect(send.mock.calls[1]?.[0].items).toEqual(receipt.items);
  expect(send.mock.calls[1]?.[0].template?.header).toContain('DUPLICATE');
  expect(useReceiptJobs.getState().jobs[0]?.status).toBe('confirmed');
});
