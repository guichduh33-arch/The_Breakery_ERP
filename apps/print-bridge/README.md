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
- `GET  /hub/status` — état du hub LAN (presence + ring-buffer) — spec 006x lot 1
- `WS   /ws` — bus LAN du hub (hello `{type,device_code,device_type,token?}`,
  enveloppes `{v,msg_id,device_code,ts,topic,payload}`, catchup). IP privées only.

## Hub LAN (spec 006x)
- `HUB_TOKEN` (.env) — secret partagé boutique, vérifié dans le hello WS.
  Sans lui le bus accepte tout appareil du LAN (warning au boot). Le token
  se saisit côté terminal dans POS → Settings → Devices → Hub token.
- `HUB_BUFFER_FILE` (.env, défaut `hub-buffer.jsonl`) — journal JSONL du
  ring-buffer (rattrapage des appareils qui rejoignent le bus).

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
