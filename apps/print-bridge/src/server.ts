// apps/print-bridge/src/server.ts — point d'entrée production.
// Le même processus porte HTTPS print-bridge et le hub WSS /ws.
// Lot 2 : le hub pousse le heartbeat AGRÉGÉ vers l'EF lan-heartbeat-batch
// (HUB_CLOUD_URL + HUB_CLOUD_SECRET) — un seul écrivain cloud.
import https from 'node:https';
import fs from 'node:fs';
import { DeviceRegistry } from './security/deviceRegistry.js';
import { loadConfig } from './config.js';
import { createApp } from './app.js';
import { sendToPrinter, kickDrawer } from './transport.js';
import { createHub } from './hub/hubServer.js';
import { HubRingBuffer } from './hub/ringBuffer.js';
import { startCloudSync } from './hub/cloudSync.js';
import { reachablePrinterCodes } from './hub/printerPresence.js';

const config = loadConfig();
if (!config.tlsCert || !config.tlsKey || config.allowedOrigins.length === 0)
  throw new Error('HTTPS certificate, key and allowed origins are required');
if (config.hubCloudUrl && !config.hubCloudUrl.startsWith('https://'))
  throw new Error('Cloud URL must use HTTPS');
const registry = new DeviceRegistry(config.registryFile, config.hubCloudUrl ?? '');
const hub = createHub({
  registry,
  allowedOrigins: config.allowedOrigins,
  buffer: new HubRingBuffer(config.hubBufferFile),
});
const cloudSync =
  config.hubCloudUrl !== null && config.hubCloudSecret !== null
    ? startCloudSync({
        presentCodes: async () => [
          ...hub.presence().map((d) => d.device_code),
          ...await reachablePrinterCodes(registry.printers()),
        ],
        url: config.hubCloudUrl,
        secret: config.hubCloudSecret,
        onRegistry: (value) => registry.update(value),
      })
    : undefined;
const app = createApp({
  config,
  send: sendToPrinter,
  kick: kickDrawer,
  hub,
  registry,
  ...(cloudSync !== undefined ? { cloudSync } : {}),
});
void cloudSync?.tick();

const server = https.createServer(
  {
    cert: fs.readFileSync(config.tlsCert),
    key: fs.readFileSync(config.tlsKey),
    minVersion: 'TLSv1.2',
  },
  app,
);
server.on('upgrade', hub.handleUpgrade);

server.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(
    `[print-bridge] listening on :${config.port} — receipt printer: ${
      config.receiptPrinter
        ? `${config.receiptPrinter.ip_address}:${config.receiptPrinter.port}`
        : 'NOT CONFIGURED'
    } — hub /ws: individual device authentication required — cloud-sync: ${
      cloudSync !== undefined ? 'enabled' : 'DISABLED (set HUB_CLOUD_URL + HUB_CLOUD_SECRET)'
    } — POS SPA: ${config.posDistDir ?? 'not served (set POS_DIST_DIR)'}`,
  );
});
