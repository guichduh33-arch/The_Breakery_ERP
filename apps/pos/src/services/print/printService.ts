// apps/pos/src/services/print/printService.ts
import type { PrinterTarget, ReceiptPayload, StationTicketPayload, PrintKind } from '@breakery/domain';
import { usePosSettingsStore } from '@/stores/posSettingsStore';

export type {
  PrinterTarget,
  StationTicketItem,
  StationTicketPayload,
  ReceiptPayload,
} from '@breakery/domain';

/**
 * Un printerUrl saisi sans schéma (« 192.168.40.66:3001 ») devenait une URL
 * RELATIVE pour fetch (404 vite) et une URL WebSocket invalide pour le hub —
 * double échec silencieux (vu en boutique, 2026-07-19). On normalise.
 */
function withHttpScheme(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `http://${url}`;
}

/**
 * Print-bridge base URL, resolved at CALL TIME (F-015) so a settings change
 * takes effect immediately without a reload.
 * Resolution order: store `printerUrl` override > VITE_PRINT_SERVER_URL > fallback.
 * Exported for the hub LAN client (spec 006x §4.1 — hub URL defaults to the
 * print-bridge origin, same process since lot 1).
 */
export function getPrintServerUrl(): string {
  const override = usePosSettingsStore.getState().printerUrl;
  if (override) return withHttpScheme(override);
  const env = import.meta.env.VITE_PRINT_SERVER_URL as string | undefined;
  return env !== undefined && env !== '' ? withHttpScheme(env) : 'http://localhost:3001';
}

// ---------------------------------------------------------------------------
// Mock buffer (used when VITE_PRINT_MOCK is truthy — tests / CI)
// ---------------------------------------------------------------------------

interface MockReceiptEntry {
  printer: PrinterTarget | null;
  kind: 'receipt';
  payload: ReceiptPayload;
}

interface MockStationEntry {
  printer: PrinterTarget;
  kind: PrintKind;
  payload: StationTicketPayload;
}

type MockBufferEntry = MockReceiptEntry | MockStationEntry;

let _mockBuffer: MockBufferEntry[] = [];

export function getMockPrintBuffer(): MockBufferEntry[] {
  return _mockBuffer;
}

export function clearMockPrintBuffer(): void {
  _mockBuffer = [];
}

export async function checkPrintServer(): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000);
  try {
    const res = await fetch(`${getPrintServerUrl()}/health`, { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Print a receipt to the cashier printer (or the default server if no printer
 * is provided). When `printer` is supplied it is included in the POST body so
 * the print server can route to the correct device. When absent the behaviour
 * is identical to before this change — no printer field is sent.
 */
export async function printReceipt(
  payload: ReceiptPayload,
  printer?: PrinterTarget,
): Promise<{ success: boolean; error?: string }> {
  // Mock mode: buffer the call, skip network
  if (import.meta.env.VITE_PRINT_MOCK) {
    _mockBuffer.push({ printer: printer ?? null, kind: 'receipt', payload });
    return { success: true };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const body = printer
      ? JSON.stringify({ ...payload, printer })
      : JSON.stringify(payload);
    const res = await fetch(`${getPrintServerUrl()}/print/receipt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: controller.signal,
    });
    if (!res.ok) {
      return { success: false, error: `HTTP ${res.status}` };
    }
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    return { success: false, error: message };
  } finally {
    clearTimeout(timeout);
  }
}

export async function openCashDrawer(): Promise<{ success: boolean; error?: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000);
  try {
    const res = await fetch(`${getPrintServerUrl()}/drawer/open`, {
      method: 'POST',
      signal: controller.signal,
    });
    if (!res.ok) {
      return { success: false, error: `HTTP ${res.status}` };
    }
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    return { success: false, error: message };
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// printStationTicket — send a ticket to a specific printer by IP/port
// ---------------------------------------------------------------------------

export async function printStationTicket(
  printer: PrinterTarget,
  payload: StationTicketPayload,
): Promise<{ success: boolean; error?: string }> {
  // Mock mode: buffer the call, skip network
  if (import.meta.env.VITE_PRINT_MOCK) {
    _mockBuffer.push({ printer, kind: payload.kind, payload });
    return { success: true };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${getPrintServerUrl()}/print/ticket`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ printer, ...payload }),
      signal: controller.signal,
    });
    if (!res.ok) {
      return { success: false, error: `HTTP ${res.status}` };
    }
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    return { success: false, error: message };
  } finally {
    clearTimeout(timeout);
  }
}
