# Spec — POS print-bridge deploy + runtime config (V1)

- **Date** : 2026-06-01
- **Topic** : `pos-print-bridge-deploy`
- **Type** : déploiement + config (dépendance externe + correctif config)
- **Branche cible suggérée** : `fix/pos-print-bridge-config`
- **Base** : `master` @ `70c5cf1`
- **Effort estimé** : **M-L** (repo : S pour de-hardcoder l'URL ; le gros de l'effort = déploiement bridge externe + provisioning hardware, hors monorepo)
- **Status** : draft pour ratification
- **Origine** : audit POS `pos-specialist` 2026-06-01 — finding **P0 « 100% des impressions échouent en prod sans le bridge »** (DEV-S34-W0-02, bridge déféré S35)

---

## 1. Contexte — ce qui est cassé (preuve `fichier:ligne`)

S34 a livré tout le **code client** d'impression (station tickets, bill, receipt, mock buffer, résolution imprimante) mais le **pont d'impression physique reste non déployé** et l'URL est codée en dur :

- `apps/pos/src/services/print/printService.ts:4` : `const SERVER_URL = 'http://localhost:3001';` — valeur **hardcodée**, utilisée par `checkPrintServer` (`:97`), `printReceipt` (`:128`), `openCashDrawer` (`:150`), `printStationTicket` (`:183`).
- En l'absence de `VITE_PRINT_MOCK=1`, tous ces appels POST vers `http://localhost:3001/*`. En prod sur tablette, `localhost:3001` n'existe pas → **100% des impressions échouent** (station prep, bill, receipt) et le tiroir ne s'ouvre pas.
- Le code client est prêt et testé en mock (S34 : 5 smokes 7/7 PASS sous `VITE_PRINT_MOCK=1`). Il manque (a) le déploiement du bridge multi-imprimantes, (b) une URL configurable runtime, (c) l'enregistrement des imprimantes dans `lan_devices`.

Côté résolution imprimante, l'infra existe déjà : `apps/pos/src/features/cart/hooks/useStationPrinters.ts:37-74` lit `lan_devices` (`device_type='printer'`, `is_active=true`, `capabilities->>'station'`, `ip_address`, `port`) et construit `Map<PrinterRole, {ip_address, port, name}>`. Mais **0 imprimante n'est enregistrée** (cf. S34 spec §1 « 0 imprimante enregistrée en dev »). Sans rows, `useStationPrinters` retourne une Map vide → résolution échoue.

Le contrat bridge est figé (S34 spec §2 Choix 4) : `POST /print/ticket` (prep/bill/receipt), `POST /print/receipt`, `POST /drawer/open`, `GET /health`.

---

## 2. Architecture / approche proposée

Trois volets : (A) de-hardcoder l'URL côté repo, (B) déployer le bridge hors monorepo, (C) provisionner `lan_devices`.

### A. Repo — URL bridge configurable runtime (correctif `printService.ts`)
Remplacer la constante hardcodée par une lecture de config runtime, avec fallback :
```ts
const SERVER_URL = import.meta.env.VITE_PRINT_SERVER_URL ?? 'http://localhost:3001';
```
**Relation avec S35** : la spec S35 F-009 (POSSettings « Printing tab ») prévoit de remplacer ce `const SERVER_URL` hardcodé par une lecture d'un `usePosSettingsStore` éditable par le manager (cf. `2026-05-29-session-35-spec.md` §5, qui résout F-015 « URL hardcodée »). **Ne pas dupliquer cette UI ici.** Cette spec se limite à introduire l'env var `VITE_PRINT_SERVER_URL` comme dé-hardcodage minimal et déployable immédiatement ; la config UI éditable reste F-009/S35. Coordination : le store S35 doit lire/écrire la même clé que l'env var (ordre de résolution : store > env var > fallback localhost).

### B. Bridge — déploiement (EXTERNE, hors monorepo)
Le print-bridge est un process séparé (`localhost:3001` aujourd'hui en dev) à déployer sur la machine du comptoir (PC caisse) avec accès LAN aux imprimantes thermiques. Spécifier :
- Endpoints du contrat S34 : `POST /print/ticket` (route vers `printer.ip_address:port` selon le payload), `POST /print/receipt`, `POST /drawer/open`, `GET /health`.
- Routage multi-imprimantes : le bridge reçoit `{ printer: { ip_address, port }, kind, role, ... }` et ouvre une connexion ESC/POS vers chaque imprimante physique.
- Découverte / config réseau : IP/port de chaque imprimante prep (barista/kitchen/bakery) + doc (cashier/waiter).
- Le code et le déploiement du bridge sont **hors de ce monorepo** — livrable = doc de contrat + procédure de déploiement remise à l'équipe ops/bridge.

### C. `lan_devices` — enregistrement des imprimantes (ops / seed)
Les 5 rôles d'imprimante doivent exister en `lan_devices` pour que `useStationPrinters` les résolve :

| `name` (libellé) | `device_type` | `capabilities->>'station'` | `ip_address` / `port` |
|---|---|---|---|
| Barista printer | `printer` | `barista` | LAN réel |
| Kitchen printer | `printer` | `kitchen` | LAN réel |
| Display/Bakery printer | `printer` | `bakery` | LAN réel |
| Cashier printer | `printer` | `cashier` | LAN réel |
| Waiter printer | `printer` | `waiter` | LAN réel |

**Pas de migration prod** (hardware-spécifique, IP variables par site) — saisie ops dans `lan_devices` (idéalement via une future UI BO « Devices », hors scope ici). **Seed dev** des 5 imprimantes (fixture, pas migration) pour exercer la résolution sans matériel. Si `useStationPrinters` ne trouve pas un rôle → le flux d'impression S34 affiche déjà « no printer configured for [station] » (pas de crash).

---

## 3. Critères d'acceptation

- [ ] `printService.ts` lit l'URL du bridge via `VITE_PRINT_SERVER_URL` (fallback `localhost:3001`), plus de constante figée non-configurable.
- [ ] Ordre de résolution documenté et compatible avec le store F-009/S35 (store > env > fallback).
- [ ] Contrat des endpoints bridge documenté (`/print/ticket`, `/print/receipt`, `/drawer/open`, `/health`) et remis à l'équipe bridge.
- [ ] Procédure d'enregistrement des 5 imprimantes dans `lan_devices` documentée (ops) + seed dev en fixture.
- [ ] Repro réel : 1 commande mixte → 3 tickets prep (barista/kitchen/bakery) + reçu cashier, quand le bridge multi-imprimantes est déployé.
- [ ] `pnpm --filter @breakery/app-pos typecheck` PASS.

## 4. Tests attendus

- POS smoke `print-server-url-config.smoke.test.tsx` : avec `VITE_PRINT_SERVER_URL` défini, `printReceipt`/`printStationTicket` (hors mock) POST vers l'URL configurée et non `localhost:3001` (mocker `fetch`, assert l'URL appelée).
- Non-régression : les 5 smokes S34 sous `VITE_PRINT_MOCK=1` restent verts (`fire-to-stations`, `fire-printer-unreachable`, `checkout-autofire`, `print-bill`, `receipt-targets-cashier`).
- **Repro physique** (dépend du bridge, hors CI) : tracé comme S34-FOLLOWUP — checklist matérielle à exécuter une fois le bridge déployé.

## 5. Hors scope

- **Config UI éditable du print server / imprimantes** : c'est F-009/S35 (POSSettings Printing tab). **Cross-ref `2026-05-29-session-35-spec.md` §5 — ne pas re-spécifier.**
- Code du print-bridge lui-même (process externe hors monorepo).
- UI BO de gestion `lan_devices` / « Devices » tab.
- Découverte automatique d'imprimantes (mDNS / scan LAN).
- Reciblage du contenu reçu (méthode/tiroir) — specs séparées `pos-receipt-payment-method-fix` + `pos-cash-drawer-error-toast`.

## 6. Risques / dépendances

1. **Dépendance externe bloquante (P0 opérationnel)** : sans le déploiement bridge multi-imprimantes, aucune impression réelle. Le dé-hardcodage URL ne suffit pas seul — il faut un bridge joignable à l'URL configurée.
2. **Provisioning `lan_devices`** : si les rows imprimantes ne sont pas saisies, `useStationPrinters` retourne vide → toast « no printer configured ». Doc ops requise.
3. **Chevauchement S35 F-009** : risque de double-implémentation de la config URL. Mitigation : cette spec ne fait que l'env var ; l'UI éditable reste S35, lisant la même clé.
4. IP imprimantes variables par site → pas de migration prod possible ; config par déploiement.
