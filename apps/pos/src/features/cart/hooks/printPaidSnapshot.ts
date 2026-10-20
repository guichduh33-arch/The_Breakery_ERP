import type { QueryClient } from '@tanstack/react-query';
import { groupItemsByStation, type CartItem, type PrepStation, type StationTicketPayload } from '@breakery/domain';
import type { PaymentAttempt } from '@/stores/paymentAttempt';
import { runPrintJob } from '@/services/print/printJobs';
import { getKotCopies } from '@/features/settings/hooks/useKotCopies';
import { getStationMap } from './useStationMap';
import { getStationPrinters, type StationPrintersMap } from './useStationPrinters';
import type { StationFireResult } from './useFireToStations';

/** Paiement déjà confirmé : aucune lecture ou écriture du panier vivant. */
export async function printPaidSnapshot(snapshot: PaymentAttempt, orderNumber: string,
  printers: StationPrintersMap | undefined, qc: QueryClient, serverName: string, current: () => boolean): Promise<StationFireResult[]> {
  const items = snapshot.cart.items.filter((item) => !item.is_cancelled && !snapshot.context.printedItemIds.includes(item.id));
  const grouped = groupItemsByStation(items, await getStationMap(qc));
  const copies = await getKotCopies(qc);
  const resolvedPrinters = printers ?? await getStationPrinters(qc);
  const ticketItems = (lines: CartItem[]) => lines.map((item) => ({ name: item.name, quantity: item.quantity,
    modifiers: [...item.modifiers.map((m) => m.option_label), ...(item.combo_components ?? []).flatMap((c) =>
      [c.name ?? 'Component', ...(c.modifiers ?? []).map((m) => `${c.name ?? 'Component'}: ${m.option_label}`)])] }));
  async function print(role: PrepStation | 'waiter', lines: CartItem[], count: number) {
    if (count === 0) return { success: true };
    const id = `payment:${snapshot.context.idempotencyKey}:${role}`;
    const payload: StationTicketPayload = { kind: role === 'waiter' ? 'waiter' : 'prep', role,
      order_number: orderNumber, created_at: new Date().toISOString(), server_name: serverName, items: ticketItems(lines),
      ...(snapshot.cart.tableNumber ? { table_number: snapshot.cart.tableNumber } : {}) };
    return runPrintJob(payload, resolvedPrinters.get(role), count, undefined, id, current);
  }
  const results = await Promise.all((Object.entries(grouped) as [PrepStation, CartItem[]][]).map(async ([role, lines]) => {
    const result = await print(role, lines, copies[role] ?? 1);
    return { role, ok: result.success, ...(result.error ? { error: result.error } : {}), itemIds: lines.map((item) => item.id) };
  }));
  if (resolvedPrinters.has('waiter') && items.length > 0) await print('waiter', items, 1);
  return results;
}
