// apps/print-bridge/src/config.ts
import type { PrinterTarget } from '@breakery/domain';

export interface BridgeConfig {
  port: number;
  /** Cible des reçus sans champ `printer` et du drawer kick (spec D6). null = non configurée. */
  receiptPrinter: PrinterTarget | null;
  /** Token partagé du bus LAN (spec 006x §6). null = pas de vérification (warning au boot). */
  hubToken: string | null;
  /** Fichier JSONL du ring-buffer du hub (spec 006x §4.2). */
  hubBufferFile: string;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): BridgeConfig {
  const port = Number(env.PORT);
  const rpPort = Number(env.RECEIPT_PRINTER_PORT);
  return {
    port: Number.isInteger(port) && port > 0 ? port : 3001,
    receiptPrinter: env.RECEIPT_PRINTER_IP
      ? { ip_address: env.RECEIPT_PRINTER_IP, port: Number.isInteger(rpPort) && rpPort > 0 ? rpPort : 9100 }
      : null,
    hubToken: env.HUB_TOKEN !== undefined && env.HUB_TOKEN.trim() !== '' ? env.HUB_TOKEN.trim() : null,
    hubBufferFile: env.HUB_BUFFER_FILE !== undefined && env.HUB_BUFFER_FILE.trim() !== ''
      ? env.HUB_BUFFER_FILE.trim()
      : 'hub-buffer.jsonl',
  };
}
