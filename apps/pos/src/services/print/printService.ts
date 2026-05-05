// apps/pos/src/services/print/printService.ts
const SERVER_URL = 'http://localhost:3001';

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
