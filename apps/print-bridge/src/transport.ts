// Seul module qui touche node-thermal-printer. Timeout TCP 5 s.
//
// Import : node-thermal-printer v4.6.0 est un paquet CommonJS (pas de "type":
// "module", pas de champ "exports" dans son package.json) dont le .d.ts colocalisé
// (node-thermal-printer.d.ts) déclare `ThermalPrinter`/`PrinterTypes` comme named
// exports (en plus des alias historiques `printer`/`types`). Le runtime
// (lib/core.js) fait `module.exports = { ThermalPrinter, PrinterTypes, ... }` —
// un objet littéral statique que cjs-module-lexer sait exposer comme named exports
// ESM. Le named import ci-dessous typecheck ET s'exécute correctement sous
// NodeNext ; pas besoin du cast namespace de repli.
import { ThermalPrinter, PrinterTypes } from 'node-thermal-printer';
import type { PrinterTarget } from '@breakery/domain';
import type { PrinterLike } from './render/printerLike.js';

type ExecutablePrinter = PrinterLike & {
  execute(): Promise<unknown>;
  openCashDrawer(): void;
};

function makePrinter(target: PrinterTarget): ExecutablePrinter {
  return new ThermalPrinter({
    type: PrinterTypes.EPSON,
    interface: `tcp://${target.ip_address}:${target.port}`,
    options: { timeout: 5000 },
  });
}

export async function sendToPrinter(
  target: PrinterTarget,
  render: (p: PrinterLike) => void,
): Promise<void> {
  const printer = makePrinter(target);
  render(printer);
  await printer.execute();
}

export async function kickDrawer(target: PrinterTarget): Promise<void> {
  const printer = makePrinter(target);
  printer.openCashDrawer();
  await printer.execute();
}
