// apps/print-bridge/src/app.ts
// Routes du hub : origines autorisées, identité et capacités par appareil.
// Les transports sont injectés pour la testabilité.
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import type { PrinterTarget, ReceiptPayload, StationTicketPayload } from '@breakery/domain';
import type { BridgeConfig } from './config.js';
import { isPrivateIpv4, isPrivatePrefix } from './ipGuard.js';
import { probeTcp as realProbe, scanHosts as realScan, hostsForPrefix } from './scan.js';
import { renderReceipt } from './render/receipt.js';
import { renderStationTicket } from './render/stationTicket.js';
import type { sendToPrinter, kickDrawer } from './transport.js';
import type { HubHandle } from './hub/hubServer.js';
import { DISABLED_CLOUD_SYNC_STATUS, type CloudSyncHandle } from './hub/cloudSync.js';
import type { DeviceRegistry, LanPermission } from './security/deviceRegistry.js';

/** Sous-ensemble de HubHandle consommé par /hub/status (testable sans WS). */
export type HubStatusSource = Pick<HubHandle, 'presence' | 'bufferStats' | 'tokenRequired'>;
/** Sous-ensemble de CloudSyncHandle consommé par /hub/status. */
export type CloudSyncStatusSource = Pick<CloudSyncHandle, 'status'>;

export interface AppDeps {
  registry: DeviceRegistry;
  config: BridgeConfig;
  send: typeof sendToPrinter;
  kick: typeof kickDrawer;
  probe?: typeof realProbe;
  scan?: typeof realScan;
  hub?: HubStatusSource;
  cloudSync?: CloudSyncStatusSource;
}

function isTarget(x: unknown): x is PrinterTarget {
  return (
    typeof x === 'object' &&
    x !== null &&
    typeof (x as PrinterTarget).ip_address === 'string' &&
    typeof (x as PrinterTarget).port === 'number'
  );
}

// Le texte ESC/POS vient du réseau : un ESC/GS injecté dans un nom ou une
// note pourrait commander le tiroir sans passer par sa route protégée.
function safePrintContent(value: unknown, depth = 0): boolean {
  if (depth > 12) return false;
  if (typeof value === 'string') return !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/u.test(value);
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value))
    return value.length <= 500 && value.every((v) => safePrintContent(v, depth + 1));
  if (value !== null && typeof value === 'object')
    return Object.values(value).every((v) => safePrintContent(v, depth + 1));
  return true;
}

// Anti-SSRF (spec D7) : un `printer` fourni dans le body doit pointer vers une
// cible LAN privée, comme /scan/printers et /status/probe. Ne s'applique pas au
// repli env `config.receiptPrinter` (déjà de confiance, config serveur).
function isValidPrinterTarget(target: PrinterTarget): boolean {
  return (
    isPrivateIpv4(target.ip_address) &&
    Number.isInteger(target.port) &&
    target.port > 0 &&
    target.port <= 65535
  );
}

export function createApp({
  config,
  send,
  kick,
  probe = realProbe,
  scan = realScan,
  hub,
  cloudSync,
  registry,
}: AppDeps): express.Express {
  const app = express();
  app.set('case sensitive routing', true);
  app.set('strict routing', true);
  app.use((req, res, next) => {
    if (req.headers.origin && !config.allowedOrigins.includes(req.headers.origin)) {
      res.status(403).json({ error: 'origin_forbidden' });
      return;
    }
    next();
  });
  app.use(
    cors({
      origin: config.allowedOrigins,
      allowedHeaders: ['content-type', 'x-lan-device-code', 'x-lan-secret'],
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  const protectedRoutes: Record<string, LanPermission> = {
    '/print/receipt': 'receipts.print',
    '/print/ticket': 'tickets.print',
    '/drawer/open': 'drawer.open',
    '/hub/status': 'diagnostics',
    '/scan/printers': 'diagnostics',
    '/status/probe': 'diagnostics',
  };
  app.use((req, res, next) => {
    const permission = protectedRoutes[req.path];
    if (!permission) {
      next();
      return;
    }
    const device = registry?.authenticate(
      req.get('x-lan-device-code') ?? '',
      req.get('x-lan-secret') ?? '',
    );
    if (!device) {
      res.status(401).json({ error: 'device_unauthorized' });
      return;
    }
    if (!device.permissions.includes(permission)) {
      res.status(403).json({ error: 'device_forbidden' });
      return;
    }
    if (req.path.startsWith('/print/') || req.path === '/drawer/open') {
      if (!safePrintContent(req.body)) {
        res.status(400).json({ error: 'unsafe_print_content' });
        return;
      }
      const body = req.body as { printer?: unknown } | null;
      const target: unknown =
        req.path === '/drawer/open'
          ? config.receiptPrinter
          : (body?.printer ?? config.receiptPrinter);
      if (target && (!isTarget(target) || !registry?.permitsPrinter(target))) {
        res.status(403).json({ error: 'printer_forbidden' });
        return;
      }
    }
    next();
  });

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', version: process.env.npm_package_version ?? 'dev' });
  });

  // Spec 006x lot 1 — état du hub pour le panneau BO « Hub » (LanDevicesPage).
  app.get('/hub/status', (_req, res) => {
    if (hub === undefined) {
      res.json({ enabled: false });
      return;
    }
    res.json({
      enabled: true,
      version: process.env.npm_package_version ?? 'dev',
      uptime_s: Math.round(process.uptime()),
      token_required: hub.tokenRequired,
      devices: hub.presence(),
      buffer: hub.bufferStats(),
      // Spec 006x lot 2 — état du push heartbeat agrégé vers le cloud.
      cloud_sync: cloudSync !== undefined ? cloudSync.status() : DISABLED_CLOUD_SYNC_STATUS,
    });
  });

  app.post('/print/receipt', (req, res) => {
    const body = req.body as ReceiptPayload & { printer?: PrinterTarget };
    if (!body?.order?.order_number || !Array.isArray(body.items) || !body.totals || !body.payment) {
      res.status(400).json({ success: false, error: 'invalid_payload' });
      return;
    }
    if (isTarget(body.printer) && !isValidPrinterTarget(body.printer)) {
      res.status(400).json({ success: false, error: 'invalid_printer_target' });
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
    if (!isValidPrinterTarget(body.printer)) {
      res.status(400).json({ success: false, error: 'invalid_printer_target' });
      return;
    }
    if ((!body.order_number && body.order_number !== '') || !Array.isArray(body.items)) {
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
      try {
        const prefix = typeof req.query.prefix === 'string' ? req.query.prefix : '';
        if (!isPrivatePrefix(prefix)) {
          res.status(400).json({ error: 'invalid_range' });
          return;
        }
        const timeoutRaw = Number(req.query.timeout);
        const timeout = Number.isInteger(timeoutRaw)
          ? Math.min(Math.max(timeoutRaw, 100), 2000)
          : 500;
        const portRaw = Number(req.query.port);
        const port = Number.isInteger(portRaw) && portRaw > 0 && portRaw <= 65535 ? portRaw : 9100;
        const hosts = hostsForPrefix(prefix);
        const started = Date.now();
        const devices = await scan(hosts, port, timeout, 50);
        res.json({ devices, hostsScanned: hosts.length, durationMs: Date.now() - started });
      } catch (err) {
        res.status(502).json({ error: (err as Error).message });
      }
    })();
  });

  app.get('/status/probe', (req, res) => {
    void (async () => {
      try {
        const ip = typeof req.query.ip === 'string' ? req.query.ip : '';
        if (!isPrivateIpv4(ip)) {
          res.status(400).json({ error: 'invalid_range' });
          return;
        }
        const portRaw = Number(req.query.port);
        const port = Number.isInteger(portRaw) && portRaw > 0 && portRaw <= 65535 ? portRaw : 9100;
        const latencyMs = await probe(ip, port, 1500);
        res.json(latencyMs === null ? { reachable: false } : { reachable: true, latencyMs });
      } catch (err) {
        res.status(502).json({ error: (err as Error).message });
      }
    })();
  });

  // Spec 006x §4.1 (décision 2026-07-22) — SPA POS servie en LAN depuis le hub.
  // Enregistré APRÈS les routes API : elles gardent la priorité. Fallback SPA
  // sur tout GET restant (routing client React Router) ; l'upgrade /ws ne passe
  // pas par Express. Gaté par POS_DIST_DIR : absent = comportement historique.
  if (config.posDistDir !== null) {
    const distDir = path.resolve(config.posDistDir);
    const indexHtml = path.join(distDir, 'index.html');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(indexHtml, (err) => {
        if (err !== undefined && !res.headersSent) {
          res.status(404).json({ error: 'spa_index_not_found' });
        }
      });
    });
  }

  return app;
}
