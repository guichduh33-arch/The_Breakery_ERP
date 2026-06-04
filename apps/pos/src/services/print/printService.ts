// apps/pos/src/services/print/printService.ts
import type { PaymentMethod, PrintKind, PrinterRole } from '@breakery/domain';
import { usePosSettingsStore } from '@/stores/posSettingsStore';

/**
 * Print-bridge base URL, resolved at CALL TIME (F-015) so a settings change
 * takes effect immediately without a reload.
 * Resolution order: store `printerUrl` override > VITE_PRINT_SERVER_URL > fallback.
 */
function getServerUrl(): string {
  const override = usePosSettingsStore.getState().printerUrl;
  if (override) return override;
  return import.meta.env.VITE_PRINT_SERVER_URL ?? 'http://localhost:3001';
}

// ---------------------------------------------------------------------------
// Station ticket types
// ---------------------------------------------------------------------------

export interface PrinterTarget {
  ip_address: string;
  port: number;
}

export interface StationTicketItem {
  name: string;
  quantity: number;
  modifiers?: string[];
  note?: string;
}

export interface StationTicketPayload {
  kind: PrintKind;
  role: PrinterRole;
  order_number: string;
  table_number?: string;
  created_at: string; // ISO
  server_name: string;
  items: StationTicketItem[];
  totals?: { subtotal: number; tax: number; total: number }; // bill + receipt
  payment?: { method: string; amount: number; change_given: number }; // receipt only
}

// ---------------------------------------------------------------------------
// Receipt payload
// ---------------------------------------------------------------------------

export interface ReceiptPayload {
  business: { name: string; address: string; phone?: string; tax_id?: string };
  order: {
    order_number: string;
    created_at: string;
    cashier_name: string;
    order_type: 'dine_in' | 'take_out';
  };
  customer?: { name: string; loyalty_tier?: string };
  items: {
    name: string;
    quantity: number;
    unit_price: number;
    modifiers?: { label: string; price_adjustment: number }[];
    line_total: number;
  }[];
  totals: {
    items_total: number;
    redemption_amount: number;
    total: number;
    tax_amount: number;
  };
  payment: { method: PaymentMethod; amount: number; cash_received?: number; change_given?: number };
  loyalty?: { points_earned: number; balance_after: number };
  footer?: string;
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

let _mockBuffer: Array<MockBufferEntry> = [];

export function getMockPrintBuffer(): Array<MockBufferEntry> {
  return _mockBuffer;
}

export function clearMockPrintBuffer(): void {
  _mockBuffer = [];
}

export async function checkPrintServer(): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000);
  try {
    const res = await fetch(`${getServerUrl()}/health`, { signal: controller.signal });
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
    const res = await fetch(`${getServerUrl()}/print/receipt`, {
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
    const res = await fetch(`${getServerUrl()}/drawer/open`, {
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
    const res = await fetch(`${getServerUrl()}/print/ticket`, {
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
