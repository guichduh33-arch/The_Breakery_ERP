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
