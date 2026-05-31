// packages/domain/src/printing/types.ts
//
// Session 34 — station ticket printing.
// Reuses the canonical `DispatchStation` from ../kitchen/types (kitchen|barista|bakery|none),
// which mirrors the DB CHECK categories_dispatch_station_check.
//   - PrepStation : where an ITEM is produced → prep ticket printer (excludes 'none').
//     'bakery' is surfaced in the UI as "Display".
//   - PrinterRole : every physical printer role (lan_devices.capabilities.station),
//     adding the two DOCUMENT printers 'cashier' (receipt + bill) and 'waiter' (bill).

import type { DispatchStation } from '../kitchen/types.js';

/** Item-routing destinations (prep ticket printers) — excludes 'none'. */
export type PrepStation = Exclude<DispatchStation, 'none'>;

/** Every printer role tag (lan_devices.capabilities.station). */
export type PrinterRole = PrepStation | 'cashier' | 'waiter';

/** Document kinds the print bridge understands. */
export type PrintKind = 'prep' | 'bill' | 'receipt';
