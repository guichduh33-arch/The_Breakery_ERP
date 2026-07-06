# Print-bridge versionné + scan réseau + CRUD LAN Devices — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Versionner un print-bridge Node/Express propre dans le monorepo (contrat V2 conservé + endpoints de scan TCP 9100), et donner à la page BO LAN Devices un CRUD complet + un panneau de scan réseau.

**Architecture:** `apps/print-bridge` = traducteur HTTP→ESC/POS sans état (Express + node-thermal-printer, types payloads depuis `@breakery/domain`, DI pour la testabilité). Côté BO, la page LAN Devices existante gagne un form modal CRUD (writes directs sous la RLS `lan.devices.manage` de S13) et un ScanPanel qui appelle le bridge. **Zéro migration DB, money-path intouchée, POS inchangé (types-only re-export).**

**Tech Stack:** Node 22 / Express 4 / node-thermal-printer / tsup / vitest+supertest (bridge) · React + TanStack Query + zustand + @breakery/ui (BO) · pgTAP via MCP (ancre RLS).

**Spec:** `docs/superpowers/specs/2026-07-06-print-bridge-scan-lan-devices-crud-design.md`

## Global Constraints

- pnpm 9.15 + turbo, Node >= 22.12 — jamais `npm`.
- Fichiers < 500 lignes ; splitter par responsabilité.
- **Aucune migration DB** dans ce plan → pas de regen types. La seule action DB est la SUITE pgTAP (lecture/rollback).
- **Subagents ne peuvent PAS appeler le MCP Supabase** : la suite pgTAP (Task 16) est *écrite* par l'exécutant mais *exécutée par le contrôleur* via `mcp__plugin_supabase_supabase__execute_sql` (projet `ikcyvlovptebroadgtvd`).
- BO : imports internes avec suffixe `.js` (`@/features/....js`) ; UI copy en anglais (comme la page existante) ; primitives `@breakery/ui` (pas de Select exporté → `<select>` natif) ; toasts via `sonner` ; gates via `useAuthStore((s) => s.hasPermission(...))`.
- Bridge : ne touche NI Supabase NI React ; payloads typés depuis `@breakery/domain` (IO-free, on n'y ajoute que des types).
- Contrat HTTP consommé par `apps/pos/src/services/print/printService.ts` conservé octet pour octet (mêmes paths, mêmes bodies, `res.ok` = succès).
- Anti-SSRF : scan/probe refusent toute IP/préfixe hors plages privées (`10.x`, `127.x`, `192.168.x`, `172.16-31.x`).
- Déviation actée vs spec §4.3 : pas de `DRAWER_PULSE_PIN` — `openCashDrawer()` de node-thermal-printer émet le pulse standard (pin non configurable par la lib) ; documenté dans le README du bridge.
- Commits : conventional commits, co-author `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Branche de travail : `swarm/session-65` (créée depuis `master` au démarrage ; le spec est déjà commité sur `docs/print-bridge-scan-crud-spec` — merger ou cherry-pick ce commit en premier).

## File Map

**Créés :**
- `packages/domain/src/printing/payloads.ts` — types `PrinterTarget`/`ReceiptPayload`/`StationTicketPayload`/`StationTicketItem`
- `apps/print-bridge/package.json`, `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`, `.env.example`, `README.md`
- `apps/print-bridge/src/{config,ipGuard,scan,transport,app,server}.ts`
- `apps/print-bridge/src/render/{printerLike,receipt,stationTicket}.ts`
- `apps/print-bridge/src/__tests__/{config,ipGuard,scan,receipt,stationTicket,transport,app}.test.ts`
- `apps/backoffice/src/stores/bridgeSettingsStore.ts`
- `apps/backoffice/src/features/lan-devices/utils/ipGuard.ts`
- `apps/backoffice/src/features/lan-devices/api/bridgeApi.ts`
- `apps/backoffice/src/features/lan-devices/hooks/{useUpsertLanDevice,useDeleteLanDevice}.ts`
- `apps/backoffice/src/features/lan-devices/components/{LanDeviceFormModal,ScanPanel}.tsx`
- `apps/backoffice/src/features/lan-devices/__tests__/{lan-device-form.smoke.test.tsx,scan-panel.smoke.test.tsx,upsert-hook.test.ts}`
- `supabase/tests/lan_devices_rls.test.sql`

**Modifiés :**
- `apps/pos/src/services/print/printService.ts:20-91` — remplace les interfaces locales par des re-exports domain (type-only)
- `packages/domain/src/printing/index.ts` — `export * from './payloads.js'`
- `apps/backoffice/src/features/lan-devices/components/LanDevicesTable.tsx` — colonnes IP/station + actions
- `apps/backoffice/src/pages/lan-devices/LanDevicesPage.tsx` — bouton Add + ScanPanel + modal
- `apps/backoffice/src/features/lan-devices/__tests__/LanDevicesTable.smoke.test.tsx` — props actions

---

### Task 1 : Types de payloads dans `@breakery/domain` + re-export POS (type-only)

**Files:**
- Create: `packages/domain/src/printing/payloads.ts`
- Modify: `packages/domain/src/printing/index.ts`
- Modify: `apps/pos/src/services/print/printService.ts:20-91`

**Interfaces:**
- Consumes: `PaymentMethod` (`packages/domain/src/types/payment.ts`), `PrintKind`/`PrinterRole` (`packages/domain/src/printing/types.ts`)
- Produces: `PrinterTarget { ip_address: string; port: number }`, `StationTicketItem`, `StationTicketPayload`, `ReceiptPayload` — exportés par `@breakery/domain`, consommés par les Tasks 5, 6, 8 (bridge) et re-exportés par printService (POS inchangé pour ses consommateurs).

- [ ] **Step 1 : Créer `packages/domain/src/printing/payloads.ts`**

Copie EXACTE des shapes de `apps/pos/src/services/print/printService.ts` lignes 20–91 (source de vérité — relire le fichier avant) :

```ts
// packages/domain/src/printing/payloads.ts
// 2026-07-06 — print-bridge spec §4.1 : les shapes des payloads d'impression
// deviennent des types domain partagés POS ↔ bridge. Source historique :
// apps/pos/src/services/print/printService.ts (S34/S60), déplacée telle quelle.

import type { PaymentMethod } from '../types/payment.js';
import type { PrintKind, PrinterRole } from './types.js';

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
  /** Spec A Bloc 4 — 2nd-phase append : le template rend un header "ADDITIONAL ORDER". */
  additional?: boolean;
  totals?: { subtotal: number; tax: number; total: number };
  payment?: { method: string; amount: number; change_given: number };
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
    /** S60 — somme de promotions[].amount. Absent si aucune promo. */
    promotion_total?: number;
  };
  payment: { method: PaymentMethod; amount: number; cash_received?: number; change_given?: number };
  loyalty?: { points_earned: number; balance_after?: number };
  /** S60 — lignes promo nommées, snapshot cartStore au succès checkout. */
  promotions?: { name: string; amount: number }[];
  footer?: string;
}
```

- [ ] **Step 2 : Exporter depuis `packages/domain/src/printing/index.ts`**

Ajouter après la ligne `export * from './types.js';` :

```ts
export * from './payloads.js';
```

- [ ] **Step 3 : Remplacer les interfaces locales de printService par les re-exports**

Dans `apps/pos/src/services/print/printService.ts` : supprimer les blocs `export interface PrinterTarget`, `StationTicketItem`, `StationTicketPayload`, `ReceiptPayload` (lignes ~20–91) et remplacer l'import de tête + ajouter le re-export (les consommateurs POS importent depuis printService — ne pas les casser) :

```ts
import type { PrinterTarget, ReceiptPayload, StationTicketPayload } from '@breakery/domain';

export type {
  PrinterTarget,
  StationTicketItem,
  StationTicketPayload,
  ReceiptPayload,
} from '@breakery/domain';
```

(L'import existant `import type { PaymentMethod, PrintKind, PrinterRole } from '@breakery/domain';` : retirer les membres devenus inutilisés — après suppression des interfaces, `PaymentMethod`/`PrintKind`/`PrinterRole` ne sont plus référencés dans ce fichier.)

- [ ] **Step 4 : Vérifier typecheck + smokes POS print**

```bash
pnpm --filter @breakery/domain typecheck && pnpm --filter @breakery/app-pos typecheck
pnpm --filter @breakery/app-pos test print
```
Attendu : typecheck exit 0 ; smokes print existants PASS (aucun changement runtime).

- [ ] **Step 5 : Commit**

```bash
git add packages/domain/src/printing/payloads.ts packages/domain/src/printing/index.ts apps/pos/src/services/print/printService.ts
git commit -m "refactor(domain): print payload types partagés POS↔bridge (type-only, POS runtime inchangé)"
```

---

### Task 2 : Scaffold `apps/print-bridge` + config env

**Files:**
- Create: `apps/print-bridge/package.json`, `apps/print-bridge/tsconfig.json`, `apps/print-bridge/tsup.config.ts`, `apps/print-bridge/vitest.config.ts`, `apps/print-bridge/.env.example`, `apps/print-bridge/src/config.ts`
- Test: `apps/print-bridge/src/__tests__/config.test.ts`

**Interfaces:**
- Produces: `loadConfig(env?): BridgeConfig` où `BridgeConfig = { port: number; receiptPrinter: PrinterTarget | null }` — consommé par Tasks 8/9.

- [ ] **Step 1 : `package.json`**

```json
{
  "name": "@breakery/print-bridge",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/server.js",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsup",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint src"
  },
  "dependencies": {
    "@breakery/domain": "workspace:*",
    "cors": "^2.8.5",
    "express": "^4.21.2",
    "node-thermal-printer": "^4.4.4"
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/node": "^22.10.2",
    "@types/supertest": "^6.0.2",
    "supertest": "^7.0.0",
    "tsup": "^8.3.5",
    "tsx": "^4.19.2",
    "vitest": "^2.1.9"
  }
}
```

- [ ] **Step 2 : `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "rootDir": "src",
    "outDir": "dist",
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src/**/*"]
}
```

```ts
// apps/print-bridge/tsup.config.ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  target: 'node22',
  clean: true,
  sourcemap: true,
  // Les packages workspace sont du TS source — on les bundle ; les deps npm restent externes.
  noExternal: ['@breakery/domain', '@breakery/utils'],
});
```

```ts
// apps/print-bridge/vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'node', include: ['src/**/__tests__/**/*.test.ts'] },
});
```

- [ ] **Step 3 : `.env.example`**

```bash
# apps/print-bridge/.env.example — copier en .env sur le PC boutique
PORT=3001
# Imprimante caisse par défaut (reçus sans champ `printer` + drawer kick) — spec D6
RECEIPT_PRINTER_IP=192.168.1.50
RECEIPT_PRINTER_PORT=9100
```

- [ ] **Step 4 : Test failing `config.test.ts`**

```ts
// apps/print-bridge/src/__tests__/config.test.ts
import { describe, it, expect } from 'vitest';
import { loadConfig } from '../config.js';

describe('loadConfig', () => {
  it('defaults: port 3001, no receipt printer', () => {
    const c = loadConfig({});
    expect(c.port).toBe(3001);
    expect(c.receiptPrinter).toBeNull();
  });

  it('reads receipt printer from env', () => {
    const c = loadConfig({ PORT: '3005', RECEIPT_PRINTER_IP: '192.168.1.50', RECEIPT_PRINTER_PORT: '9101' });
    expect(c.port).toBe(3005);
    expect(c.receiptPrinter).toEqual({ ip_address: '192.168.1.50', port: 9101 });
  });

  it('falls back to 9100 when RECEIPT_PRINTER_PORT is garbage', () => {
    const c = loadConfig({ RECEIPT_PRINTER_IP: '10.0.0.9', RECEIPT_PRINTER_PORT: 'abc' });
    expect(c.receiptPrinter).toEqual({ ip_address: '10.0.0.9', port: 9100 });
  });
});
```

```bash
pnpm install
pnpm --filter @breakery/print-bridge test
```
Attendu : FAIL (`Cannot find module '../config.js'`).

- [ ] **Step 5 : Implémenter `src/config.ts`, re-run PASS**

```ts
// apps/print-bridge/src/config.ts
import type { PrinterTarget } from '@breakery/domain';

export interface BridgeConfig {
  port: number;
  /** Cible des reçus sans champ `printer` et du drawer kick (spec D6). null = non configurée. */
  receiptPrinter: PrinterTarget | null;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): BridgeConfig {
  const port = Number(env.PORT);
  const rpPort = Number(env.RECEIPT_PRINTER_PORT);
  return {
    port: Number.isInteger(port) && port > 0 ? port : 3001,
    receiptPrinter: env.RECEIPT_PRINTER_IP
      ? { ip_address: env.RECEIPT_PRINTER_IP, port: Number.isInteger(rpPort) && rpPort > 0 ? rpPort : 9100 }
      : null,
  };
}
```

Run : `pnpm --filter @breakery/print-bridge test` → 3 PASS. Puis `pnpm --filter @breakery/print-bridge typecheck` → exit 0.

- [ ] **Step 6 : Commit**

```bash
git add apps/print-bridge pnpm-lock.yaml
git commit -m "feat(print-bridge): scaffold workspace apps/print-bridge (config env, tsup, vitest)"
```

---

### Task 3 : `ipGuard.ts` — validation plages privées (anti-SSRF)

**Files:**
- Create: `apps/print-bridge/src/ipGuard.ts`
- Test: `apps/print-bridge/src/__tests__/ipGuard.test.ts`

**Interfaces:**
- Produces: `isPrivateIpv4(ip: string): boolean`, `isPrivatePrefix(prefix: string): boolean` (prefix = 3 premiers octets, ex. `"192.168.1"`) — consommés par Task 8.

- [ ] **Step 1 : Test failing**

```ts
// apps/print-bridge/src/__tests__/ipGuard.test.ts
import { describe, it, expect } from 'vitest';
import { isPrivateIpv4, isPrivatePrefix } from '../ipGuard.js';

describe('isPrivateIpv4', () => {
  it.each(['192.168.1.50', '10.0.0.1', '172.16.0.1', '172.31.255.254', '127.0.0.1'])('accepts %s', (ip) => {
    expect(isPrivateIpv4(ip)).toBe(true);
  });
  it.each(['8.8.8.8', '172.32.0.1', '172.15.0.1', '192.169.0.1', '256.1.1.1', 'evil.host', '192.168.1', ''])(
    'rejects %s',
    (ip) => { expect(isPrivateIpv4(ip)).toBe(false); },
  );
});

describe('isPrivatePrefix', () => {
  it.each(['192.168.1', '10.0.0', '172.16.4'])('accepts %s', (p) => {
    expect(isPrivatePrefix(p)).toBe(true);
  });
  it.each(['8.8.8', '172.32.0', '192.168', '192.168.1.5', 'foo'])('rejects %s', (p) => {
    expect(isPrivatePrefix(p)).toBe(false);
  });
});
```

Run : `pnpm --filter @breakery/print-bridge test ipGuard` → FAIL (module absent).

- [ ] **Step 2 : Implémenter**

```ts
// apps/print-bridge/src/ipGuard.ts
// Anti-SSRF (spec D7) : le scan et les probes n'acceptent QUE des cibles LAN privées.

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const PREFIX_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export function isPrivateIpv4(ip: string): boolean {
  const m = IPV4_RE.exec(ip);
  if (!m) return false;
  const [a, b, c, d] = m.slice(1).map(Number);
  if (a > 255 || b > 255 || c > 255 || d > 255) return false;
  return isPrivateOctets(a, b);
}

export function isPrivatePrefix(prefix: string): boolean {
  const m = PREFIX_RE.exec(prefix);
  if (!m) return false;
  const [a, b, c] = m.slice(1).map(Number);
  if (a > 255 || b > 255 || c > 255) return false;
  return isPrivateOctets(a, b);
}

function isPrivateOctets(a: number, b: number): boolean {
  if (a === 10 || a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}
```

- [ ] **Step 3 : Run PASS + commit**

```bash
pnpm --filter @breakery/print-bridge test ipGuard
git add apps/print-bridge/src/ipGuard.ts apps/print-bridge/src/__tests__/ipGuard.test.ts
git commit -m "feat(print-bridge): garde anti-SSRF plages IPv4 privées"
```

---

### Task 4 : `scan.ts` — probe TCP + sweep concurrent

**Files:**
- Create: `apps/print-bridge/src/scan.ts`
- Test: `apps/print-bridge/src/__tests__/scan.test.ts`

**Interfaces:**
- Produces: `probeTcp(ip, port, timeoutMs): Promise<number | null>` (latence ms ou null), `scanHosts(hosts: string[], port, timeoutMs, concurrency?): Promise<ScanHit[]>`, `hostsForPrefix(prefix: string): string[]` (254 hôtes), `ScanHit = { ip: string; port: number; latencyMs: number }` — consommés par Task 8.

- [ ] **Step 1 : Test failing (vrai serveur TCP éphémère)**

```ts
// apps/print-bridge/src/__tests__/scan.test.ts
import net from 'node:net';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { probeTcp, scanHosts, hostsForPrefix } from '../scan.js';

let server: net.Server;
let openPort = 0;

beforeAll(async () => {
  server = net.createServer((s) => s.destroy());
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  openPort = (server.address() as net.AddressInfo).port;
});
afterAll(() => server.close());

describe('probeTcp', () => {
  it('returns a latency for an open port', async () => {
    const latency = await probeTcp('127.0.0.1', openPort, 1000);
    expect(latency).not.toBeNull();
    expect(latency!).toBeGreaterThanOrEqual(0);
  });
  it('returns null for a closed port', async () => {
    expect(await probeTcp('127.0.0.1', 1, 500)).toBeNull();
  });
});

describe('scanHosts', () => {
  it('finds only the reachable host', async () => {
    const hits = await scanHosts(['127.0.0.1'], openPort, 1000);
    expect(hits).toEqual([{ ip: '127.0.0.1', port: openPort, latencyMs: expect.any(Number) }]);
  });
  it('empty when nothing listens', async () => {
    expect(await scanHosts(['127.0.0.1'], 1, 300)).toEqual([]);
  });
});

describe('hostsForPrefix', () => {
  it('expands prefix.1..254', () => {
    const hosts = hostsForPrefix('192.168.1');
    expect(hosts).toHaveLength(254);
    expect(hosts[0]).toBe('192.168.1.1');
    expect(hosts[253]).toBe('192.168.1.254');
  });
});
```

Run : `pnpm --filter @breakery/print-bridge test scan` → FAIL.

- [ ] **Step 2 : Implémenter**

```ts
// apps/print-bridge/src/scan.ts
// Sweep TCP 9100 (spec §4.2). Seul un process Node sur le LAN peut faire ça —
// c'est LA raison d'être du scan côté bridge (le navigateur est aveugle en TCP brut).
import net from 'node:net';

export interface ScanHit {
  ip: string;
  port: number;
  latencyMs: number;
}

export function probeTcp(ip: string, port: number, timeoutMs: number): Promise<number | null> {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = new net.Socket();
    let settled = false;
    const done = (result: number | null): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(Date.now() - started));
    socket.once('timeout', () => done(null));
    socket.once('error', () => done(null));
    socket.connect(port, ip);
  });
}

export async function scanHosts(
  hosts: string[],
  port: number,
  timeoutMs: number,
  concurrency = 50,
): Promise<ScanHit[]> {
  const hits: ScanHit[] = [];
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < hosts.length) {
      const ip = hosts[cursor++];
      if (ip === undefined) return;
      const latencyMs = await probeTcp(ip, port, timeoutMs);
      if (latencyMs !== null) hits.push({ ip, port, latencyMs });
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, hosts.length) }, () => worker()));
  return hits.sort((a, b) => a.ip.localeCompare(b.ip, undefined, { numeric: true }));
}

export function hostsForPrefix(prefix: string): string[] {
  return Array.from({ length: 254 }, (_, i) => `${prefix}.${i + 1}`);
}
```

- [ ] **Step 3 : Run PASS + commit**

```bash
pnpm --filter @breakery/print-bridge test scan
git add apps/print-bridge/src/scan.ts apps/print-bridge/src/__tests__/scan.test.ts
git commit -m "feat(print-bridge): probe TCP + sweep concurrent /24"
```

---

### Task 5 : `render/receipt.ts` — template reçu (avec promotions[])

**Files:**
- Create: `apps/print-bridge/src/render/printerLike.ts`, `apps/print-bridge/src/render/receipt.ts`
- Test: `apps/print-bridge/src/__tests__/receipt.test.ts`

**Interfaces:**
- Produces: `PrinterLike` (sous-ensemble des méthodes de node-thermal-printer : `alignCenter/alignLeft/bold(on)/setTextSize(h,w)/setTextNormal/println(t)/newLine/drawLine/leftRight(l,r)/cut`), `renderReceipt(p: PrinterLike, payload: ReceiptPayload): void`, `money(n: number): string` — consommés par Tasks 6, 7, 8.

- [ ] **Step 1 : `printerLike.ts` + FakePrinter de test + test failing**

```ts
// apps/print-bridge/src/render/printerLike.ts
/** Sous-ensemble de l'API node-thermal-printer utilisé par les templates —
 *  permet de tester le rendu avec un enregistreur d'appels, sans imprimante. */
export interface PrinterLike {
  alignCenter(): void;
  alignLeft(): void;
  bold(on: boolean): void;
  setTextSize(height: number, width: number): void;
  setTextNormal(): void;
  println(text: string): void;
  newLine(): void;
  drawLine(): void;
  leftRight(left: string, right: string): void;
  cut(): void;
}
```

```ts
// apps/print-bridge/src/__tests__/receipt.test.ts
import { describe, it, expect } from 'vitest';
import type { ReceiptPayload } from '@breakery/domain';
import type { PrinterLike } from '../render/printerLike.js';
import { renderReceipt, money } from '../render/receipt.js';

export function makeFake(): { p: PrinterLike; log: string[] } {
  const log: string[] = [];
  const p: PrinterLike = {
    alignCenter: () => log.push('<center>'),
    alignLeft: () => log.push('<left>'),
    bold: (on) => log.push(on ? '<b>' : '</b>'),
    setTextSize: (h, w) => log.push(`<size ${h}x${w}>`),
    setTextNormal: () => log.push('<normal>'),
    println: (t) => log.push(t),
    newLine: () => log.push(''),
    drawLine: () => log.push('--------'),
    leftRight: (l, r) => log.push(`${l} | ${r}`),
    cut: () => log.push('<cut>'),
  };
  return { p, log };
}

const BASE: ReceiptPayload = {
  business: { name: 'The Breakery', address: 'Jl. Contoh 1' },
  order: { order_number: 'A-042', created_at: '2026-07-06T09:30:00Z', cashier_name: 'Ayu', order_type: 'take_out' },
  items: [
    { name: 'Croissant', quantity: 2, unit_price: 15000, line_total: 30000,
      modifiers: [{ label: 'Extra butter', price_adjustment: 2000 }] },
  ],
  totals: { items_total: 32000, redemption_amount: 0, total: 32000, tax_amount: 3200 },
  payment: { method: 'cash', amount: 50000, cash_received: 50000, change_given: 18000 },
};

describe('money', () => {
  it('formats IDR with thousand separators, no decimals', () => {
    expect(money(32000)).toBe('32.000');
    expect(money(1250500)).toBe('1.250.500');
  });
});

describe('renderReceipt', () => {
  it('renders business, items, modifiers, totals, payment and cuts', () => {
    const { p, log } = makeFake();
    renderReceipt(p, BASE);
    const flat = log.join('\n');
    expect(flat).toContain('The Breakery');
    expect(flat).toContain('2x Croissant | 30.000');
    expect(flat).toContain('  + Extra butter | 2.000');
    expect(flat).toContain('TOTAL | 32.000');
    expect(flat).toContain('Cash | 50.000');
    expect(flat).toContain('Change | 18.000');
    expect(log[log.length - 1]).toBe('<cut>');
  });

  it('renders named promotion lines + promotion_total (S60)', () => {
    const { p, log } = makeFake();
    renderReceipt(p, {
      ...BASE,
      totals: { ...BASE.totals, promotion_total: 5000 },
      promotions: [{ name: 'Happy Hour -10%', amount: 5000 }],
    });
    const flat = log.join('\n');
    expect(flat).toContain('Happy Hour -10% | -5.000');
    expect(flat).toContain('Promotions | -5.000');
  });

  it('omits promo/loyalty/footer blocks when absent', () => {
    const { p, log } = makeFake();
    renderReceipt(p, BASE);
    const flat = log.join('\n');
    expect(flat).not.toContain('Promotions |');
    expect(flat).not.toContain('Points');
  });
});
```

Run : `pnpm --filter @breakery/print-bridge test receipt` → FAIL.

- [ ] **Step 2 : Implémenter `render/receipt.ts`**

```ts
// apps/print-bridge/src/render/receipt.ts
// Template reçu — ferme l'action S60 : rend promotions[] + totals.promotion_total.
import type { ReceiptPayload } from '@breakery/domain';
import type { PrinterLike } from './printerLike.js';

/** IDR : entier, séparateur de milliers '.', pas de décimales. */
export function money(n: number): string {
  return Math.round(n).toLocaleString('de-DE'); // de-DE = '.' milliers, format id-ID identique
}

const METHOD_LABELS: Record<string, string> = {
  cash: 'Cash', card: 'Card', qris: 'QRIS', edc: 'EDC', transfer: 'Transfer', store_credit: 'Store credit',
};

export function renderReceipt(p: PrinterLike, r: ReceiptPayload): void {
  p.alignCenter();
  p.bold(true);
  p.setTextSize(1, 1);
  p.println(r.business.name);
  p.setTextNormal();
  p.bold(false);
  p.println(r.business.address);
  if (r.business.phone) p.println(r.business.phone);
  if (r.business.tax_id) p.println(`NPWP ${r.business.tax_id}`);
  p.drawLine();

  p.alignLeft();
  p.leftRight(`#${r.order.order_number}`, r.order.order_type === 'dine_in' ? 'Dine in' : 'Take out');
  p.leftRight(new Date(r.order.created_at).toLocaleString('en-GB'), r.order.cashier_name);
  if (r.customer) p.println(`Customer: ${r.customer.name}${r.customer.loyalty_tier ? ` (${r.customer.loyalty_tier})` : ''}`);
  p.drawLine();

  for (const item of r.items) {
    p.leftRight(`${item.quantity}x ${item.name}`, money(item.line_total));
    for (const mod of item.modifiers ?? []) {
      p.leftRight(`  + ${mod.label}`, money(mod.price_adjustment));
    }
  }
  p.drawLine();

  p.leftRight('Subtotal', money(r.totals.items_total));
  if (r.promotions && r.promotions.length > 0) {
    for (const promo of r.promotions) p.leftRight(promo.name, `-${money(promo.amount)}`);
    p.leftRight('Promotions', `-${money(r.totals.promotion_total ?? r.promotions.reduce((s, x) => s + x.amount, 0))}`);
  }
  if (r.totals.redemption_amount > 0) p.leftRight('Points redeemed', `-${money(r.totals.redemption_amount)}`);
  p.leftRight('Tax', money(r.totals.tax_amount));
  p.bold(true);
  p.leftRight('TOTAL', money(r.totals.total));
  p.bold(false);
  p.drawLine();

  p.leftRight(METHOD_LABELS[r.payment.method] ?? r.payment.method, money(r.payment.amount));
  if (r.payment.cash_received !== undefined) p.leftRight('Cash received', money(r.payment.cash_received));
  if (r.payment.change_given !== undefined) p.leftRight('Change', money(r.payment.change_given));

  if (r.loyalty) {
    p.drawLine();
    p.println(`Points earned: ${r.loyalty.points_earned}`);
    if (r.loyalty.balance_after !== undefined) p.println(`Points balance: ${r.loyalty.balance_after}`);
  }

  if (r.footer) {
    p.newLine();
    p.alignCenter();
    p.println(r.footer);
  }
  p.newLine();
  p.cut();
}
```

- [ ] **Step 3 : Run PASS + commit**

```bash
pnpm --filter @breakery/print-bridge test receipt
git add apps/print-bridge/src/render apps/print-bridge/src/__tests__/receipt.test.ts
git commit -m "feat(print-bridge): template reçu ESC/POS avec lignes promo nommées (ferme action S60)"
```

---

### Task 6 : `render/stationTicket.ts` — KOT station + waiter + ADDITIONAL ORDER

**Files:**
- Create: `apps/print-bridge/src/render/stationTicket.ts`
- Test: `apps/print-bridge/src/__tests__/stationTicket.test.ts`

**Interfaces:**
- Consumes: `PrinterLike` (Task 5), `StationTicketPayload` (Task 1), FakePrinter (`makeFake` exporté par `receipt.test.ts` — le réimporter).
- Produces: `renderStationTicket(p: PrinterLike, payload: StationTicketPayload): void` — consommé par Task 8.

- [ ] **Step 1 : Test failing**

```ts
// apps/print-bridge/src/__tests__/stationTicket.test.ts
import { describe, it, expect } from 'vitest';
import type { StationTicketPayload } from '@breakery/domain';
import { renderStationTicket } from '../render/stationTicket.js';
import { makeFake } from './receipt.test.js';

const BASE: StationTicketPayload = {
  kind: 'prep',
  role: 'kitchen',
  order_number: 'A-042',
  table_number: '5',
  created_at: '2026-07-06T09:30:00Z',
  server_name: 'Ayu',
  items: [
    { name: 'Croque Monsieur', quantity: 2, modifiers: ['No onions'], note: 'allergy: nuts' },
    { name: 'Omelette', quantity: 1 },
  ],
};

describe('renderStationTicket', () => {
  it('renders station header, order, table, items with modifiers and notes', () => {
    const { p, log } = makeFake();
    renderStationTicket(p, BASE);
    const flat = log.join('\n');
    expect(flat).toContain('KITCHEN');
    expect(flat).toContain('#A-042');
    expect(flat).toContain('Table 5');
    expect(flat).toContain('2x Croque Monsieur');
    expect(flat).toContain('  + No onions');
    expect(flat).toContain('  ! allergy: nuts');
    expect(log[log.length - 1]).toBe('<cut>');
  });

  it('renders the ADDITIONAL ORDER banner when additional=true', () => {
    const { p, log } = makeFake();
    renderStationTicket(p, { ...BASE, additional: true });
    expect(log.join('\n')).toContain('*** ADDITIONAL ORDER ***');
  });

  it('waiter ticket shows WAITER header, no table line when absent', () => {
    const { p, log } = makeFake();
    renderStationTicket(p, { ...BASE, kind: 'waiter', role: 'waiter', table_number: undefined });
    const flat = log.join('\n');
    expect(flat).toContain('WAITER');
    expect(flat).not.toContain('Table');
  });
});
```

Run : `pnpm --filter @breakery/print-bridge test stationTicket` → FAIL.

- [ ] **Step 2 : Implémenter**

```ts
// apps/print-bridge/src/render/stationTicket.ts
// KOT station (kind 'prep') + ticket waiter consolidé (kind 'waiter', S-B1 Ph1 Bloc 1.4).
import type { StationTicketPayload } from '@breakery/domain';
import type { PrinterLike } from './printerLike.js';

export function renderStationTicket(p: PrinterLike, t: StationTicketPayload): void {
  p.alignCenter();
  p.bold(true);
  p.setTextSize(1, 1);
  p.println(t.role.toUpperCase());
  p.setTextNormal();
  if (t.additional === true) {
    p.println('*** ADDITIONAL ORDER ***');
  }
  p.bold(false);
  p.drawLine();

  p.alignLeft();
  p.setTextSize(1, 1);
  p.println(`#${t.order_number}`);
  p.setTextNormal();
  if (t.table_number !== undefined) p.println(`Table ${t.table_number}`);
  p.leftRight(new Date(t.created_at).toLocaleTimeString('en-GB'), t.server_name);
  p.drawLine();

  for (const item of t.items) {
    p.bold(true);
    p.println(`${item.quantity}x ${item.name}`);
    p.bold(false);
    for (const mod of item.modifiers ?? []) p.println(`  + ${mod}`);
    if (item.note) p.println(`  ! ${item.note}`);
  }
  p.newLine();
  p.cut();
}
```

- [ ] **Step 3 : Run PASS + commit**

```bash
pnpm --filter @breakery/print-bridge test stationTicket
git add apps/print-bridge/src/render/stationTicket.ts apps/print-bridge/src/__tests__/stationTicket.test.ts
git commit -m "feat(print-bridge): template KOT station + waiter + banner ADDITIONAL ORDER"
```

---

### Task 7 : `transport.ts` — envoi réel via node-thermal-printer

**Files:**
- Create: `apps/print-bridge/src/transport.ts`
- Test: `apps/print-bridge/src/__tests__/transport.test.ts`

**Interfaces:**
- Produces: `sendToPrinter(target: PrinterTarget, render: (p: PrinterLike) => void): Promise<void>` (rejette si l'imprimante est injoignable), `kickDrawer(target: PrinterTarget): Promise<void>` — consommés par Tasks 8/9. Le vrai `ThermalPrinter` satisfait structurellement `PrinterLike`.

- [ ] **Step 1 : Test failing (mock du module node-thermal-printer)**

```ts
// apps/print-bridge/src/__tests__/transport.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const executed: string[] = [];
const instances: Array<{ iface: string; calls: string[] }> = [];

vi.mock('node-thermal-printer', () => {
  class ThermalPrinter {
    calls: string[] = [];
    constructor(cfg: { interface: string }) {
      instances.push({ iface: cfg.interface, calls: this.calls });
    }
    println(t: string): void { this.calls.push(`println:${t}`); }
    alignCenter(): void { this.calls.push('alignCenter'); }
    alignLeft(): void { this.calls.push('alignLeft'); }
    bold(): void { this.calls.push('bold'); }
    setTextSize(): void { this.calls.push('setTextSize'); }
    setTextNormal(): void { this.calls.push('setTextNormal'); }
    newLine(): void { this.calls.push('newLine'); }
    drawLine(): void { this.calls.push('drawLine'); }
    leftRight(): void { this.calls.push('leftRight'); }
    cut(): void { this.calls.push('cut'); }
    openCashDrawer(): void { this.calls.push('openCashDrawer'); }
    async execute(): Promise<void> { executed.push(instances[instances.length - 1]!.iface); }
  }
  return { ThermalPrinter, PrinterTypes: { EPSON: 'epson' }, printer: ThermalPrinter };
});

import { sendToPrinter, kickDrawer } from '../transport.js';

beforeEach(() => { executed.length = 0; instances.length = 0; });

describe('sendToPrinter', () => {
  it('targets tcp://ip:port, runs the render, executes', async () => {
    await sendToPrinter({ ip_address: '192.168.1.60', port: 9100 }, (p) => p.println('hello'));
    expect(instances[0]!.iface).toBe('tcp://192.168.1.60:9100');
    expect(instances[0]!.calls).toContain('println:hello');
    expect(executed).toEqual(['tcp://192.168.1.60:9100']);
  });
});

describe('kickDrawer', () => {
  it('sends openCashDrawer then executes', async () => {
    await kickDrawer({ ip_address: '10.0.0.5', port: 9100 });
    expect(instances[0]!.calls).toContain('openCashDrawer');
    expect(executed).toHaveLength(1);
  });
});
```

Run : `pnpm --filter @breakery/print-bridge test transport` → FAIL.

- [ ] **Step 2 : Implémenter**

```ts
// apps/print-bridge/src/transport.ts
// Seul module qui touche node-thermal-printer. Timeout TCP 5 s.
// NOTE import : node-thermal-printer v4 exporte { printer: ThermalPrinter, types: PrinterTypes }
// en CJS ET des named exports ThermalPrinter/PrinterTypes selon la version — si
// `import { ThermalPrinter }` échoue au runtime, utiliser la forme namespace ci-dessous.
import ntp from 'node-thermal-printer';
import type { PrinterTarget } from '@breakery/domain';
import type { PrinterLike } from './render/printerLike.js';

const { ThermalPrinter, PrinterTypes } =
  ntp as unknown as { ThermalPrinter: new (cfg: object) => PrinterLike & { execute(): Promise<void>; openCashDrawer(): void }; PrinterTypes: { EPSON: string } };

function makePrinter(target: PrinterTarget) {
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
```

⚠️ Si le typecheck échoue sur la forme d'import : vérifier `node_modules/node-thermal-printer/package.json` (`main`/`exports`) et ajuster (named import direct `import { ThermalPrinter, PrinterTypes } from 'node-thermal-printer'` si la version installée les exporte). Le test mocké ci-dessus couvre les deux formes (le mock expose les deux).

- [ ] **Step 3 : Run PASS + commit**

```bash
pnpm --filter @breakery/print-bridge test transport && pnpm --filter @breakery/print-bridge typecheck
git add apps/print-bridge/src/transport.ts apps/print-bridge/src/__tests__/transport.test.ts
git commit -m "feat(print-bridge): transport node-thermal-printer (send + drawer kick)"
```

---

### Task 8 : `app.ts` — les 6 routes Express (DI + supertest)

**Files:**
- Create: `apps/print-bridge/src/app.ts`
- Test: `apps/print-bridge/src/__tests__/app.test.ts`

**Interfaces:**
- Consumes: `BridgeConfig` (T2), `isPrivateIpv4/isPrivatePrefix` (T3), `probeTcp/scanHosts/hostsForPrefix/ScanHit` (T4), `renderReceipt` (T5), `renderStationTicket` (T6), signatures de `sendToPrinter/kickDrawer` (T7).
- Produces: `createApp(deps: AppDeps): express.Express` avec `AppDeps = { config: BridgeConfig; send: typeof sendToPrinter; kick: typeof kickDrawer; probe?: typeof probeTcp; scan?: typeof scanHosts }` — consommé par Task 9.

- [ ] **Step 1 : Test failing (supertest, transports fakes)**

```ts
// apps/print-bridge/src/__tests__/app.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import type { PrinterTarget, ReceiptPayload, StationTicketPayload } from '@breakery/domain';
import { createApp } from '../app.js';

const send = vi.fn<(t: PrinterTarget, render: (p: unknown) => void) => Promise<void>>().mockResolvedValue();
const kick = vi.fn<(t: PrinterTarget) => Promise<void>>().mockResolvedValue();
const probe = vi.fn().mockResolvedValue(12);
const scan = vi.fn().mockResolvedValue([{ ip: '192.168.1.60', port: 9100, latencyMs: 8 }]);

function app(receiptPrinter: PrinterTarget | null = { ip_address: '192.168.1.50', port: 9100 }) {
  return createApp({ config: { port: 3001, receiptPrinter }, send, kick, probe, scan });
}

const RECEIPT: ReceiptPayload = {
  business: { name: 'B', address: 'A' },
  order: { order_number: '1', created_at: '2026-07-06T00:00:00Z', cashier_name: 'C', order_type: 'take_out' },
  items: [{ name: 'X', quantity: 1, unit_price: 1000, line_total: 1000 }],
  totals: { items_total: 1000, redemption_amount: 0, total: 1000, tax_amount: 100 },
  payment: { method: 'cash', amount: 1000 },
};
const TICKET: StationTicketPayload = {
  kind: 'prep', role: 'kitchen', order_number: '1',
  created_at: '2026-07-06T00:00:00Z', server_name: 'S',
  items: [{ name: 'X', quantity: 1 }],
};

beforeEach(() => { send.mockClear(); kick.mockClear(); probe.mockClear(); scan.mockClear(); send.mockResolvedValue(); });

describe('GET /health', () => {
  it('200 ok', async () => {
    const res = await request(app()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('POST /print/receipt', () => {
  it('routes to body.printer when provided', async () => {
    const res = await request(app()).post('/print/receipt')
      .send({ ...RECEIPT, printer: { ip_address: '192.168.1.99', port: 9100 } });
    expect(res.status).toBe(200);
    expect(send).toHaveBeenCalledWith({ ip_address: '192.168.1.99', port: 9100 }, expect.any(Function));
  });
  it('falls back to env receipt printer', async () => {
    await request(app()).post('/print/receipt').send(RECEIPT);
    expect(send).toHaveBeenCalledWith({ ip_address: '192.168.1.50', port: 9100 }, expect.any(Function));
  });
  it('400 no_receipt_printer_configured when neither', async () => {
    const res = await request(app(null)).post('/print/receipt').send(RECEIPT);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, error: 'no_receipt_printer_configured' });
  });
  it('400 on malformed payload', async () => {
    const res = await request(app()).post('/print/receipt').send({ nope: true });
    expect(res.status).toBe(400);
  });
  it('502 when the printer is down', async () => {
    send.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const res = await request(app()).post('/print/receipt').send(RECEIPT);
    expect(res.status).toBe(502);
    expect(res.body.success).toBe(false);
  });
});

describe('POST /print/ticket', () => {
  it('prints to the body printer', async () => {
    const res = await request(app()).post('/print/ticket')
      .send({ printer: { ip_address: '192.168.1.60', port: 9100 }, ...TICKET });
    expect(res.status).toBe(200);
    expect(send).toHaveBeenCalledWith({ ip_address: '192.168.1.60', port: 9100 }, expect.any(Function));
  });
  it('400 missing_printer without printer', async () => {
    const res = await request(app()).post('/print/ticket').send(TICKET);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('missing_printer');
  });
});

describe('POST /drawer/open', () => {
  it('kicks the env receipt printer', async () => {
    const res = await request(app()).post('/drawer/open');
    expect(res.status).toBe(200);
    expect(kick).toHaveBeenCalledWith({ ip_address: '192.168.1.50', port: 9100 });
  });
  it('400 when no receipt printer configured', async () => {
    const res = await request(app(null)).post('/drawer/open');
    expect(res.status).toBe(400);
  });
});

describe('GET /scan/printers', () => {
  it('scans a private prefix', async () => {
    const res = await request(app()).get('/scan/printers?prefix=192.168.1&timeout=300');
    expect(res.status).toBe(200);
    expect(res.body.devices).toEqual([{ ip: '192.168.1.60', port: 9100, latencyMs: 8 }]);
    expect(res.body.hostsScanned).toBe(254);
    expect(typeof res.body.durationMs).toBe('number');
    expect(scan).toHaveBeenCalledWith(expect.arrayContaining(['192.168.1.1']), 9100, 300, 50);
  });
  it('400 invalid_range on public prefix', async () => {
    const res = await request(app()).get('/scan/printers?prefix=8.8.8');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_range');
  });
  it('400 invalid_range without prefix', async () => {
    const res = await request(app()).get('/scan/printers');
    expect(res.status).toBe(400);
  });
});

describe('GET /status/probe', () => {
  it('reports reachable + latency', async () => {
    const res = await request(app()).get('/status/probe?ip=192.168.1.60');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ reachable: true, latencyMs: 12 });
  });
  it('reports unreachable', async () => {
    probe.mockResolvedValueOnce(null);
    const res = await request(app()).get('/status/probe?ip=192.168.1.61');
    expect(res.body).toEqual({ reachable: false });
  });
  it('400 invalid_range on public ip', async () => {
    const res = await request(app()).get('/status/probe?ip=8.8.8.8');
    expect(res.status).toBe(400);
  });
});
```

Run : `pnpm --filter @breakery/print-bridge test app` → FAIL.

- [ ] **Step 2 : Implémenter `src/app.ts`**

```ts
// apps/print-bridge/src/app.ts
// Les 6 routes du contrat (spec §4). CORS ouvert (D7 — LAN de confiance, pas de
// credentials) ; les transports sont injectés pour la testabilité.
import express from 'express';
import cors from 'cors';
import type { PrinterTarget, ReceiptPayload, StationTicketPayload } from '@breakery/domain';
import type { BridgeConfig } from './config.js';
import { isPrivateIpv4, isPrivatePrefix } from './ipGuard.js';
import { probeTcp as realProbe, scanHosts as realScan, hostsForPrefix } from './scan.js';
import { renderReceipt } from './render/receipt.js';
import { renderStationTicket } from './render/stationTicket.js';
import type { sendToPrinter, kickDrawer } from './transport.js';

export interface AppDeps {
  config: BridgeConfig;
  send: typeof sendToPrinter;
  kick: typeof kickDrawer;
  probe?: typeof realProbe;
  scan?: typeof realScan;
}

function isTarget(x: unknown): x is PrinterTarget {
  return typeof x === 'object' && x !== null
    && typeof (x as PrinterTarget).ip_address === 'string'
    && typeof (x as PrinterTarget).port === 'number';
}

export function createApp({ config, send, kick, probe = realProbe, scan = realScan }: AppDeps): express.Express {
  const app = express();
  app.use(cors({ origin: true }));
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', version: process.env.npm_package_version ?? 'dev' });
  });

  app.post('/print/receipt', (req, res) => {
    const body = req.body as ReceiptPayload & { printer?: PrinterTarget };
    if (!body?.order?.order_number || !Array.isArray(body.items) || !body.totals || !body.payment) {
      res.status(400).json({ success: false, error: 'invalid_payload' });
      return;
    }
    const target = isTarget(body.printer) ? body.printer : config.receiptPrinter;
    if (!target) {
      res.status(400).json({ success: false, error: 'no_receipt_printer_configured' });
      return;
    }
    send(target, (p) => renderReceipt(p, body))
      .then(() => res.json({ success: true }))
      .catch((err: Error) => res.status(502).json({ success: false, error: err.message }));
  });

  app.post('/print/ticket', (req, res) => {
    const body = req.body as StationTicketPayload & { printer?: PrinterTarget };
    if (!isTarget(body?.printer)) {
      res.status(400).json({ success: false, error: 'missing_printer' });
      return;
    }
    if (!body.order_number && body.order_number !== '' || !Array.isArray(body.items)) {
      res.status(400).json({ success: false, error: 'invalid_payload' });
      return;
    }
    const { printer, ...payload } = body;
    send(printer, (p) => renderStationTicket(p, payload))
      .then(() => res.json({ success: true }))
      .catch((err: Error) => res.status(502).json({ success: false, error: err.message }));
  });

  app.post('/drawer/open', (_req, res) => {
    if (!config.receiptPrinter) {
      res.status(400).json({ success: false, error: 'no_receipt_printer_configured' });
      return;
    }
    kick(config.receiptPrinter)
      .then(() => res.json({ success: true }))
      .catch((err: Error) => res.status(502).json({ success: false, error: err.message }));
  });

  app.get('/scan/printers', (req, res) => {
    void (async () => {
      const prefix = String(req.query.prefix ?? '');
      if (!isPrivatePrefix(prefix)) {
        res.status(400).json({ error: 'invalid_range' });
        return;
      }
      const timeoutRaw = Number(req.query.timeout);
      const timeout = Number.isInteger(timeoutRaw) ? Math.min(Math.max(timeoutRaw, 100), 2000) : 500;
      const portRaw = Number(req.query.port);
      const port = Number.isInteger(portRaw) && portRaw > 0 && portRaw <= 65535 ? portRaw : 9100;
      const hosts = hostsForPrefix(prefix);
      const started = Date.now();
      const devices = await scan(hosts, port, timeout, 50);
      res.json({ devices, hostsScanned: hosts.length, durationMs: Date.now() - started });
    })();
  });

  app.get('/status/probe', (req, res) => {
    void (async () => {
      const ip = String(req.query.ip ?? '');
      if (!isPrivateIpv4(ip)) {
        res.status(400).json({ error: 'invalid_range' });
        return;
      }
      const portRaw = Number(req.query.port);
      const port = Number.isInteger(portRaw) && portRaw > 0 && portRaw <= 65535 ? portRaw : 9100;
      const latencyMs = await probe(ip, port, 1500);
      res.json(latencyMs === null ? { reachable: false } : { reachable: true, latencyMs });
    })();
  });

  return app;
}
```

- [ ] **Step 3 : Run PASS + commit**

```bash
pnpm --filter @breakery/print-bridge test && pnpm --filter @breakery/print-bridge typecheck
git add apps/print-bridge/src/app.ts apps/print-bridge/src/__tests__/app.test.ts
git commit -m "feat(print-bridge): routes contrat V2 + /scan/printers + /status/probe (anti-SSRF)"
```

---

### Task 9 : `server.ts` + README + build — le bridge est livrable

**Files:**
- Create: `apps/print-bridge/src/server.ts`, `apps/print-bridge/README.md`

**Interfaces:**
- Consumes: `loadConfig` (T2), `createApp` (T8), `sendToPrinter/kickDrawer` (T7).

- [ ] **Step 1 : `src/server.ts`**

```ts
// apps/print-bridge/src/server.ts — point d'entrée production.
import { loadConfig } from './config.js';
import { createApp } from './app.js';
import { sendToPrinter, kickDrawer } from './transport.js';

const config = loadConfig();
const app = createApp({ config, send: sendToPrinter, kick: kickDrawer });

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(
    `[print-bridge] listening on :${config.port} — receipt printer: ${
      config.receiptPrinter ? `${config.receiptPrinter.ip_address}:${config.receiptPrinter.port}` : 'NOT CONFIGURED'
    }`,
  );
});
```

- [ ] **Step 2 : `README.md` (installation PC boutique)**

```markdown
# @breakery/print-bridge

Traducteur HTTP → ESC/POS (TCP 9100) pour The Breakery. Remplace le template
print-server externe (spec 2026-07-06). Consommé par le POS (`printService.ts`)
et le BO (page LAN Devices : scan réseau + tests d'impression).

## Endpoints
- `GET  /health` — sonde de vie
- `POST /print/receipt` — reçu caisse (payload `ReceiptPayload`, rend `promotions[]`)
- `POST /print/ticket` — KOT station / ticket waiter (`{printer} & StationTicketPayload`)
- `POST /drawer/open` — pulse tiroir vers l'imprimante caisse (.env)
- `GET  /scan/printers?prefix=192.168.1&timeout=500` — sweep TCP 9100 (plages privées only)
- `GET  /status/probe?ip=&port=` — sonde une IP

## Installation (Windows, PC boutique)
1. `pnpm install && pnpm --filter @breakery/print-bridge build` → `apps/print-bridge/dist/server.js`
2. Copier `.env.example` → `.env` à côté de `dist/`, renseigner `RECEIPT_PRINTER_IP`.
3. Service Windows (au choix) :
   - **NSSM** : `nssm install BreakeryPrintBridge "C:\Program Files\nodejs\node.exe" "<repo>\apps\print-bridge\dist\server.js"` puis `nssm set BreakeryPrintBridge AppDirectory "<repo>\apps\print-bridge"` et `nssm start BreakeryPrintBridge`
   - **pm2** : `pm2 start dist/server.js --name print-bridge && pm2 save && pm2 startup`
4. Vérifier : `curl http://localhost:3001/health` puis POS → Settings → Devices → Test connection.

## Notes
- Tiroir-caisse : pulse standard via `openCashDrawer()` (pin non configurable — RJ11 sur l'imprimante caisse).
- Le tiroir et les reçus sans cible explicite partent sur `RECEIPT_PRINTER_IP:RECEIPT_PRINTER_PORT`.
- CORS ouvert : le bridge est un service LAN de confiance, sans credentials ni secrets.
```

- [ ] **Step 3 : Build + suite complète bridge**

```bash
pnpm --filter @breakery/print-bridge build
pnpm --filter @breakery/print-bridge test && pnpm --filter @breakery/print-bridge typecheck && pnpm --filter @breakery/print-bridge lint
```
Attendu : `dist/server.js` produit, tests/typecheck/lint exit 0. Si `lint` échoue faute de config ESLint héritée, copier le pattern du package `@breakery/domain` (même config racine — investiguer avant de désactiver quoi que ce soit).

- [ ] **Step 4 : Commit**

```bash
git add apps/print-bridge
git commit -m "feat(print-bridge): entrée serveur + README install service Windows"
```

---

### Task 10 : BO — store URL bridge + client HTTP bridge

**Files:**
- Create: `apps/backoffice/src/stores/bridgeSettingsStore.ts`, `apps/backoffice/src/features/lan-devices/utils/ipGuard.ts`, `apps/backoffice/src/features/lan-devices/api/bridgeApi.ts`
- Test: `apps/backoffice/src/features/lan-devices/__tests__/bridge-api.test.ts`

**Interfaces:**
- Produces: `useBridgeSettingsStore` (`{ bridgeUrl: string; setBridgeUrl }`, persist localStorage `bo-bridge-settings`), `resolveBridgeUrl(): string` (fallback `http://localhost:3001`), `isPrivatePrefix(prefix): boolean` (copie client), `scanPrinters(bridgeUrl, prefix, signal): Promise<ScanResponse>`, `probePrinter(bridgeUrl, ip, port): Promise<ProbeResponse>`, `sendTestTicket(bridgeUrl, printer, station): Promise<{success: boolean; error?: string}>` avec `ScanResponse = { devices: {ip: string; port: number; latencyMs: number}[]; hostsScanned: number; durationMs: number }`, `ProbeResponse = { reachable: boolean; latencyMs?: number }` — consommés par Tasks 13/14.

- [ ] **Step 1 : Test failing `bridge-api.test.ts`**

```ts
// apps/backoffice/src/features/lan-devices/__tests__/bridge-api.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { scanPrinters, probePrinter, sendTestTicket } from '../api/bridgeApi.js';
import { isPrivatePrefix } from '../utils/ipGuard.js';

afterEach(() => vi.restoreAllMocks());

describe('isPrivatePrefix (client copy)', () => {
  it('accepts 192.168.1, rejects 8.8.8', () => {
    expect(isPrivatePrefix('192.168.1')).toBe(true);
    expect(isPrivatePrefix('8.8.8')).toBe(false);
  });
});

describe('scanPrinters', () => {
  it('GETs the bridge and returns the parsed body', async () => {
    const body = { devices: [{ ip: '192.168.1.60', port: 9100, latencyMs: 8 }], hostsScanned: 254, durationMs: 1200 };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 })));
    const res = await scanPrinters('http://localhost:3001', '192.168.1');
    expect(res.devices).toHaveLength(1);
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:3001/scan/printers?prefix=192.168.1&timeout=500',
      expect.objectContaining({ method: 'GET' }),
    );
  });
  it('throws bridge_unreachable on network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    await expect(scanPrinters('http://localhost:3001', '192.168.1')).rejects.toThrow('bridge_unreachable');
  });
});

describe('probePrinter', () => {
  it('returns the probe body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ reachable: true, latencyMs: 5 }), { status: 200 })));
    expect(await probePrinter('http://x', '192.168.1.60', 9100)).toEqual({ reachable: true, latencyMs: 5 });
  });
});

describe('sendTestTicket', () => {
  it('POSTs a prep test ticket to /print/ticket', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await sendTestTicket('http://x', { ip_address: '192.168.1.60', port: 9100 }, 'kitchen');
    expect(res.success).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://x/print/ticket');
    const sent = JSON.parse(String(init.body));
    expect(sent.printer).toEqual({ ip_address: '192.168.1.60', port: 9100 });
    expect(sent.kind).toBe('prep');
    expect(sent.role).toBe('kitchen');
    expect(sent.order_number).toBe('TEST');
  });
});
```

Run : `pnpm --filter @breakery/app-backoffice test bridge-api` → FAIL.

- [ ] **Step 2 : Implémenter les trois fichiers**

```ts
// apps/backoffice/src/stores/bridgeSettingsStore.ts
// URL du print-bridge pour CETTE machine BO (localStorage) — miroir du pattern
// posSettingsStore.printerUrl côté POS. Spec §5.2.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface BridgeSettingsState {
  bridgeUrl: string;
  setBridgeUrl: (url: string) => void;
}

export const useBridgeSettingsStore = create<BridgeSettingsState>()(
  persist(
    (set) => ({ bridgeUrl: '', setBridgeUrl: (bridgeUrl) => set({ bridgeUrl }) }),
    { name: 'bo-bridge-settings' },
  ),
);

export function resolveBridgeUrl(): string {
  const url = useBridgeSettingsStore.getState().bridgeUrl.trim();
  return (url !== '' ? url : 'http://localhost:3001').replace(/\/+$/, '');
}
```

```ts
// apps/backoffice/src/features/lan-devices/utils/ipGuard.ts
// Copie client de la validation préfixe privé (le bridge revalide côté serveur).
const PREFIX_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export function isPrivatePrefix(prefix: string): boolean {
  const m = PREFIX_RE.exec(prefix);
  if (!m) return false;
  const [a, b, c] = m.slice(1).map(Number);
  if (a > 255 || b > 255 || c > 255) return false;
  if (a === 10 || a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}
```

```ts
// apps/backoffice/src/features/lan-devices/api/bridgeApi.ts
// Client HTTP du print-bridge (spec §4.2/§5). Erreur réseau → 'bridge_unreachable'
// pour un message UI unique et actionnable.

export interface ScanDeviceHit { ip: string; port: number; latencyMs: number; }
export interface ScanResponse { devices: ScanDeviceHit[]; hostsScanned: number; durationMs: number; }
export interface ProbeResponse { reachable: boolean; latencyMs?: number; }
export interface BridgePrinterTarget { ip_address: string; port: number; }

async function bridgeFetch(url: string, init?: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new Error('bridge_unreachable');
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `bridge_http_${res.status}`);
  }
  return res;
}

export async function scanPrinters(bridgeUrl: string, prefix: string, signal?: AbortSignal): Promise<ScanResponse> {
  const res = await bridgeFetch(
    `${bridgeUrl}/scan/printers?prefix=${encodeURIComponent(prefix)}&timeout=500`,
    { method: 'GET', signal },
  );
  return (await res.json()) as ScanResponse;
}

export async function probePrinter(bridgeUrl: string, ip: string, port: number): Promise<ProbeResponse> {
  const res = await bridgeFetch(
    `${bridgeUrl}/status/probe?ip=${encodeURIComponent(ip)}&port=${port}`,
    { method: 'GET' },
  );
  return (await res.json()) as ProbeResponse;
}

export async function sendTestTicket(
  bridgeUrl: string,
  printer: BridgePrinterTarget,
  station: string,
): Promise<{ success: boolean; error?: string }> {
  const res = await bridgeFetch(`${bridgeUrl}/print/ticket`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      printer,
      kind: 'prep',
      role: station,
      order_number: 'TEST',
      created_at: new Date().toISOString(),
      server_name: 'Backoffice',
      items: [{ name: 'Test ticket — LAN Devices', quantity: 1 }],
    }),
  });
  return (await res.json()) as { success: boolean; error?: string };
}
```

- [ ] **Step 3 : Run PASS + commit**

```bash
pnpm --filter @breakery/app-backoffice test bridge-api
git add apps/backoffice/src/stores/bridgeSettingsStore.ts apps/backoffice/src/features/lan-devices/utils apps/backoffice/src/features/lan-devices/api apps/backoffice/src/features/lan-devices/__tests__/bridge-api.test.ts
git commit -m "feat(backoffice): store URL print-bridge + client HTTP scan/probe/test-ticket"
```

---

### Task 11 : BO — hooks d'écriture `lan_devices` (upsert + soft-delete)

**Files:**
- Create: `apps/backoffice/src/features/lan-devices/hooks/useUpsertLanDevice.ts`, `apps/backoffice/src/features/lan-devices/hooks/useDeleteLanDevice.ts`
- Test: `apps/backoffice/src/features/lan-devices/__tests__/upsert-hook.test.ts`

**Interfaces:**
- Consumes: `LanDeviceRow`, `LanDeviceType`, `LAN_DEVICES_KEY` (`hooks/useLanDevices.ts` existant), `supabase` (`@/lib/supabase.js`).
- Produces:
  - `LanDeviceInput = { id?: string; code: string; name: string; device_type: LanDeviceType; ip_address: string | null; port: number | null; location: string | null; is_active: boolean; station: string | null; existingCapabilities?: Record<string, unknown> }`
  - `useUpsertLanDevice(): UseMutationResult<void, Error, LanDeviceInput>` — INSERT si pas d'`id`, UPDATE sinon ; `capabilities` = merge de `existingCapabilities` avec la clé `station` posée/retirée ; erreur code 23505 → `Error('code_taken')` ; invalide `LAN_DEVICES_KEY`.
  - `useDeleteLanDevice(): UseMutationResult<void, Error, { id: string }>` — `UPDATE deleted_at = now ISO` ; invalide `LAN_DEVICES_KEY`.
  - Consommés par Tasks 12/13/15.

- [ ] **Step 1 : Test failing**

```ts
// apps/backoffice/src/features/lan-devices/__tests__/upsert-hook.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const inserted: unknown[] = [];
const updated: Array<{ patch: unknown; id: string }> = [];
let nextError: { code: string; message: string } | null = null;

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    from: (table: string) => {
      expect(table).toBe('lan_devices');
      return {
        insert: (row: unknown) => {
          inserted.push(row);
          return Promise.resolve({ error: nextError });
        },
        update: (patch: unknown) => ({
          eq: (_col: string, id: string) => {
            updated.push({ patch, id });
            return Promise.resolve({ error: nextError });
          },
        }),
      };
    },
  },
}));

import { useUpsertLanDevice } from '../hooks/useUpsertLanDevice.js';
import { useDeleteLanDevice } from '../hooks/useDeleteLanDevice.js';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => { inserted.length = 0; updated.length = 0; nextError = null; });

describe('useUpsertLanDevice', () => {
  it('INSERTs a printer with capabilities.station', async () => {
    const { result } = renderHook(() => useUpsertLanDevice(), { wrapper });
    result.current.mutate({
      code: 'PRN-KITCHEN-1', name: 'Kitchen printer', device_type: 'printer',
      ip_address: '192.168.1.60', port: 9100, location: 'kitchen', is_active: true, station: 'kitchen',
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(inserted[0]).toMatchObject({
      code: 'PRN-KITCHEN-1', device_type: 'printer', ip_address: '192.168.1.60',
      port: 9100, capabilities: { station: 'kitchen' },
    });
  });

  it('UPDATEs by id, merging existing capabilities and dropping station when null', async () => {
    const { result } = renderHook(() => useUpsertLanDevice(), { wrapper });
    result.current.mutate({
      id: 'dev-1', code: 'KDS-1', name: 'KDS', device_type: 'kds',
      ip_address: null, port: null, location: null, is_active: true, station: null,
      existingCapabilities: { station: 'kitchen', print_widths: [80] },
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(updated[0]!.id).toBe('dev-1');
    expect(updated[0]!.patch).toMatchObject({ capabilities: { print_widths: [80] } });
    expect((updated[0]!.patch as { capabilities: Record<string, unknown> }).capabilities).not.toHaveProperty('station');
  });

  it('maps 23505 to code_taken', async () => {
    nextError = { code: '23505', message: 'duplicate key value violates unique constraint' };
    const { result } = renderHook(() => useUpsertLanDevice(), { wrapper });
    result.current.mutate({
      code: 'DUP', name: 'x', device_type: 'pos',
      ip_address: null, port: null, location: null, is_active: true, station: null,
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('code_taken');
  });
});

describe('useDeleteLanDevice', () => {
  it('soft-deletes by setting deleted_at', async () => {
    const { result } = renderHook(() => useDeleteLanDevice(), { wrapper });
    result.current.mutate({ id: 'dev-9' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(updated[0]!.id).toBe('dev-9');
    expect((updated[0]!.patch as { deleted_at: string }).deleted_at).toMatch(/^\d{4}-/);
  });
});
```

Run : `pnpm --filter @breakery/app-backoffice test upsert-hook` → FAIL.

- [ ] **Step 2 : Implémenter les deux hooks**

```ts
// apps/backoffice/src/features/lan-devices/hooks/useUpsertLanDevice.ts
// Writes directs sous la RLS lan.devices.manage (design S13 — spec D8, pas de RPC).
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { LAN_DEVICES_KEY, type LanDeviceType } from './useLanDevices.js';

export interface LanDeviceInput {
  id?: string;
  code: string;
  name: string;
  device_type: LanDeviceType;
  ip_address: string | null;
  port: number | null;
  location: string | null;
  is_active: boolean;
  /** printer only — écrit dans capabilities.station ; null = retire la clé. */
  station: string | null;
  /** capabilities actuelles de la ligne (edit) — préservées par merge. */
  existingCapabilities?: Record<string, unknown>;
}

function buildCapabilities(input: LanDeviceInput): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...(input.existingCapabilities ?? {}) };
  if (input.device_type === 'printer' && input.station !== null && input.station !== '') {
    merged['station'] = input.station;
  } else {
    delete merged['station'];
  }
  return merged;
}

export function useUpsertLanDevice() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, LanDeviceInput>({
    mutationFn: async (input) => {
      const row = {
        code: input.code.trim(),
        name: input.name.trim(),
        device_type: input.device_type,
        ip_address: input.ip_address,
        port: input.port,
        location: input.location,
        is_active: input.is_active,
        capabilities: buildCapabilities(input),
      };
      const result = input.id !== undefined
        ? await supabase.from('lan_devices').update(row).eq('id', input.id)
        : await supabase.from('lan_devices').insert(row);
      if (result.error !== null) {
        throw new Error(result.error.code === '23505' ? 'code_taken' : result.error.message);
      }
    },
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: LAN_DEVICES_KEY }); },
  });
}
```

```ts
// apps/backoffice/src/features/lan-devices/hooks/useDeleteLanDevice.ts
// Soft-delete (deleted_at) — la ligne disparaît des listes BO/POS qui filtrent deleted_at IS NULL.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { LAN_DEVICES_KEY } from './useLanDevices.js';

export function useDeleteLanDevice() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, { id: string }>({
    mutationFn: async ({ id }) => {
      const { error } = await supabase
        .from('lan_devices')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id);
      if (error !== null) throw new Error(error.message);
    },
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: LAN_DEVICES_KEY }); },
  });
}
```

Note : si `supabase.from('lan_devices')` refuse le typage (table absente de `types.generated.ts`), suivre le précédent du hook existant (`useLanDevices.ts` liste : cast local) — mais vérifier d'abord, `apps/backoffice/src/features/devices/hooks/useLanDevices.ts` fait un select typé sans cast.

- [ ] **Step 3 : Run PASS + commit**

```bash
pnpm --filter @breakery/app-backoffice test upsert-hook
git add apps/backoffice/src/features/lan-devices/hooks/useUpsertLanDevice.ts apps/backoffice/src/features/lan-devices/hooks/useDeleteLanDevice.ts apps/backoffice/src/features/lan-devices/__tests__/upsert-hook.test.ts
git commit -m "feat(backoffice): hooks upsert/soft-delete lan_devices sous RLS lan.devices.manage"
```

---

### Task 12 : BO — `LanDeviceFormModal`

**Files:**
- Create: `apps/backoffice/src/features/lan-devices/components/LanDeviceFormModal.tsx`
- Test: `apps/backoffice/src/features/lan-devices/__tests__/lan-device-form.smoke.test.tsx`

**Interfaces:**
- Consumes: `useUpsertLanDevice`/`LanDeviceInput` (T11), `LanDeviceRow` (hook existant), `Dialog/DialogContent/DialogHeader/DialogTitle/DialogDescription/DialogFooter, Button, Input` (`@breakery/ui`), `toast` (`sonner`).
- Produces: `LanDeviceFormModal({ open, onClose, device, prefill, allDevices }: { open: boolean; onClose: () => void; device: LanDeviceRow | null; prefill: { ip_address: string; port: number } | null; allDevices: LanDeviceRow[] })` — consommé par Task 15. `device` non-null = edit ; `prefill` non-null = ajout depuis le scan.

- [ ] **Step 1 : Test failing**

```tsx
// apps/backoffice/src/features/lan-devices/__tests__/lan-device-form.smoke.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { LanDeviceRow } from '../hooks/useLanDevices.js';

const mutate = vi.fn();
vi.mock('../hooks/useUpsertLanDevice.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../hooks/useUpsertLanDevice.js')>();
  return { ...mod, useUpsertLanDevice: () => ({ mutate, isPending: false }) };
});

import { LanDeviceFormModal } from '../components/LanDeviceFormModal.js';

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

function row(over: Partial<LanDeviceRow>): LanDeviceRow {
  return {
    id: 'r1', code: 'X', name: 'X', device_type: 'printer', ip_address: '192.168.1.61',
    port: 9100, location: null, is_active: true, last_heartbeat_at: null,
    capabilities: { station: 'barista' }, created_at: '', updated_at: '', deleted_at: null,
    ...over,
  };
}

beforeEach(() => mutate.mockClear());

describe('LanDeviceFormModal', () => {
  it('shows the station select only for printers', () => {
    render(wrap(<LanDeviceFormModal open onClose={() => {}} device={null} prefill={null} allDevices={[]} />));
    // défaut = printer → station visible
    expect(screen.getByLabelText(/station/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/device type/i), { target: { value: 'kds' } });
    expect(screen.queryByLabelText(/station/i)).not.toBeInTheDocument();
  });

  it('prefills ip/port from a scan hit and submits capabilities.station', () => {
    render(wrap(
      <LanDeviceFormModal open onClose={() => {}} device={null}
        prefill={{ ip_address: '192.168.1.60', port: 9100 }} allDevices={[]} />,
    ));
    expect(screen.getByLabelText(/ip address/i)).toHaveValue('192.168.1.60');
    fireEvent.change(screen.getByLabelText(/^code/i), { target: { value: 'PRN-KITCHEN-1' } });
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'Kitchen printer' } });
    fireEvent.change(screen.getByLabelText(/station/i), { target: { value: 'kitchen' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'PRN-KITCHEN-1', ip_address: '192.168.1.60', port: 9100, station: 'kitchen' }),
      expect.anything(),
    );
  });

  it('warns (non-blocking) when another active printer already has the station', () => {
    render(wrap(
      <LanDeviceFormModal open onClose={() => {}} device={null} prefill={null}
        allDevices={[row({ id: 'other', capabilities: { station: 'kitchen' } })]} />,
    ));
    fireEvent.change(screen.getByLabelText(/station/i), { target: { value: 'kitchen' } });
    expect(screen.getByText(/already assigned/i)).toBeInTheDocument();
    // non bloquant : le bouton Save reste actif
    expect(screen.getByRole('button', { name: /save/i })).toBeEnabled();
  });

  it('requires ip+port for printers', () => {
    render(wrap(<LanDeviceFormModal open onClose={() => {}} device={null} prefill={null} allDevices={[]} />));
    fireEvent.change(screen.getByLabelText(/^code/i), { target: { value: 'PRN-1' } });
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'P' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(mutate).not.toHaveBeenCalled();
    expect(screen.getByText(/ip address and port are required/i)).toBeInTheDocument();
  });
});
```

Run : `pnpm --filter @breakery/app-backoffice test lan-device-form` → FAIL.

- [ ] **Step 2 : Implémenter le modal**

```tsx
// apps/backoffice/src/features/lan-devices/components/LanDeviceFormModal.tsx
// Create/edit d'un lan_device (spec §5.1). Station visible seulement pour les
// imprimantes ; capabilities mergées (jamais écrasées) ; warning non bloquant
// si une autre imprimante active porte déjà la station (useStationPrinters
// n'en garde qu'une par station côté POS).
import { useEffect, useMemo, useState, type JSX } from 'react';
import { toast } from 'sonner';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
  Button, Input,
} from '@breakery/ui';
import type { LanDeviceRow, LanDeviceType } from '../hooks/useLanDevices.js';
import { useUpsertLanDevice } from '../hooks/useUpsertLanDevice.js';

const DEVICE_TYPES: LanDeviceType[] = ['printer', 'kds', 'tablet', 'pos', 'kiosk_display'];
const STATIONS = ['kitchen', 'barista', 'display', 'cashier', 'waiter'] as const;

export interface LanDeviceFormModalProps {
  open: boolean;
  onClose: () => void;
  device: LanDeviceRow | null; // non-null = edit
  prefill: { ip_address: string; port: number } | null; // depuis le scan
  allDevices: LanDeviceRow[];
}

export function LanDeviceFormModal({ open, onClose, device, prefill, allDevices }: LanDeviceFormModalProps): JSX.Element {
  const upsert = useUpsertLanDevice();

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [deviceType, setDeviceType] = useState<LanDeviceType>('printer');
  const [ip, setIp] = useState('');
  const [port, setPort] = useState('');
  const [location, setLocation] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [station, setStation] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    setCode(device?.code ?? '');
    setName(device?.name ?? '');
    setDeviceType(device?.device_type ?? 'printer');
    setIp(device?.ip_address ?? prefill?.ip_address ?? '');
    setPort(device?.port !== null && device?.port !== undefined ? String(device.port) : prefill ? String(prefill.port) : '');
    setLocation(device?.location ?? '');
    setIsActive(device?.is_active ?? true);
    setStation(typeof device?.capabilities?.['station'] === 'string' ? (device.capabilities['station'] as string) : '');
  }, [open, device, prefill]);

  const stationConflict = useMemo(() => {
    if (deviceType !== 'printer' || station === '' || !isActive) return null;
    return allDevices.find(
      (d) => d.id !== device?.id && d.device_type === 'printer' && d.is_active
        && d.deleted_at === null && d.capabilities?.['station'] === station,
    ) ?? null;
  }, [allDevices, device?.id, deviceType, station, isActive]);

  function submit(): void {
    if (code.trim() === '' || name.trim() === '') {
      setFormError('Code and name are required.');
      return;
    }
    const portNum = port.trim() === '' ? null : Number(port);
    if (deviceType === 'printer' && (ip.trim() === '' || portNum === null || !Number.isInteger(portNum))) {
      setFormError('IP address and port are required for printers.');
      return;
    }
    upsert.mutate(
      {
        ...(device !== null ? { id: device.id, existingCapabilities: device.capabilities } : {}),
        code, name, device_type: deviceType,
        ip_address: ip.trim() === '' ? null : ip.trim(),
        port: portNum,
        location: location.trim() === '' ? null : location.trim(),
        is_active: isActive,
        station: deviceType === 'printer' && station !== '' ? station : null,
      },
      {
        onSuccess: () => { toast.success(device !== null ? 'Device updated' : 'Device added'); onClose(); },
        onError: (err) => {
          setFormError(err.message === 'code_taken' ? 'This device code is already in use.' : err.message);
        },
      },
    );
  }

  const selectCls = 'w-full rounded border border-border-subtle bg-bg-overlay px-3 py-2 text-sm';
  const labelCls = 'block font-bold uppercase tracking-widest text-text-muted text-xs mb-1';

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{device !== null ? 'Edit device' : 'Add device'}</DialogTitle>
          <DialogDescription>
            Registered devices drive heartbeats, KDS and station printing.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label htmlFor="dev-code" className={labelCls}>Code</label>
            <Input id="dev-code" aria-label="Code" placeholder="e.g. PRN-KITCHEN-1"
              value={code} onChange={(e) => setCode(e.target.value)} />
          </div>
          <div>
            <label htmlFor="dev-name" className={labelCls}>Name</label>
            <Input id="dev-name" aria-label="Name" placeholder="e.g. Kitchen printer"
              value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label htmlFor="dev-type" className={labelCls}>Device type</label>
            <select id="dev-type" aria-label="Device type" className={selectCls}
              value={deviceType} onChange={(e) => setDeviceType(e.target.value as LanDeviceType)}>
              {DEVICE_TYPES.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="dev-ip" className={labelCls}>IP address</label>
              <Input id="dev-ip" aria-label="IP address" placeholder="192.168.1.60"
                value={ip} onChange={(e) => setIp(e.target.value)} />
            </div>
            <div>
              <label htmlFor="dev-port" className={labelCls}>Port</label>
              <Input id="dev-port" aria-label="Port" placeholder="9100" inputMode="numeric"
                value={port} onChange={(e) => setPort(e.target.value)} />
            </div>
          </div>
          {deviceType === 'printer' && (
            <div>
              <label htmlFor="dev-station" className={labelCls}>Station</label>
              <select id="dev-station" aria-label="Station" className={selectCls}
                value={station} onChange={(e) => setStation(e.target.value)}>
                <option value="">— none —</option>
                {STATIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              {stationConflict !== null && (
                <p className="text-xs text-warning mt-1">
                  Station “{station}” is already assigned to {stationConflict.code}. Only one active
                  printer per station is used by the POS.
                </p>
              )}
            </div>
          )}
          <div>
            <label htmlFor="dev-location" className={labelCls}>Location</label>
            <Input id="dev-location" aria-label="Location" placeholder="e.g. kitchen"
              value={location} onChange={(e) => setLocation(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            Active
          </label>
          {formError !== null && <p className="text-sm text-state-danger">{formError}</p>}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={upsert.isPending}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

Note tokens : `text-warning` / `text-state-danger` — vérifier les tokens exacts disponibles dans le thème BO (`LanDevicesTable` utilise `text-state-danger`, `bg-state-danger-soft`) ; **zéro hex neuf** (règle S57).

- [ ] **Step 3 : Run PASS + commit**

```bash
pnpm --filter @breakery/app-backoffice test lan-device-form
git add apps/backoffice/src/features/lan-devices/components/LanDeviceFormModal.tsx apps/backoffice/src/features/lan-devices/__tests__/lan-device-form.smoke.test.tsx
git commit -m "feat(backoffice): form modal CRUD lan_devices (station conditionnelle, warning doublon)"
```

---

### Task 13 : BO — `LanDevicesTable` enrichie (IP/station/actions/Test)

**Files:**
- Modify: `apps/backoffice/src/features/lan-devices/components/LanDevicesTable.tsx`
- Modify: `apps/backoffice/src/features/lan-devices/__tests__/LanDevicesTable.smoke.test.tsx`

**Interfaces:**
- Consumes: `useDeleteLanDevice` (T11), `probePrinter/sendTestTicket` (T10), `resolveBridgeUrl` (T10), `useAuthStore` (`@/stores/authStore.js`) pour `hasPermission('lan.devices.manage')`.
- Produces: `LanDevicesTable({ onEdit }: { onEdit: (device: LanDeviceRow) => void })` — nouvelle prop obligatoire, consommée par Task 15.

- [ ] **Step 1 : Étendre le smoke test existant (failing)**

Ajouter au describe existant (et passer `onEdit={vi.fn()}` aux deux tests existants) :

```tsx
// ... imports existants +
import * as authMod from '@/stores/authStore.js';

it('shows IP:port and station for printers', () => {
  vi.spyOn(devicesMod, 'useLanDevices').mockReturnValue(fakeQuery([
    {
      id: 'd2', code: 'PRN-01', name: 'Kitchen printer', device_type: 'printer',
      ip_address: '192.168.1.20', port: 9100, location: 'kitchen', is_active: true,
      last_heartbeat_at: null, capabilities: { station: 'kitchen' },
      created_at: '', updated_at: '', deleted_at: null,
    },
  ]));
  render(wrap(<LanDevicesTable onEdit={vi.fn()} />));
  expect(screen.getByText('192.168.1.20:9100')).toBeInTheDocument();
  expect(screen.getByText('kitchen', { selector: 'span' })).toBeInTheDocument();
});

it('hides actions without lan.devices.manage', () => {
  vi.spyOn(authMod, 'useAuthStore').mockImplementation((sel: (s: unknown) => unknown) =>
    sel({ hasPermission: () => false }));
  vi.spyOn(devicesMod, 'useLanDevices').mockReturnValue(fakeQuery([
    { id: 'd1', code: 'POS-01', name: 'T', device_type: 'pos', ip_address: null, port: null,
      location: null, is_active: true, last_heartbeat_at: null, capabilities: {},
      created_at: '', updated_at: '', deleted_at: null },
  ]));
  render(wrap(<LanDevicesTable onEdit={vi.fn()} />));
  expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
});
```

⚠️ Le mock `useAuthStore` : si le store BO n'est pas spy-able tel quel (zustand hook), utiliser `vi.mock('@/stores/authStore.js', ...)` module-level avec un state `hasPermission` contrôlable — suivre le pattern des smokes BO existants qui mockent authStore (chercher `vi.mock('@/stores/authStore` dans `apps/backoffice/src` et copier la forme).

Run : `pnpm --filter @breakery/app-backoffice test LanDevicesTable` → FAIL.

- [ ] **Step 2 : Réécrire `LanDevicesTable.tsx`**

```tsx
// apps/backoffice/src/features/lan-devices/components/LanDevicesTable.tsx
// S13 (read-only) → 2026-07-06 : + IP/station + actions Edit/Delete/Test
// (spec print-bridge §5.1). Actions gated lan.devices.manage.
import { useState, type JSX } from 'react';
import { toast } from 'sonner';
import { Pencil, Trash2, Radio, Loader2 } from 'lucide-react';
import { Button } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore.js';
import { resolveBridgeUrl } from '@/stores/bridgeSettingsStore.js';
import { probePrinter, sendTestTicket } from '../api/bridgeApi.js';
import { useLanDevices, type LanDeviceRow } from '../hooks/useLanDevices.js';
import { useDeleteLanDevice } from '../hooks/useDeleteLanDevice.js';

export function LanDevicesTable({ onEdit }: { onEdit: (device: LanDeviceRow) => void }): JSX.Element {
  const { data, isLoading, error } = useLanDevices();
  const canManage = useAuthStore((s) => s.hasPermission('lan.devices.manage'));
  const deleteDevice = useDeleteLanDevice();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);

  async function runTest(d: LanDeviceRow): Promise<void> {
    if (d.ip_address === null || d.port === null) {
      toast.error('This printer has no IP/port configured.');
      return;
    }
    setTestingId(d.id);
    try {
      const bridge = resolveBridgeUrl();
      const probe = await probePrinter(bridge, d.ip_address, d.port);
      if (!probe.reachable) {
        toast.error(`${d.code}: printer unreachable on ${d.ip_address}:${d.port}`);
        return;
      }
      const station = typeof d.capabilities?.['station'] === 'string' ? (d.capabilities['station'] as string) : 'kitchen';
      const res = await sendTestTicket(bridge, { ip_address: d.ip_address, port: d.port }, station);
      if (res.success) toast.success(`${d.code}: test ticket sent (${probe.latencyMs ?? '?'} ms)`);
      else toast.error(`${d.code}: print failed — ${res.error ?? 'unknown'}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown';
      toast.error(msg === 'bridge_unreachable'
        ? 'Print-bridge unreachable — check the bridge URL and that the service is running.'
        : `Test failed: ${msg}`);
    } finally {
      setTestingId(null);
    }
  }

  if (isLoading) return <div className="text-sm text-text-secondary">Loading LAN devices…</div>;
  if (error !== null) {
    return <div className="text-sm text-state-danger">Failed to load LAN devices: {(error as Error).message}</div>;
  }

  const rows = data ?? [];
  if (rows.length === 0) {
    return (
      <div className="text-sm text-text-secondary">
        No LAN devices registered yet. Add one manually or run a network scan above.
      </div>
    );
  }

  return (
    <table className="w-full text-sm">
      <thead className="text-xs uppercase text-text-secondary border-b border-border-subtle">
        <tr>
          <th className="py-2 text-left">Code</th>
          <th className="py-2 text-left">Name</th>
          <th className="py-2 text-left">Type</th>
          <th className="py-2 text-left">IP : Port</th>
          <th className="py-2 text-left">Station</th>
          <th className="py-2 text-left">Status</th>
          <th className="py-2 text-left">Last heartbeat</th>
          {canManage && <th className="py-2 text-right">Actions</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((d) => {
          const isStale = d.last_heartbeat_at === null
            ? true
            : Date.now() - new Date(d.last_heartbeat_at).getTime() > 60_000;
          const station = typeof d.capabilities?.['station'] === 'string' ? (d.capabilities['station'] as string) : null;
          return (
            <tr key={d.id} className="border-b border-border-subtle">
              <td className="py-2 font-mono text-xs">{d.code}</td>
              <td className="py-2">{d.name}</td>
              <td className="py-2 capitalize">{d.device_type.replace('_', ' ')}</td>
              <td className="py-2 font-mono text-xs">
                {d.ip_address !== null ? `${d.ip_address}${d.port !== null ? `:${d.port}` : ''}` : '—'}
              </td>
              <td className="py-2">
                {station !== null
                  ? <span className="inline-block px-2 py-0.5 rounded text-xs bg-bg-overlay">{station}</span>
                  : '—'}
              </td>
              <td className="py-2">
                <span className={`inline-block px-2 py-0.5 rounded text-xs ${
                  isStale ? 'bg-state-danger-soft text-state-danger' : 'bg-state-success-soft text-state-success'
                }`}>
                  {isStale ? 'stale' : 'online'}
                </span>
              </td>
              <td className="py-2 font-mono text-xs">
                {d.last_heartbeat_at !== null ? new Date(d.last_heartbeat_at).toLocaleString() : 'never'}
              </td>
              {canManage && (
                <td className="py-2 text-right space-x-1 whitespace-nowrap">
                  {d.device_type === 'printer' && (
                    <Button variant="secondary" size="sm" aria-label={`Test ${d.code}`}
                      disabled={testingId === d.id} onClick={() => void runTest(d)}>
                      {testingId === d.id
                        ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                        : <Radio className="h-4 w-4" aria-hidden />}
                      Test
                    </Button>
                  )}
                  <Button variant="secondary" size="sm" aria-label={`Edit ${d.code}`} onClick={() => onEdit(d)}>
                    <Pencil className="h-4 w-4" aria-hidden /> Edit
                  </Button>
                  {confirmingId === d.id ? (
                    <Button variant="danger" size="sm" aria-label={`Confirm delete ${d.code}`}
                      disabled={deleteDevice.isPending}
                      onClick={() => deleteDevice.mutate({ id: d.id }, {
                        onSuccess: () => { toast.success(`${d.code} removed`); setConfirmingId(null); },
                        onError: (e) => { toast.error(e.message); setConfirmingId(null); },
                      })}>
                      Confirm?
                    </Button>
                  ) : (
                    <Button variant="secondary" size="sm" aria-label={`Delete ${d.code}`}
                      onClick={() => setConfirmingId(d.id)}>
                      <Trash2 className="h-4 w-4" aria-hidden /> Delete
                    </Button>
                  )}
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
```

Note : vérifier que `Button` accepte `variant="danger"` dans `@breakery/ui` — sinon utiliser le variant destructif existant du kit (chercher un précédent, ex. modals de suppression produits).

- [ ] **Step 3 : Run PASS + commit**

```bash
pnpm --filter @breakery/app-backoffice test LanDevicesTable
git add apps/backoffice/src/features/lan-devices/components/LanDevicesTable.tsx apps/backoffice/src/features/lan-devices/__tests__/LanDevicesTable.smoke.test.tsx
git commit -m "feat(backoffice): table LAN devices — IP/station + actions Edit/Delete/Test gated manage"
```

---

### Task 14 : BO — `ScanPanel`

**Files:**
- Create: `apps/backoffice/src/features/lan-devices/components/ScanPanel.tsx`
- Test: `apps/backoffice/src/features/lan-devices/__tests__/scan-panel.smoke.test.tsx`

**Interfaces:**
- Consumes: `useBridgeSettingsStore/resolveBridgeUrl` (T10), `scanPrinters/ScanDeviceHit` (T10), `isPrivatePrefix` (T10), `LanDeviceRow`.
- Produces: `ScanPanel({ devices, onAdd }: { devices: LanDeviceRow[]; onAdd: (prefill: { ip_address: string; port: number }) => void })` — consommé par Task 15.

- [ ] **Step 1 : Test failing**

```tsx
// apps/backoffice/src/features/lan-devices/__tests__/scan-panel.smoke.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { LanDeviceRow } from '../hooks/useLanDevices.js';
import { ScanPanel } from '../components/ScanPanel.js';

afterEach(() => vi.restoreAllMocks());

function device(over: Partial<LanDeviceRow>): LanDeviceRow {
  return {
    id: 'd1', code: 'PRN-01', name: 'P', device_type: 'printer', ip_address: '192.168.1.60',
    port: 9100, location: null, is_active: true, last_heartbeat_at: null, capabilities: {},
    created_at: '', updated_at: '', deleted_at: null, ...over,
  };
}

function stubScan(devices: Array<{ ip: string; port: number; latencyMs: number }>) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ devices, hostsScanned: 254, durationMs: 900 }), { status: 200 }),
  ));
}

describe('ScanPanel', () => {
  it('scans and lists hits with an Add button', async () => {
    stubScan([{ ip: '192.168.1.61', port: 9100, latencyMs: 7 }]);
    const onAdd = vi.fn();
    render(<ScanPanel devices={[]} onAdd={onAdd} />);
    fireEvent.click(screen.getByRole('button', { name: /scan network/i }));
    await waitFor(() => expect(screen.getByText('192.168.1.61:9100')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /add/i }));
    expect(onAdd).toHaveBeenCalledWith({ ip_address: '192.168.1.61', port: 9100 });
  });

  it('flags already-configured printers by IP', async () => {
    stubScan([{ ip: '192.168.1.60', port: 9100, latencyMs: 4 }]);
    render(<ScanPanel devices={[device({})]} onAdd={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /scan network/i }));
    await waitFor(() => expect(screen.getByText(/already configured/i)).toBeInTheDocument());
    expect(screen.getByText(/PRN-01/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^add$/i })).not.toBeInTheDocument();
  });

  it('shows the empty state after a scan with no hits', async () => {
    stubScan([]);
    render(<ScanPanel devices={[]} onAdd={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /scan network/i }));
    await waitFor(() => expect(screen.getByText(/no printer found/i)).toBeInTheDocument());
  });

  it('rejects a public prefix client-side', () => {
    render(<ScanPanel devices={[]} onAdd={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/network prefix/i), { target: { value: '8.8.8' } });
    fireEvent.click(screen.getByRole('button', { name: /scan network/i }));
    expect(screen.getByText(/private network prefix/i)).toBeInTheDocument();
  });

  it('surfaces bridge_unreachable with a hint', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    render(<ScanPanel devices={[]} onAdd={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /scan network/i }));
    await waitFor(() => expect(screen.getByText(/print-bridge unreachable/i)).toBeInTheDocument());
  });
});
```

Run : `pnpm --filter @breakery/app-backoffice test scan-panel` → FAIL.

- [ ] **Step 2 : Implémenter**

```tsx
// apps/backoffice/src/features/lan-devices/components/ScanPanel.tsx
// Scan réseau via le print-bridge (spec §5.2). Résultats croisés par IP avec
// les devices existants ; aucun auto-enregistrement — l'ajout passe par le form.
import { useRef, useState, type JSX } from 'react';
import { Loader2, Search, X } from 'lucide-react';
import { Button, Input } from '@breakery/ui';
import { useBridgeSettingsStore, resolveBridgeUrl } from '@/stores/bridgeSettingsStore.js';
import { scanPrinters, type ScanDeviceHit } from '../api/bridgeApi.js';
import { isPrivatePrefix } from '../utils/ipGuard.js';
import type { LanDeviceRow } from '../hooks/useLanDevices.js';

type ScanState = 'idle' | 'scanning' | 'done';

export function ScanPanel({ devices, onAdd }: {
  devices: LanDeviceRow[];
  onAdd: (prefill: { ip_address: string; port: number }) => void;
}): JSX.Element {
  const bridgeUrl = useBridgeSettingsStore((s) => s.bridgeUrl);
  const setBridgeUrl = useBridgeSettingsStore((s) => s.setBridgeUrl);
  const [prefix, setPrefix] = useState('192.168.1');
  const [state, setState] = useState<ScanState>('idle');
  const [hits, setHits] = useState<ScanDeviceHit[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  async function runScan(): Promise<void> {
    setErrorMsg(null);
    if (!isPrivatePrefix(prefix.trim())) {
      setErrorMsg('Enter a private network prefix (e.g. 192.168.1).');
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setState('scanning');
    setHits([]);
    try {
      const res = await scanPrinters(resolveBridgeUrl(), prefix.trim(), controller.signal);
      setHits(res.devices);
      setState('done');
    } catch (err) {
      if (controller.signal.aborted) { setState('idle'); return; }
      const msg = err instanceof Error ? err.message : 'unknown';
      setErrorMsg(msg === 'bridge_unreachable'
        ? 'Print-bridge unreachable — check the bridge URL below and that the service is running on the shop PC.'
        : `Scan failed: ${msg}`);
      setState('idle');
    } finally {
      abortRef.current = null;
    }
  }

  function cancel(): void {
    abortRef.current?.abort();
  }

  const byIp = new Map(devices.filter((d) => d.ip_address !== null).map((d) => [d.ip_address as string, d]));
  const labelCls = 'block font-bold uppercase tracking-widest text-text-muted text-xs mb-1';

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-2xl">
        <div>
          <label htmlFor="scan-bridge-url" className={labelCls}>Print-bridge URL</label>
          <Input id="scan-bridge-url" aria-label="Print-bridge URL" placeholder="http://localhost:3001"
            value={bridgeUrl} onChange={(e) => setBridgeUrl(e.target.value)} />
        </div>
        <div>
          <label htmlFor="scan-prefix" className={labelCls}>Network prefix</label>
          <Input id="scan-prefix" aria-label="Network prefix" placeholder="192.168.1"
            value={prefix} onChange={(e) => setPrefix(e.target.value)} />
        </div>
      </div>

      <div className="flex items-center gap-2">
        {state === 'scanning' ? (
          <>
            <Button variant="secondary" disabled>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Scanning…
            </Button>
            <Button variant="secondary" onClick={cancel}>
              <X className="h-4 w-4" aria-hidden /> Cancel
            </Button>
          </>
        ) : (
          <Button onClick={() => void runScan()}>
            <Search className="h-4 w-4" aria-hidden /> Scan network
          </Button>
        )}
      </div>

      {errorMsg !== null && <p className="text-sm text-state-danger">{errorMsg}</p>}

      {state === 'done' && hits.length === 0 && (
        <p className="text-sm text-text-secondary">
          No printer found on {prefix}.x — check the printer self-test page for its IP, or try
          another prefix.
        </p>
      )}

      {hits.length > 0 && (
        <table className="w-full text-sm max-w-2xl">
          <thead className="text-xs uppercase text-text-secondary border-b border-border-subtle">
            <tr>
              <th className="py-2 text-left">Address</th>
              <th className="py-2 text-left">Latency</th>
              <th className="py-2 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {hits.map((h) => {
              const existing = byIp.get(h.ip);
              return (
                <tr key={h.ip} className="border-b border-border-subtle">
                  <td className="py-2 font-mono text-xs">{h.ip}:{h.port}</td>
                  <td className="py-2 text-xs">{h.latencyMs} ms</td>
                  <td className="py-2 text-right">
                    {existing !== undefined ? (
                      <span className="text-xs text-text-secondary">
                        Already configured — {existing.code}
                      </span>
                    ) : (
                      <Button variant="secondary" size="sm"
                        onClick={() => onAdd({ ip_address: h.ip, port: h.port })}>
                        Add
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 3 : Run PASS + commit**

```bash
pnpm --filter @breakery/app-backoffice test scan-panel
git add apps/backoffice/src/features/lan-devices/components/ScanPanel.tsx apps/backoffice/src/features/lan-devices/__tests__/scan-panel.smoke.test.tsx
git commit -m "feat(backoffice): ScanPanel — scan réseau via print-bridge, ajout pré-rempli"
```

---

### Task 15 : BO — assemblage `LanDevicesPage`

**Files:**
- Modify: `apps/backoffice/src/pages/lan-devices/LanDevicesPage.tsx`

**Interfaces:**
- Consumes: `LanDevicesTable({ onEdit })` (T13), `ScanPanel({ devices, onAdd })` (T14), `LanDeviceFormModal` (T12), `useLanDevices`, `useAuthStore.hasPermission('lan.devices.manage')`.

- [ ] **Step 1 : Réécrire la page**

Garder les KPI existants tels quels ; ajouter l'état modal + les sections. Remplacer le corps du composant :

```tsx
// apps/backoffice/src/pages/lan-devices/LanDevicesPage.tsx
// S14 (read-only + KPIs) → 2026-07-06 : + CRUD (form modal), + ScanPanel
// print-bridge (spec 2026-07-06). Route gated lan.devices.read (inchangé) ;
// écritures gated lan.devices.manage.
import { useMemo, useState } from 'react';
import { Wifi, CheckCircle2, AlertTriangle, Printer, Plus } from 'lucide-react';
import { Button, Card, KpiTile, SectionLabel } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore.js';
import { LanDevicesTable } from '@/features/lan-devices/components/LanDevicesTable.js';
import { ScanPanel } from '@/features/lan-devices/components/ScanPanel.js';
import { LanDeviceFormModal } from '@/features/lan-devices/components/LanDeviceFormModal.js';
import { useLanDevices, type LanDeviceRow } from '@/features/lan-devices/hooks/useLanDevices.js';

export default function LanDevicesPage() {
  const { data } = useLanDevices();
  const canManage = useAuthStore((s) => s.hasPermission('lan.devices.manage'));
  const rows = data ?? [];

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<LanDeviceRow | null>(null);
  const [prefill, setPrefill] = useState<{ ip_address: string; port: number } | null>(null);

  const kpis = useMemo(() => {
    const now = Date.now();
    let online = 0, stale = 0, printers = 0;
    for (const d of rows) {
      const isStale = d.last_heartbeat_at === null
        ? true
        : now - new Date(d.last_heartbeat_at).getTime() > 60_000;
      if (isStale) stale++; else online++;
      if (d.device_type === 'printer') printers++;
    }
    return { total: rows.length, online, stale, printers };
  }, [rows]);

  function openCreate(): void { setEditing(null); setPrefill(null); setModalOpen(true); }
  function openEdit(device: LanDeviceRow): void { setEditing(device); setPrefill(null); setModalOpen(true); }
  function openFromScan(p: { ip_address: string; port: number }): void {
    setEditing(null); setPrefill(p); setModalOpen(true);
  }

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-serif">LAN Devices</h1>
          <p className="text-sm text-text-secondary">
            Devices participating in the on-site LAN. Printers registered here (with a station)
            receive the POS prep tickets; KDS/tablets/POS rows drive the heartbeat monitor.
          </p>
        </div>
        {canManage && (
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" aria-hidden /> Add device
          </Button>
        )}
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiTile label="Total devices" value={kpis.total}    icon={Wifi}          footer="Registered devices" />
        <KpiTile label="Online"        value={kpis.online}   icon={CheckCircle2}  footer="Heartbeat within 60s" />
        <KpiTile label="Stale"         value={kpis.stale}    icon={AlertTriangle} footer="No recent heartbeat" />
        <KpiTile label="Printers"      value={kpis.printers} icon={Printer}       footer="ESC/POS printers" />
      </div>

      {canManage && (
        <Card padding="md" className="space-y-3">
          <SectionLabel size="sm" as="h2">Network scan</SectionLabel>
          <ScanPanel devices={rows} onAdd={openFromScan} />
        </Card>
      )}

      <Card padding="md">
        <LanDevicesTable onEdit={openEdit} />
      </Card>

      <LanDeviceFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        device={editing}
        prefill={prefill}
        allDevices={rows}
      />
    </div>
  );
}
```

Note : vérifier la signature exacte de `SectionLabel` (`as="h2"` supporté — cf. PrintingSettingsTab qui documente `as=div|h2|h3|span|p`).

- [ ] **Step 2 : Vérifier suite BO complète**

```bash
pnpm --filter @breakery/app-backoffice test lan
pnpm --filter @breakery/app-backoffice typecheck
```
Attendu : tous les smokes lan-* PASS, typecheck exit 0.

- [ ] **Step 3 : Commit**

```bash
git add apps/backoffice/src/pages/lan-devices/LanDevicesPage.tsx
git commit -m "feat(backoffice): page LAN Devices — Add device + Network scan + form modal câblés"
```

---

### Task 16 : pgTAP — ancre RLS `lan_devices`

**Files:**
- Create: `supabase/tests/lan_devices_rls.test.sql`

**Interfaces:**
- Consumes: users seedés `00000000-0000-0000-0000-000000000001` (SUPER_ADMIN, a `lan.devices.manage`) et `00000000-0000-0000-0000-000000000002` (CASHIER, ne l'a pas) ; RPC `update_lan_heartbeat_v1` (migration `20260517000171`).

⚠️ **Exécution : contrôleur uniquement** (subagents sans MCP). Le fichier porte son enveloppe `BEGIN...ROLLBACK` ; l'exécuter via `mcp__plugin_supabase_supabase__execute_sql` (projet `ikcyvlovptebroadgtvd`) ou le runner API-from-file si trop gros.

- [ ] **Step 1 : Écrire la suite**

```sql
-- supabase/tests/lan_devices_rls.test.sql
-- 2026-07-06 (spec print-bridge D8) — ancre le design "CRUD BO = writes directs
-- sous RLS lan.devices.manage" (policies S13, migration 20260517000171).
-- Runner : MCP execute_sql, enveloppe BEGIN..ROLLBACK portée par ce fichier.
BEGIN;

CREATE TEMP TABLE _r(name TEXT PRIMARY KEY, pass BOOLEAN) ON COMMIT DROP;

-- Fixture (en tant que postgres, bypass RLS) : un device témoin.
DO $$
DECLARE v_code TEXT := 'TEST-RLS-' || substr(gen_random_uuid()::text, 1, 8);
BEGIN
  INSERT INTO lan_devices (code, name, device_type, ip_address, port, capabilities)
  VALUES (v_code, 'RLS fixture printer', 'printer', '192.168.1.250', 9100, '{"station":"kitchen"}'::jsonb);
  PERFORM set_config('breakery.lanrls_code', v_code, true);
END $$;

-- ── En tant que CASHIER (pas lan.devices.manage) ────────────────────────────
DO $$ BEGIN
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', '00000000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
END $$;
SET LOCAL ROLE authenticated;

-- T1 : INSERT refusé (WITH CHECK → 42501).
DO $$ BEGIN
  INSERT INTO lan_devices (code, name, device_type) VALUES ('TEST-RLS-DENY', 'x', 'pos');
  INSERT INTO _r VALUES ('t1_insert_denied', false);
EXCEPTION WHEN insufficient_privilege THEN
  INSERT INTO _r VALUES ('t1_insert_denied', true);
WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t1_insert_denied', false);
END $$;

-- T2 : UPDATE silencieusement filtré (USING → 0 ligne touchée).
DO $$
DECLARE n INT;
BEGIN
  UPDATE lan_devices SET name = 'hacked'
   WHERE code = current_setting('breakery.lanrls_code');
  GET DIAGNOSTICS n = ROW_COUNT;
  INSERT INTO _r VALUES ('t2_update_filtered', n = 0);
EXCEPTION WHEN OTHERS THEN
  -- un 42501 (pas de GRANT UPDATE colonne) vaut aussi refus
  INSERT INTO _r VALUES ('t2_update_filtered', SQLSTATE = '42501');
END $$;

-- T3 : SELECT libre pour authenticated (policy USING true).
DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM lan_devices WHERE code = current_setting('breakery.lanrls_code');
  INSERT INTO _r VALUES ('t3_select_open', n = 1);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t3_select_open', false);
END $$;

RESET ROLE;

-- ── En tant que SUPER_ADMIN (a lan.devices.manage) ──────────────────────────
DO $$ BEGIN
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', '00000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
END $$;
SET LOCAL ROLE authenticated;

-- T4 : INSERT autorisé.
DO $$ BEGIN
  INSERT INTO lan_devices (code, name, device_type, ip_address, port, capabilities)
  VALUES ('TEST-RLS-ADMIN-' || substr(gen_random_uuid()::text, 1, 8),
          'Admin insert', 'printer', '192.168.1.251', 9100, '{"station":"barista"}'::jsonb);
  INSERT INTO _r VALUES ('t4_admin_insert', true);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t4_admin_insert', false);
END $$;

-- T5 : UPDATE (soft-delete) autorisé et effectif.
DO $$
DECLARE n INT;
BEGIN
  UPDATE lan_devices SET deleted_at = now()
   WHERE code = current_setting('breakery.lanrls_code');
  GET DIAGNOSTICS n = ROW_COUNT;
  INSERT INTO _r VALUES ('t5_admin_softdelete', n = 1);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t5_admin_softdelete', false);
END $$;

RESET ROLE;

-- T6 : update_lan_heartbeat_v1 — P0002 sur un code soft-deleted (le fixture
-- vient d'être soft-deleted en T5 : le heartbeat ne doit plus le voir).
DO $$ BEGIN
  PERFORM update_lan_heartbeat_v1(current_setting('breakery.lanrls_code'));
  INSERT INTO _r VALUES ('t6_heartbeat_deleted_p0002', false);
EXCEPTION WHEN SQLSTATE 'P0002' THEN
  INSERT INTO _r VALUES ('t6_heartbeat_deleted_p0002', true);
WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t6_heartbeat_deleted_p0002', false);
END $$;

SELECT format('lan_devices_rls: %s/%s pass', count(*) FILTER (WHERE pass), count(*)) AS result,
       COALESCE(array_agg(name) FILTER (WHERE NOT pass), '{}') AS failures
  FROM _r;

ROLLBACK;
```

- [ ] **Step 2 : Exécuter (CONTRÔLEUR) via MCP**

Contrôleur : `mcp__plugin_supabase_supabase__execute_sql` avec le contenu du fichier, projet `ikcyvlovptebroadgtvd`. Attendu : `lan_devices_rls: 6/6 pass`, `failures = {}`.

Si T1 échoue avec « permission denied for table lan_devices » AVANT la policy (GRANT manquant pour `authenticated`) : c'est un fait de schéma à documenter — dans ce cas le CRUD BO ne peut pas marcher non plus ; STOP et remonter au propriétaire (une migration GRANT serait alors nécessaire, hors périmètre de ce plan qui promet zéro migration).

- [ ] **Step 3 : Commit**

```bash
git add supabase/tests/lan_devices_rls.test.sql
git commit -m "test(supabase): ancre RLS lan_devices — manage requis en écriture, select libre, heartbeat P0002"
```

---

### Task 17 : Closeout — suite monorepo + docs

**Files:**
- Modify: `CLAUDE.md` (section Active Workplan)
- Create: `docs/workplan/plans/2026-07-06-session-65-INDEX.md` (si exécuté comme session S65)

- [ ] **Step 1 : Suite complète**

```bash
pnpm typecheck && pnpm build && pnpm test
```
Attendu : exit 0 partout (bridge inclus dans turbo). Toute rouge = investiguer avant closeout (baseline env-gated connue exclue).

- [ ] **Step 2 : Vérifier le POS en vrai (manuel, optionnel mais recommandé)**

Sur une machine avec une imprimante réseau : lancer `pnpm --filter @breakery/print-bridge dev`, pointer POS Settings → Devices sur `http://<ip>:3001`, Test connection → Reachable, Test print → ticket sort. BO → LAN Devices → Scan network → l'imprimante apparaît.

- [ ] **Step 3 : Docs + commit final**

- CLAUDE.md « Active Workplan » : ajouter la ligne merged S65 (print-bridge versionné, scan+CRUD LAN Devices, action S60 promotions[] fermée, D4/D7/D8 actées) et retirer « template print-bridge externe à MAJ » des actions ouvertes.
- INDEX de session : déviations numérotées (dont la déviation `DRAWER_PULSE_PIN` supprimé) + dettes éventuelles.

```bash
git add CLAUDE.md docs/workplan/plans/2026-07-06-session-65-INDEX.md
git commit -m "docs(workplan): closeout print-bridge + scan/CRUD LAN Devices"
```

---

## Self-Review (fait à l'écriture)

- **Couverture spec** : §4.1 contrat → T8 ; §4.2 scan+SSRF → T3/T4/T8 ; §4.3 structure/env/README → T2/T9 ; §5.1 CRUD/warning/merge → T11/T12/T13 ; §5.2 ScanPanel/URL bridge → T10/T14/T15 ; §6 erreurs → T8/T10/T13/T14 ; §7 tests → chaque task + T16 ; promotions[] S60 → T5. Hors périmètre respecté (pas d'auth bridge, pas d'USB, pas de print_queue).
- **Déviation explicite** : `DRAWER_PULSE_PIN` retiré (lib sans pin configurable) — Global Constraints + README + INDEX.
- **Types cohérents** : `PrinterTarget`/`ReceiptPayload`/`StationTicketPayload` définis T1, consommés T5/T6/T8 ; `ScanHit`/`ScanResponse` T4/T10 ; `LanDeviceInput` T11 consommé T12 ; `onEdit`/`onAdd`/`prefill` T13/T14 consommés T15.
- **Points d'attention exécutant** (vérifier, ne pas supposer) : forme d'import CJS/ESM de node-thermal-printer (T7), variant destructif de `Button` (T13), pattern de mock `authStore` des smokes BO (T13), tokens `text-warning` (T12), signature `SectionLabel` (T15).
