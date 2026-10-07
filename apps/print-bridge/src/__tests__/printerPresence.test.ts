import { describe, expect, it, vi } from 'vitest';
import { reachablePrinterCodes } from '../hub/printerPresence.js';

describe('reachablePrinterCodes', () => {
  it('returns only registered printers whose TCP port answers', async () => {
    const probe = vi.fn((ip: string) => Promise.resolve(ip.endsWith('.8') ? 4 : null));
    await expect(reachablePrinterCodes([
      { code: 'PRN-CASHIER', ip_address: '192.168.1.8', port: 9100 },
      { code: 'PRN-BARISTA', ip_address: '192.168.1.32', port: 9100 },
      { ip_address: '192.168.1.13', port: 9100 },
    ], probe)).resolves.toEqual(['PRN-CASHIER']);
    expect(probe).toHaveBeenCalledTimes(2);
    expect(probe).toHaveBeenCalledWith('192.168.1.8', 9100, 1_500);
  });
});
