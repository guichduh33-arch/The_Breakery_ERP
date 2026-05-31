# Session 34 — Station Ticket Printing (routage tickets imprimantes de poste) (Spec)

> **Date** : 2026-06-01
> **Branche cible** : `swarm/session-34`
> **Base** : `master` @ `dafc500` (post-merge PR #53 security-fraud-guard)
> **Effort estimé** : ~2-3 jours wall-time (M) côté repo + 1 dépendance externe (pont d'impression)
> **Status** : draft pour ratification user (avant Wave 0 spec commit)
> **Origine** : audit `pos-flow-audit` 2026-05-31 — finding **P0 « les items envoyés ne vont nulle part »**. Direction métier ratifiée 2026-06-01 : **The Breakery fonctionne aux imprimantes de poste, pas aux écrans**. Les écrans KDS (kitchen + waiter groupé) sont **déférés S35**.

---

## 1. Contexte — ce qui est cassé, et la décision métier

L'audit POS du 2026-05-31 a prouvé que **les items « envoyés en cuisine » ne vont nulle part** :
- `useSendToKitchen.ts:34-36` ne fait que `markLocked()` (état client), avec un `// TODO` jamais fait — le toast « Sent N items to kitchen » ment (aucune sortie réelle).
- `process-payment` / `complete_order_with_payment_v10` n'imprime aucun ticket de poste ; le seul print existant est le **reçu client** (`printService.printReceipt`) vers **une seule imprimante** (`localhost:3001`, méthode hardcodée).

**Décision métier (2026-06-01)** : The Breakery coordonne les postes via des **imprimantes ticket**, pas des écrans. Donc S34 livre le **routage de tickets vers les imprimantes de poste**. Les écrans (kitchen KDS, waiter order-groupé) sont une étape ultérieure (S35).

### Modèle de sortie ratifié (2026-06-01) — 5 imprimantes, 2 natures

Les 5 « stations » sont **toutes des imprimantes** (`lan_devices` `device_type='printer'`), mais de deux natures distinctes :

**A. Imprimantes de préparation** — reçoivent un ticket `prep` (sans prix), routage **par item** via `dispatch_station` :

| Imprimante prep | Catégories qui y routent |
|---|---|
| **barista** | Beverage |
| **kitchen** | Plate, Savoury, Sandwiches |
| **display** | Viennoiserie, Bagel, Pastry, Bread |

**B. Imprimantes de document** — PAS de routage par item ; impriment des documents à l'échelle de la **commande entière** :

| Imprimante doc | Documents | Contenu |
|---|---|---|
| **cashier** (caisse) | **reçu** (`receipt`) + **note** (`bill`) | reçu = **seule** à le pouvoir, post-paiement, fiscal (mode de paiement + monnaie) ; note = addition pré-paiement |
| **waiter** | **note** (`bill`) | addition pré-paiement, **commande entière groupée**, sans info paiement |

3 types de document : `prep` (par poste, sans prix) · `bill`/note (addition pré-paiement, caisse **ou** waiter) · `receipt`/reçu (caisse uniquement, post-paiement).

> **Écrans = S35** : kitchen KDS (revival du pipeline `is_locked`/`kitchen_status` du finding original) + écran KDS waiter éventuel. S34 = imprimantes uniquement.

### Ce que la donnée confirme (V3 dev, 2026-06-01)
- `categories.dispatch_station` / `order_items.dispatch_station` sont **TEXT sans CHECK** → libre d'ajouter `'barista'`/`'display'`/`'cashier'`.
- Catégories actuelles : Bagel/Viennoiserie=`bakery` ; Plate/Savoury=`kitchen` ; Beverage/Pastry/Bread/Sandwiches=`none` ; Ingredient=`none`.
- `lan_devices` modélise déjà les imprimantes (`device_type='printer'`, colonnes `ip_address`, `port`, `location`, `capabilities` JSONB) — mais **0 imprimante enregistrée** en dev aujourd'hui.
- `printService.ts` parle à **une** imprimante via `localhost:3001` (`/print/receipt`, `/drawer/open`, `/health`) — **aucun routage multi-imprimantes**.

---

## 2. Architecture (choix structurants)

**Choix 1 — `dispatch_station` = vocabulaire de routing PREP uniquement** : valeurs item `barista | kitchen | display | none`. `none` = aucun ticket prep. **`cashier`/`waiter` ne sont PAS des valeurs de `dispatch_station`** (ce sont des imprimantes de document, pas des destinations d'item). Migration data : réassigner les catégories prep (Beverage→barista, Sandwiches→kitchen, bakery→display ; Plate/Savoury déjà kitchen ; Ingredient=none). TEXT, pas d'enum/CHECK. Le POS lit la station par item via `product → category.dispatch_station` (la query `useProducts` doit l'exposer — cf. Wave 1).

**Choix 2 — Résolution rôle → imprimante via `lan_devices`** : chaque imprimante = `lan_devices` (`device_type='printer'`, `is_active=true`) taguée par **rôle** ∈ `barista|kitchen|display|cashier|waiter`. **Mécanisme = `capabilities->>'station'`** (ex. `{"station":"cashier"}`). Le POS charge les imprimantes actives (`useLanDevices({deviceType:'printer'})`), construit `Map<role, device>`, résout `{ip_address, port}` à l'impression. Les 3 rôles prep sont alimentés par item ; `cashier`/`waiter` par document. **Ratifié 2026-06-01 : tag = `capabilities->>'station'`** (valeurs `barista|kitchen|display|cashier|waiter`). Config éditable en BO plus tard (hors scope — saisie/seed pour l'instant).

**Choix 3 — Orchestrateur `useFireToStations` (remplace le faux `useSendToKitchen`)** : prend les items non-encore-imprimés du cart, les **groupe par station** (helper domain pur `groupItemsByStation`), résout l'imprimante de chaque station, et POST un ticket par station au pont. Retourne un résultat **par station** (`{station, ok, error?}`). Marque `printedItemIds` localement **seulement pour les stations imprimées avec succès** (idempotence anti-reprint, miroir de `lockedItemIds`). Une station en échec n'est pas marquée → re-tentative ciblée possible.

**Choix 3bis — Documents `bill` (note/addition) et `receipt` (reçu)** :
- **`bill` (note/addition)** : document **pré-paiement** listant la **commande entière** (tous items groupés, totaux, **sans** mode de paiement ni monnaie). Imprimable à la demande sur l'imprimante **cashier** OU **waiter** (le serveur imprime l'addition à la table ; la caisse aussi au comptoir). Action « Print Bill ».
- **`receipt` (reçu)** : document **post-paiement** fiscal (items + totaux + mode de paiement + monnaie). Imprimé sur **cashier uniquement**, au checkout. Réutilise le flux `printReceipt` existant, **reciblé vers l'imprimante cashier** (au lieu du `localhost:3001` mono-imprimante actuel). Les bugs de contenu du reçu (méthode hardcodée 'cash', total recalculé) sont des findings P1 **séparés** — non traités ici sauf le reciblage imprimante.

**Choix 4 — Contrat pont d'impression étendu (dépendance externe)** : nouvel endpoint `POST /print/ticket` au pont `localhost:3001` :
```
{ printer: { ip_address, port } | { printer_id },
  kind: 'prep' | 'bill' | 'receipt',
  role: 'barista'|'kitchen'|'display'|'cashier'|'waiter',
  order_number, table_number?, created_at, server_name,
  items: [{ name, quantity, modifiers?, note? }],
  totals?: { subtotal, tax, total },                  // bill/receipt seulement
  payment?: { method, amount, change_given } }        // receipt seulement
```
`prep` = pas de prix. `bill` = totaux, pas de paiement. `receipt` = totaux + paiement. Le pont route vers l'imprimante physique. **Le pont est hors de ce monorepo** (`localhost:3001`) — l'implémentation multi-imprimantes est une **tâche externe** (flaggée §6). Côté repo on livre le **contrat client + payloads + résolution + wiring + tests** ; le repro réel dépend du pont. **Mode mock** (env flag) pour tester le routage sans matériel.

**Choix 5 — Déclencheurs d'impression** :
- **« Send to Kitchen » (fire)** : imprime les tickets **prep** (barista/kitchen/display) des items non-imprimés. Comptoir ET tablette (fire-before-pay). Le geste honnête qui remplace le `markLocked` mensonger.
- **« Print Bill » (note)** : action à la demande (cart comptoir + ActiveOrder tablette) → imprime un `bill` de la commande entière vers l'imprimante du contexte (waiter si tablette/table, cashier si comptoir). Ré-imprimable.
- **Checkout** : imprime le **`receipt`** (cashier) + **auto-fire** les items prep non-encore-imprimés (filet : rien de payé sans être passé en prep).
- Pas de double-impression prep : `printedItemIds` garde la trace ; un item déjà imprimé au fire n'est pas réimprimé au checkout. (Le `bill` est librement ré-imprimable, ce n'est pas un ticket prep.)

**Choix 6 — Pas de changement DB de cycle de vie commande** : pas de draft order, pas de `is_locked`/`kitchen_status`, pas de bump RPC `complete_order`/`create_tablet_order`. L'impression est un **side-effect client** au fire/checkout. La commande reste créée au checkout comme aujourd'hui. (Le revival du pipeline écran — `is_locked` etc. — est S35.) Seul changement DB S34 = la **donnée de routing** (Choix 1).

**Choix 7 — Échec d'impression = visible, jamais silencieux** (antidote direct à « l'action qui ment ») : si une imprimante de poste est injoignable, toast d'erreur **par station** (« Barista printer unreachable — ticket NOT printed ») + bouton « Reprint [station] ». Le fire n'est « réussi » que pour les stations effectivement imprimées. Le toast global ne s'affiche que si **toutes** les stations ont imprimé.

---

## 3. DB changes (Wave 1)

Bloc migrations `20260620000010` (monotone après `20260619000043`).

| # | Migration | Objet |
|---|---|---|
| `_010` | `remap_categories_dispatch_station_printer_model` | Data, idempotent : `UPDATE categories SET dispatch_station = …` — Beverage→`barista` ; Sandwiches→`kitchen` (Plate/Savoury déjà `kitchen`) ; Viennoiserie/Bagel/Pastry/Bread→`display` ; Ingredient→`none`. Commentaire : retunable via BO (futur). |

**Pas de migration RPC** (Choix 6). **Pas de CHECK à altérer** (dispatch_station est TEXT libre). **Pas de nouvelle permission**. **Config imprimantes** : pas de migration prod (hardware-spécifique) — saisie ops/manuelle dans `lan_devices` ; **seed dev** des 4 imprimantes (capabilities.station) fait dans la fixture de test, pas en migration prod (cf. Wave 4). Types regen non requis (pas de signature changée) — sauf si on touche `lan_devices` typings (non).

---

## 4. POS changes (Wave 2)

- **Domain pur** `packages/domain/src/printing/groupItemsByStation.ts` : `(items, stationByProductId) → Record<Station, Item[]>` (IO-free, unit-testable). + type `Station = 'barista'|'kitchen'|'display'|'cashier'`.
- **`useProducts`** : exposer `dispatch_station` par produit (via embed `categories(dispatch_station)` ou colonne dénormalisée) pour la résolution client-side. (Vérifier le select actuel — l'étendre si absent.)
- **`printService.ts`** : `StationTicketPayload` (kind `prep|bill|receipt`) + `printStationTicket(printer, payload)` (POST `/print/ticket`, timeout, `{success,error?}`) + **mode mock** (`VITE_PRINT_MOCK`). Conserver `printReceipt` mais le **recibler** sur l'imprimante `cashier` résolue.
- **`useStationPrinters`** (nouveau, sur `useLanDevices({deviceType:'printer'})`) : `Map<role, {ip_address, port, name}>` depuis `capabilities.station` (rôles `barista|kitchen|display|cashier|waiter`).
- **`useFireToStations`** (nouveau, remplace `useSendToKitchen`) : Choix 3 — group items prep → resolve → print par poste → résultats par poste ; `markPrinted` sur succès.
- **`usePrintBill`** (nouveau) : imprime un `bill` (commande entière) vers l'imprimante `cashier` (comptoir) ou `waiter` (tablette/table) selon le contexte. Ré-imprimable.
- **`cartStore.ts`** : `printedItemIds: string[]` + `markPrinted(ids)` + `printedItems()/unprintedItems()` ; reset dans `clear()`/`resetCartAfterCheckout()`. (Orthogonal à `lockedItemIds`.)
- **`SendToKitchenButton.tsx`** : câbler `useFireToStations` ; toasts honnêtes par poste (Choix 7) ; retirer le commentaire mensonger.
- **`ActiveOrderPanel` / cart** : bouton « Print Bill » (note) → `usePrintBill`. Visible comptoir (→ cashier) et tablette (→ waiter).
- **`useCheckout.ts`** : après paiement, `receipt` (cashier) + auto-fire prep non-imprimés (Choix 5). Pas de blocage du paiement si une imprimante prep échoue (toast + reprint) ; le reçu cashier reste prioritaire.

> Hors scope S34 (→ S35+) : écrans KDS (kitchen revival `is_locked`/`kitchen_status` + draft order) + écran waiter ; édition BO de la map rôle→imprimante ; reçu fidèle au mode de paiement / tiroir conditionnel cash (findings P1 séparés — seul le **reciblage** imprimante cashier est fait ici) ; verrou anti double-fire concurrent tablette.

---

## 5. Invariants techniques (gate de shippabilité)

- **Aucune écriture de commande nouvelle** : S34 n'ajoute pas de write-path order — l'impression est un side-effect ; `complete_order_with_payment_v10` / `pay_existing_order_v6` inchangés.
- **Idempotence d'impression** : `printedItemIds` empêche le double-ticket sur re-fire / fire→checkout. Une station en échec reste ré-imprimable (pas marquée).
- **Échec visible** (Choix 7) : aucun toast de succès si une station n'a pas imprimé. C'est la règle qui empêche de recréer « l'action qui ment ».
- **`packages/domain` IO-free** : `groupItemsByStation` pur (pas de fetch/print dedans).
- **Pont d'impression = dépendance externe** : le contrat `/print/ticket` est livré côté client ; l'implémentation pont est hors-repo (flag §6). Mode mock pour CI/dev.
- **Pas de PIN/secret concerné** ; pas de realtime nouveau.

---

## 6. Risques & dépendances

1. **Pont d'impression multi-imprimantes (EXTERNE, bloquant pour le repro réel)** : `localhost:3001` ne gère qu'une imprimante. Le routage par poste exige une extension du pont (hors monorepo). Mitigation : contrat figé §2 Choix 4 + mode mock pour valider le routage sans matériel ; le repro physique attend le pont.
2. **0 imprimante en `lan_devices`** : config à saisir (ops) ; dev seedé en fixture de test. Si la résolution `station→printer` ne trouve pas d'imprimante → toast « no printer configured for [station] » (pas un crash).
3. **Mapping `capabilities.station` non encore convenu** → ratification Wave 0 (vs `location`).
4. **Items en catégorie `none`** (ex. Ingredient, ou produits sans station) → aucun ticket (volontaire). Vérifier qu'aucun produit vendable ne tombe en `none` par erreur après la remap (Beverage/Pastry/Bread/Sandwiches sont remappés ; rien de vendable ne reste `none`).
5. **Double-fire concurrent** (2 terminaux sur la même table tablette) → hors scope S34 (pas de verrou serveur sans draft order) ; risque faible, documenté pour S35.

---

## 7. Tests (Wave 4)

- **Domain unit `groupItemsByStation`** : (a) groupe correctement barista/kitchen/display ; (b) ignore les items `none` ; (c) panier vide → {} ; (d) item sans station mappée → bucket `none`/ignoré.
- **pgTAP `category_station_remap.test.sql`** (≤3 cas) : T1 Beverage=`barista`, Sandwiches=`kitchen`, Bread/Pastry/Viennoiserie/Bagel=`display` ; T2 idempotence (re-run = no-op) ; T3 aucun produit actif vendable ne reste `none` (hors Ingredient).
- **POS smoke** : (a) `fire-to-stations.smoke` — fire d'un cart mixte → `printStationTicket` appelé 1×/poste prep, payload `prep` sans prix, `printedItemIds` posé pour les succès ; (b) `fire-printer-unreachable.smoke` — imprimante kitchen KO → toast erreur kitchen, item kitchen NON marqué imprimé, items barista marqués ; (c) `checkout-autofire-unprinted.smoke` — items prep non-imprimés → auto-fire au checkout, pas de double-print ; (d) `print-bill.smoke` — « Print Bill » → payload `bill` (commande entière, totaux, **sans** payment) vers imprimante cashier (comptoir) / waiter (tablette) ; (e) `receipt-targets-cashier.smoke` — checkout → `receipt` routé vers l'imprimante `cashier` résolue.
- **Mode mock** : tests tournent avec `VITE_PRINT_MOCK=1` (le pont enregistre les payloads au lieu d'imprimer).
- **Repro réel (dépend du pont)** : 1 commande mixte (latte + sandwich + pain) → 3 tickets aux 3 imprimantes (barista/kitchen/display) ; reçu au comptoir. À faire quand le pont multi-imprimantes est livré.
- **Non-régression** : `pnpm typecheck` ; `pnpm --filter @breakery/domain test` ; `pnpm --filter @breakery/app-pos test payment cart`.

---

## 8. Definition of Done

- [ ] Migration `_010` appliquée (remap catégories prep) ; pgTAP remap PASS.
- [ ] `groupItemsByStation` (domain) + unit PASS.
- [ ] `printStationTicket` + `useStationPrinters` + `useFireToStations` + `usePrintBill` livrés ; `useSendToKitchen` fake supprimé/remplacé.
- [ ] « Send to Kitchen » imprime réellement par poste prep (mode mock vérifié) ; toasts honnêtes par poste ; échec visible (Choix 7).
- [ ] « Print Bill » imprime la note (commande entière, sans paiement) → cashier/waiter ; reçu (`receipt`) reciblé sur l'imprimante cashier.
- [ ] Checkout auto-fire les prep non-imprimés ; pas de double-ticket.
- [ ] POS smoke + typecheck PASS.
- [ ] **Dépendance externe documentée** : contrat `/print/ticket` remis à l'équipe pont d'impression ; repro physique tracé S34-FOLLOWUP quand le pont est prêt.
- [ ] INDEX §deviations + CLAUDE.md workplan bumpés ; écrans (kitchen KDS + waiter) explicitement tracés S35.
