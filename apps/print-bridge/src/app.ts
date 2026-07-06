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

// Anti-SSRF (spec D7) : un `printer` fourni dans le body doit pointer vers une
// cible LAN privée, comme /scan/printers et /status/probe. Ne s'applique pas au
// repli env `config.receiptPrinter` (déjà de confiance, config serveur).
function isValidPrinterTarget(target: PrinterTarget): boolean {
  return isPrivateIpv4(target.ip_address)
    && Number.isInteger(target.port) && target.port > 0 && target.port <= 65535;
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
      try {
        const prefix = typeof req.query.prefix === 'string' ? req.query.prefix : '';
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

  return app;
}
