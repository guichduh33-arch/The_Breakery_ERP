// apps/print-bridge/src/server.ts — point d'entrée production.
// Spec 006x lot 1 : le même process porte le HTTP print-bridge ET le hub LAN
// WebSocket (ws://<hub>:PORT/ws) — arbitrage A2 (hub = print-bridge étendu).
// Lot 2 : le hub pousse le heartbeat AGRÉGÉ vers l'EF lan-heartbeat-batch
// (HUB_CLOUD_URL + HUB_CLOUD_SECRET) — un seul écrivain cloud.
import http from 'node:http';
import { loadConfig } from './config.js';
import { createApp } from './app.js';
import { sendToPrinter, kickDrawer } from './transport.js';
import { createHub } from './hub/hubServer.js';
import { HubRingBuffer } from './hub/ringBuffer.js';
import { startCloudSync } from './hub/cloudSync.js';

const config = loadConfig();
const hub = createHub({
  token: config.hubToken,
  buffer: new HubRingBuffer(config.hubBufferFile),
});
const cloudSync = config.hubCloudUrl !== null && config.hubCloudSecret !== null
  ? startCloudSync({
      presentCodes: () => hub.presence().map((d) => d.device_code),
      url: config.hubCloudUrl,
      secret: config.hubCloudSecret,
    })
  : undefined;
const app = createApp({
  config, send: sendToPrinter, kick: kickDrawer, hub,
  ...(cloudSync !== undefined ? { cloudSync } : {}),
});

const server = http.createServer(app);
server.on('upgrade', hub.handleUpgrade);

server.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(
    `[print-bridge] listening on :${config.port} — receipt printer: ${
      config.receiptPrinter ? `${config.receiptPrinter.ip_address}:${config.receiptPrinter.port}` : 'NOT CONFIGURED'
    } — hub /ws: token ${config.hubToken !== null ? 'required' : 'DISABLED (set HUB_TOKEN)'} — cloud-sync: ${
      cloudSync !== undefined ? 'enabled' : 'DISABLED (set HUB_CLOUD_URL + HUB_CLOUD_SECRET)'
    }`,
  );
});
