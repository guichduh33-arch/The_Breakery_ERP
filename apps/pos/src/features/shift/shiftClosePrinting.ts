import type { QueryClient } from '@tanstack/react-query';
import type { StationTicketPayload } from '@breakery/domain';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { getStationPrinters } from '@/features/cart/hooks/useStationPrinters';
import { runPrintJob } from '@/services/print/printJobs';

const LAST_REPORT = 'breakery.last-shift-report.v1';
export function rememberClosedShift(sessionId: string) {
  localStorage.setItem(LAST_REPORT, JSON.stringify({ sessionId, actor: useAuthStore.getState().user?.id }));
}
export function lastClosedShift(actor: string | undefined): string | null {
  try {
    const saved = JSON.parse(localStorage.getItem(LAST_REPORT) ?? 'null') as { sessionId: string; actor: string } | null;
    return saved?.actor === actor && typeof saved?.sessionId === 'string' ? saved.sessionId : null;
  } catch { return null; }
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid saved shift report');
  return value as Record<string, unknown>;
}
export function buildShiftCloseTicket(value: unknown, cashier: string): StationTicketPayload {
  const report = object(value);
  if (typeof report.shift_id !== 'string' || typeof report.closed_at !== 'string'
    || !Number.isFinite(Date.parse(report.closed_at))) throw new Error('Invalid saved shift report');
  const methods = object(report.totals_by_payment_method);
  function amount(source: Record<string, unknown>, key: string) {
    const n = Number(source[key] ?? 0);
    if (!Number.isFinite(n)) throw new Error('Invalid saved shift amount');
    return n;
  }
  const lines = [
    ['Opening cash', amount(report, 'opening_cash')],
    ...Object.entries(methods).map(([method, n]) => [method.toUpperCase(), amount({ n }, 'n')]),
    ['Payments received', amount(report, 'receipts_total')],
    ['Outstanding collected', amount(report, 'outstanding_collections_total')],
    ['New outstanding', amount(report, 'outstanding_created_total')],
    ['Refunds', amount(report, 'refunds_total')],
    ['Cash in', amount(report, 'cash_in_total')], ['Cash out', amount(report, 'cash_out_total')],
    ['Expected cash', amount(report, 'closing_cash_expected')], ['Counted cash', amount(report, 'closing_cash_counted')],
    ['Cash variance', amount(report, 'cash_variance')],
  ] as [string, number][];
  return { kind: 'shift_close', role: 'cashier', order_number: report.shift_id, created_at: report.closed_at,
    server_name: cashier,
    // Les anciens bridges rendent items : garder un rapport lisible pendant la mise à jour.
    items: [{ name: 'SHIFT CLOSING REPORT', quantity: 1 }, ...lines.map(([label, n]) => ({
      name: `${label}: ${Math.round(n).toLocaleString('id-ID')}`, quantity: 1,
    }))],
    report_lines: lines.map(([label, n]) => ({ label, amount: n })) };
}
export async function printClosedShift(sessionId: string, qc: QueryClient, manual = false) {
  const actor = useAuthStore.getState().user;
  if (!actor) throw new Error('Sign in before printing a closing report');
  const current = () => useAuthStore.getState().user?.id === actor.id && !useAuthStore.getState().isLocked;
  const { data, error } = await supabase.rpc('get_shift_close_print_v1', { p_session_id: sessionId });
  if (error) throw new Error(error.message);
  if (!current()) throw new Error('Your session changed — reopen the closing report');
  const payload = buildShiftCloseTicket(data, actor.full_name);
  const id = `shift-close:${sessionId}`;
  let printer;
  try { printer = (await getStationPrinters(qc)).get('cashier'); } catch { /* conserver le job pour la reprise */ }
  return runPrintJob(payload, printer, 1, undefined, id, current, manual);
}
