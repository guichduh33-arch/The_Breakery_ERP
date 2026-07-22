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
  /** URL de l'EF lan-heartbeat-batch (spec 006x lot 2). null = pas de push cloud. */
  hubCloudUrl: string | null;
  /** Secret partagé avec l'EF (== LAN_HEARTBEAT_SECRET côté EF). */
  hubCloudSecret: string | null;
  /** Dossier dist de la SPA POS servie en LAN (spec 006x §4.1, décision
   *  2026-07-22 : SPA servies depuis le hub — plus de mixed-content HTTPS→ws).
   *  null = pas de service statique (comportement historique). */
  posDistDir: string | null;
}

function trimmedOrNull(value: string | undefined): string | null {
  return value !== undefined && value.trim() !== '' ? value.trim() : null;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): BridgeConfig {
  const port = Number(env.PORT);
  const rpPort = Number(env.RECEIPT_PRINTER_PORT);
  return {
    port: Number.isInteger(port) && port > 0 ? port : 3001,
    receiptPrinter: env.RECEIPT_PRINTER_IP
      ? { ip_address: env.RECEIPT_PRINTER_IP, port: Number.isInteger(rpPort) && rpPort > 0 ? rpPort : 9100 }
      : null,
    hubToken: trimmedOrNull(env.HUB_TOKEN),
    hubBufferFile: trimmedOrNull(env.HUB_BUFFER_FILE) ?? 'hub-buffer.jsonl',
    hubCloudUrl: trimmedOrNull(env.HUB_CLOUD_URL),
    hubCloudSecret: trimmedOrNull(env.HUB_CLOUD_SECRET),
    posDistDir: trimmedOrNull(env.POS_DIST_DIR),
  };
}
