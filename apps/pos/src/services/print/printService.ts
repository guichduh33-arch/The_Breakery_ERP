// apps/pos/src/services/print/printService.ts
import type { PrintKind, PrinterRole } from '@breakery/domain';

const SERVER_URL = 'http://localhost:3001';

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
// Mock buffer (used when VITE_PRINT_MOCK is truthy — tests / CI)
// ---------------------------------------------------------------------------

let _mockBuffer: Array<{ printer: PrinterTarget; payload: StationTicketPayload }> = [];

export function getMockPrintBuffer(): Array<{ printer: PrinterTarget; payload: StationTicketPayload }> {
  return _mockBuffer;
}

export function clearMockPrintBuffer(): void {
  _mockBuffer = [];
}

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
  payment: { method: 'cash'; amount: number; cash_received: number; change_given: number };
  loyalty?: { points_earned: number; balance_after: number };
  footer?: string;
}

export async function checkPrintServer(): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000);
  try {
    const res = await fetch(`${SERVER_URL}/health`, { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export async function printReceipt(payload: ReceiptPayload): Promise<{ success: boolean; error?: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${SERVER_URL}/print/receipt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
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
    const res = await fetch(`${SERVER_URL}/drawer/open`, {
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
    _mockBuffer.push({ printer, payload });
    return { success: true };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${SERVER_URL}/print/ticket`, {
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
