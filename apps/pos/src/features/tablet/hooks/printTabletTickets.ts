import type { QueryClient } from '@tanstack/react-query';
import { groupItemsByStation, type TabletCart, type PrepStation } from '@breakery/domain';
import { getStationMap, STATION_MAP_KEY } from '@/features/cart/hooks/useStationMap';
import { getStationPrinters, STATION_PRINTERS_KEY, type StationPrintersMap, type StationPrinterInfo } from '@/features/cart/hooks/useStationPrinters';
import { getKotCopies, KOT_COPIES_KEY, type KotCopies } from '@/features/settings/hooks/useKotCopies';
import type { DispatchStation, PrinterRole } from '@breakery/domain';
import { runPrintJob } from '@/services/print/printJobs';

/** La commande est déjà durable. Un échec papier ne demande jamais sa ressaisie. */
export async function printTabletTickets(qc: QueryClient, cart: TabletCart, clientUuid: string,
  orderNumber: string, serverName: string, additional: boolean, offline = false,
  onFailure?: (reason: string) => void): Promise<boolean> {
  let stage = 'Kitchen routing unavailable';
  const failed = (reason: string) => { onFailure?.(reason); return false; };
  try {
    const stations = offline ? qc.getQueryData<Record<string, DispatchStation[]>>(STATION_MAP_KEY) : await getStationMap(qc, true);
    if (!stations) return failed(stage);
    const grouped = groupItemsByStation(cart.items, stations);
    const entries = Object.entries(grouped) as [PrepStation, typeof cart.items][];
    // Pas de fausse confirmation quand le routage est absent.
    if (!entries.length || cart.items.some((item) => !item.is_cancelled &&
      !entries.some(([, items]) => items.some((candidate) => candidate.id === item.id)))) return failed('Kitchen routing missing for saved order items');
    stage = 'Kitchen print configuration unavailable';
    const printers: StationPrintersMap = offline ? qc.getQueryData<StationPrintersMap>(STATION_PRINTERS_KEY) ?? new Map<PrinterRole, StationPrinterInfo>()
      : await getStationPrinters(qc).catch(() => new Map<PrinterRole, StationPrinterInfo>());
    const copies = offline ? qc.getQueryData<KotCopies>(KOT_COPIES_KEY) : await getKotCopies(qc);
    if (!copies) return failed(stage);
    stage = 'Kitchen ticket preparation failed';
    const results = await Promise.all(entries.map(async ([role, items]) => {
      if (copies[role] === 0) return true;
      const result = await runPrintJob({ kind: 'prep', role, order_number: orderNumber,
        ...(cart.tableNumber ? { table_number: cart.tableNumber } : {}),
        created_at: new Date().toISOString(), server_name: serverName,
        ...(additional ? { additional: true } : {}),
        items: items.map((item) => ({ name: item.name, quantity: item.quantity,
          ...(cart.notes ? { note: cart.notes } : {}),
          modifiers: [...item.modifiers.map((m) => m.option_label),
            ...(item.combo_components ?? []).flatMap((component) => [component.name ?? 'Component',
              ...(component.modifiers ?? []).map((m) => `${component.name ?? 'Component'}: ${m.option_label}`)])] })),
      }, printers.get(role), copies[role], undefined, `tablet:${clientUuid}:${role}`);
      return result.success;
    }));
    return results.every(Boolean) || failed('Check the saved print job in Printing');
  } catch { return failed(stage); }
}
