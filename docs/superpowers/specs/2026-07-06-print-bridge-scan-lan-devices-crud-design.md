# Spec — Print-bridge versionné + scan réseau imprimantes + CRUD LAN Devices

> **Date** : 2026-07-06 · **Statut** : validé par le propriétaire (brainstorming même jour)
> **Périmètre** : nouveau workspace `apps/print-bridge` (réécriture propre, contrat V2 conservé),
> panneau scan réseau + CRUD complet sur la page BO LAN Devices. **Zéro migration DB.**
> **Ferme** : chantier Vague 3 « print-bridge à versionner dans le repo », action utilisateur S60
> « template print-bridge à MAJ pour `promotions[]` », action ouverte S59 « codes devices seed à
> adapter » (le CRUD BO remplace le SQL manuel).

---

## 1. Problème

1. **Détection des imprimantes** : les imprimantes thermiques ESC/POS écoutent sur TCP 9100, mais
   un navigateur ne peut pas sonder un port TCP brut (les `fetch no-cors` sont aveugles). La V2
   avait une découverte via le print server (`/scan/printers`) ; ce code a été purgé et la doc
   `docs/reference/06-lan-architecture/` est V2/périmée. Aujourd'hui la détection est 100 % manuelle
   (self-test imprimante + INSERT SQL).
2. **Enregistrement des devices** : la page BO `/backoffice/lan-devices` (S13) est en lecture
   seule alors que la RLS de `lan_devices` a été conçue dès l'origine pour un CRUD opérateur
   (`lan.devices.manage`, déjà seedé ADMIN/SUPER_ADMIN). Créer une imprimante, un KDS ou une
   tablette passe par du SQL manuel.
3. **Print-bridge hors repo** : le bridge (Express port 3001) est un template externe non
   versionné. Son template de reçu ne rend pas `promotions[]` (action utilisateur S60 toujours
   ouverte). La Vague 3 prévoit déjà son rapatriement.

## 2. Décisions actées (brainstorming 2026-07-06)

| # | Décision | Choix |
|---|----------|-------|
| D1 | Périmètre bridge | **Réécriture propre dans le monorepo** (`apps/print-bridge`), contrat V2 conservé + endpoints scan |
| D2 | UI du scan | **BO uniquement**, page LAN Devices (le CRUD y vit aussi) |
| D3 | Périmètre CRUD | **Tous les device_types** (printer, kds, tablet, pos, kiosk_display) ; le scan ne détecte que les imprimantes |
| D4 | Transport imprimantes | **TCP 9100 uniquement** (toutes les imprimantes sont réseau ; tiroir en RJ11 sur l'imprimante caisse, kick via pulse ESC/POS) |
| D5 | Rendu ESC/POS | **`node-thermal-printer`** (Epson/Star, TCP natif, cut/pulse/alignement gérés) — on n'écrit que les templates |
| D6 | Imprimante caisse par défaut | **Env du bridge** (`RECEIPT_PRINTER_IP`/`RECEIPT_PRINTER_PORT`) — `printReceipt` peut poster sans cible |
| D7 | CORS bridge | **Ouvert** (LAN de confiance, pas de credentials) + garde anti-SSRF sur scan/probe (plages privées uniquement) |
| D8 | Écritures `lan_devices` | **Writes directs sous RLS** (design S13), soft-delete via `deleted_at` — pas de RPC, pas de migration |

Non viable écarté : scan orchestré côté cloud (RPC/EF) — Supabase ne voit pas le LAN.

## 3. Architecture

```
┌─────────────── BO (navigateur, LAN) ───────────────┐
│ Page LAN Devices                                   │
│  ├─ CRUD lan_devices ──────────► Supabase (RLS)    │
│  └─ ScanPanel / Test ──HTTP───► print-bridge :3001 │
└────────────────────────────────────────────────────┘
┌─────────────── POS (inchangé) ─────────────────────┐
│ printService.ts ───────HTTP───► print-bridge :3001 │
└────────────────────────────────────────────────────┘
              print-bridge (PC boutique, Node)
                   │ TCP 9100 (ESC/POS)
                   ▼
        imprimantes caisse / kitchen / barista / display / waiter
```

Le bridge reste un **traducteur HTTP→ESC/POS sans état** : pas d'accès Supabase, pas de React,
types des payloads importés de `@breakery/domain` (qui reste IO-free — le bridge n'y ajoute rien).
Le POS ne change pas d'une ligne : le contrat consommé par `printService.ts` est conservé octet
pour octet.

## 4. `apps/print-bridge` — contrat HTTP

### 4.1 Endpoints existants (contrat conservé, consommé par `printService.ts`)

| Méthode | Path | Body / query | Comportement |
|---|---|---|---|
| GET | `/health` | — | `200 {"status":"ok","version":"<pkg>"}` — sondé par `checkPrintServer()` (timeout client 2 s) |
| POST | `/print/receipt` | `ReceiptPayload` + `printer?: {ip_address, port}` | Rend le reçu complet et l'envoie à `printer` si fourni, sinon à l'imprimante caisse env (D6). **Rend `promotions[]` + `totals.promotion_total`** (ferme S60) |
| POST | `/print/ticket` | `{printer: {ip_address, port}} & StationTicketPayload` | KOT station (`kind: 'prep'`) ou ticket waiter (`kind: 'waiter'`) ; header « ADDITIONAL ORDER » si `additional: true` |
| POST | `/drawer/open` | — | Pulse ESC/POS (pin 2, configurable) vers l'imprimante caisse env |

Réponses : `200 {"success":true}` ; erreur imprimante → `502 {"success":false,"error":"<détail>"}` ;
payload invalide → `400`. (Le client POS ne lit que `res.ok` — codes précis = confort de debug.)

Les shapes `ReceiptPayload` / `StationTicketPayload` font foi dans
`apps/pos/src/services/print/printService.ts` (lignes 20–91) — le bridge les réimporte/reflète,
il ne les redéfinit pas différemment.

### 4.2 Nouveaux endpoints (scan)

| Méthode | Path | Query | Comportement |
|---|---|---|---|
| GET | `/scan/printers` | `prefix` (ex. `192.168.1`), `timeout?` (ms/IP, défaut 500, max 2000), `port?` (défaut 9100) | Sweep TCP `prefix.1..254`, concurrence 50. Réponse : `{"devices":[{"ip","port","latencyMs"}],"hostsScanned":254,"durationMs":n}` |
| GET | `/status/probe` | `ip`, `port?` (défaut 9100) | Sonde une IP : `{"reachable":true,"latencyMs":n}` ou `{"reachable":false}` |

**Garde anti-SSRF (D7)** : `prefix` et `ip` sont validés — IPv4 privées uniquement
(`192.168.x.x`, `10.x.x.x`, `172.16-31.x.x`, `127.x`). Hors plage → `400 invalid_range`.
Durée pire-cas d'un /24 : `254 / 50 × 500 ms ≈ 2,6 s` ; timeout serveur global 60 s.

### 4.3 Structure, config, déploiement

```
apps/print-bridge/
├─ src/
│  ├─ server.ts            # Express + CORS ouvert + routes
│  ├─ routes/{health,print,drawer,scan}.ts
│  ├─ render/receipt.ts    # template reçu (promotions[], loyalty, modifiers, IDR)
│  ├─ render/stationTicket.ts  # KOT + waiter + ADDITIONAL ORDER
│  ├─ scan.ts              # sweep TCP net.Socket, AbortSignal, concurrence 50
│  └─ config.ts            # lecture env + défauts
├─ .env.example            # PORT=3001, RECEIPT_PRINTER_IP, RECEIPT_PRINTER_PORT=9100, DRAWER_PULSE_PIN=2
├─ README.md               # install service Windows (NSSM ou pm2), .env, test
└─ package.json            # deps: express, cors, node-thermal-printer
```

- Workspace pnpm (`@breakery/print-bridge`), TypeScript strict, `pnpm build` → `dist/`,
  démarrage `node dist/server.js`. Turbo : participe à `build`/`typecheck`/`test` ; **exclu des
  builds Vite** (aucune app ne l'importe à part les types domain partagés).
- Fichiers < 500 lignes (règle projet) — le rendu est splitté par template.
- **Action utilisateur au déploiement** : installer ce bridge sur le PC boutique à la place du
  template externe, renseigner `.env`, l'enregistrer en service Windows (README pas-à-pas).

## 5. BO — page LAN Devices (CRUD + scan)

### 5.1 CRUD (`apps/backoffice/src/features/lan-devices/`)

- **`LanDeviceFormModal`** (create + edit) : `code` (unique, requis), `name` (requis),
  `device_type` (select natif, 5 types), `ip_address`, `port` (requis ensemble si
  `device_type='printer'`, optionnels sinon), `location`, `is_active`, et — **visible seulement si
  `printer`** — `station` (select : kitchen / barista / display / waiter) écrit dans
  `capabilities.station`. Les autres clés de `capabilities` sont préservées à l'edit (merge, pas
  d'écrasement).
- **Hooks** : `useUpsertLanDevice` (INSERT/UPDATE directs, D8), `useDeleteLanDevice`
  (soft-delete : `UPDATE deleted_at = now()`). Succès → invalidation de `LAN_DEVICES_KEY` ;
  le POS (`useStationPrinters`, staleTime 5 min) converge en ≤ 5 min ou au reload.
- **`LanDevicesTable`** enrichie : colonnes existantes + IP:port + station (imprimantes) +
  actions Edit / Delete (confirmation) / **Test** (imprimantes : `/status/probe` puis, si
  joignable, envoi d'un ticket de test via `/print/ticket`).
- **Gates** : page/lecture inchangées (`lan.devices.read`) ; tous les boutons d'écriture et le
  scan sous `PermissionGate` `lan.devices.manage`.
- **Warning station dupliquée (non bloquant)** : à la sauvegarde d'une imprimante active dont la
  `station` est déjà portée par une autre imprimante active, afficher un avertissement
  (« useStationPrinters n'en gardera qu'une ») — la sauvegarde reste permise.

### 5.2 ScanPanel

- Champ **URL du print-bridge** : nouveau setting BO local (localStorage par machine, défaut
  `http://localhost:3001`), même philosophie que `posSettingsStore.printerUrl`. Réutilisé par les
  boutons Test.
- Champ **préfixe réseau** (défaut `192.168.1`, validation IPv4 privée côté client aussi) +
  bouton **« Scanner le réseau »** → `GET {bridge}/scan/printers?prefix=…`.
- Pendant le scan : spinner + bouton **Annuler** (AbortController).
- Résultats croisés avec les devices existants **par `ip_address`** : badge « Déjà configurée »
  (lien vers la ligne) ou bouton **« Ajouter »** → ouvre `LanDeviceFormModal` pré-rempli
  (`device_type='printer'`, IP, port) — l'opérateur complète code/nom/station. **Pas
  d'auto-enregistrement** : rien n'entre en base sans validation humaine.

## 6. Erreurs

| Cas | Comportement |
|---|---|
| Bridge injoignable (scan/test) | Toast + hint : vérifier l'URL du bridge et que le service tourne |
| Scan sans résultat | État vide explicite (« aucune imprimante sur ce segment ») + rappel self-test/préfixe |
| `code` dupliqué (23505) | Message dédié « ce code est déjà utilisé » |
| RLS refus (pas `lan.devices.manage`) | Boutons non rendus (gate) ; erreur 42501 classée `permission_denied` en défense |
| Imprimante down au print | Le bridge répond `502 {success:false,error}` — le POS garde son comportement actuel (best effort, toast) |
| IP hors plage privée | `400 invalid_range` côté bridge, validation miroir côté client |

## 7. Tests

- **Bridge (Vitest, `apps/print-bridge/src/__tests__/`)** : snapshot des buffers ESC/POS
  (mock/interception de `node-thermal-printer`) pour reçu avec promotions + KOT + additional +
  waiter ; scan contre un faux serveur TCP sur port éphémère (trouvé/pas trouvé/timeout) ; routes
  via supertest (400 payload invalide, 400 invalid_range, 502 imprimante down). Aucune imprimante
  réelle en CI.
- **BO (smokes co-localisés `__tests__/`)** : form modal (validation, champ station conditionnel,
  merge capabilities), ScanPanel (fetch mocké : résultats, déjà-configurée, annulation), gates.
- **pgTAP (nouvelle petite suite `supabase/tests/lan_devices_rls.test.sql`)** : ancre le design D8
  — INSERT/UPDATE/DELETE refusés sans `lan.devices.manage`, autorisés avec ; SELECT authenticated
  libre ; `update_lan_heartbeat_v1` intouché.
- **POS** : zéro changement de code — les smokes print existants font foi de la conservation du
  contrat.
- Suite monorepo : `pnpm typecheck && pnpm build && pnpm test` verts, lint-ratchet inclus.

## 8. Hors périmètre (explicite)

- Auth sur le bridge (LAN de confiance — durcissement futur si multi-site).
- Imprimantes USB / spooler Windows (D4 : tout réseau).
- mDNS / SNMP / identification du modèle — le scan est un simple sweep TCP 9100.
- File d'attente d'impression persistée (`print_queue` droppée S62 — on ne la ressuscite pas).
- Auto-enregistrement des devices scannés (validation humaine obligatoire).
- Enforcement serveur d'unicité de station par imprimante (warning UI seulement).
- Modification de `resolve_dispatch_stations_v1` / `dispatch_station` (le routage produit→station
  existe déjà et n'est pas touché).

## 9. Impact plan de travail

- Money-path **non touchée** (aucune migration, aucun RPC modifié).
- Ferme : Vague 3 « print-bridge à versionner », action S60 `promotions[]`, action S59 codes
  devices (via CRUD).
- Dette assumée : la doc `docs/reference/06-lan-architecture/` reste V2/périmée — sa régénération
  appartient à la Phase 3 docs, pas à cette feature.
