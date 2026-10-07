import type { PrinterTarget } from '@breakery/domain';
import { probeTcp } from '../scan.js';

export type RegisteredPrinter = PrinterTarget & { code?: string };

/** Sonde le port sans envoyer le moindre octet d'impression. */
export async function reachablePrinterCodes(
  printers: readonly RegisteredPrinter[],
  probe: typeof probeTcp = probeTcp,
  timeoutMs = 1_500,
): Promise<string[]> {
  const results = await Promise.all(printers.map(async (printer) => ({
    code: printer.code,
    latency: printer.code ? await probe(printer.ip_address, printer.port, timeoutMs) : null,
  })));
  return results.flatMap(({ code, latency }) => code && latency !== null ? [code] : []);
}
