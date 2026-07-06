// apps/print-bridge/src/config.ts
import type { PrinterTarget } from '@breakery/domain';

export interface BridgeConfig {
  port: number;
  /** Cible des reçus sans champ `printer` et du drawer kick (spec D6). null = non configurée. */
  receiptPrinter: PrinterTarget | null;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): BridgeConfig {
  const port = Number(env.PORT);
  const rpPort = Number(env.RECEIPT_PRINTER_PORT);
  return {
    port: Number.isInteger(port) && port > 0 ? port : 3001,
    receiptPrinter: env.RECEIPT_PRINTER_IP
      ? { ip_address: env.RECEIPT_PRINTER_IP, port: Number.isInteger(rpPort) && rpPort > 0 ? rpPort : 9100 }
      : null,
  };
}
