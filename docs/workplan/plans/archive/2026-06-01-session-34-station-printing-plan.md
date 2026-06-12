# Session 34 — Station Ticket Printing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Router les items d'une commande vers les **imprimantes de poste** (barista / kitchen / bakery / cashier) au moment du « Send to Kitchen » et du checkout — remplacer le `useSendToKitchen` mensonger (markLocked client-only) par une vraie impression par station, avec échec visible. Écrans KDS (kitchen + waiter) **déférés S35**.

**Architecture:** 4 waves. 5 imprimantes (`lan_devices` type='printer'), 2 natures : prep (barista/kitchen/bakery, routage par item) + document (cashier=reçu+note, waiter=note). 3 kinds : prep|bill|receipt. Wave 0 = ratification (tag imprimante) + état du pont. Wave 1 = 1 migration data (remap catégories prep) + station dans `useProducts`. Wave 2 = domain `groupItemsByStation` + `printService` (kinds + mock + recibler reçu→cashier) + `useStationPrinters` (Map<role,device>) + `useFireToStations` (prep) + `usePrintBill` (note→cashier/waiter) + `cartStore.printedItemIds` + wiring boutons/checkout. Wave 3 = mode mock + sanity. Wave 4 = unit + pgTAP + POS smoke + INDEX + CLAUDE.md + remise contrat pont.

**Tech Stack:** Supabase cloud V3 dev (`ikcyvlovptebroadgtvd`), pnpm/turbo monorepo, React Query + Vitest, pont d'impression externe `localhost:3001` (hors-repo).

**Spec:** [`../specs/2026-06-01-session-34-station-printing-spec.md`](../../specs/archive/2026-06-01-session-34-station-printing-spec.md)
**Branch:** `swarm/session-34` (à créer depuis `master` @ `dafc500`)

---

## Wave 0 — ratification & pré-vérifications (BLOQUANT)

- [ ] **W0.1** Créer `swarm/session-34` depuis `master` @ `dafc500` ; committer spec + plan (`docs(workplan): session 34 — station ticket printing spec + plan`).
- [ ] **W0.2 — RATIFICATION USER** :
  - [x] **Tag imprimante tranché (2026-06-01)** : `lan_devices.capabilities->>'station'` (valeurs `barista|kitchen|bakery|cashier|waiter`).
  - [x] **Rôle `cashier`/`waiter` tranché (2026-06-01)** : ce ne sont PAS des destinations d'item (`dispatch_station`) mais des imprimantes de **document**. `cashier` = seule à imprimer le **reçu** (`receipt`) + peut imprimer la **note** (`bill`) ; `waiter` = imprime la **note** (`bill`, commande entière). 3 kinds : prep/bill/receipt.
- [x] **W0.3 — PONT D'IMPRESSION tranché (2026-06-01)** : S34 livre le **contrat `/print/ticket` + mode mock** (`VITE_PRINT_MOCK`) ; l'acceptation S34 se fait en mock. L'extension physique multi-imprimantes du pont `localhost:3001` = **tâche externe S34-FOLLOWUP** (propriétaire à assigner) — ne bloque pas S34.
- [x] **W0.4 ✅** `useProducts` (`:22`) n'expose PAS `dispatch_station` → à étendre (W1.2).
- [x] **W0.5 ✅** Après remap : 0 produit vendable actif en `none` (seul Ingredient, 0 produit).

---

## File Structure (overview)

### New / changed (DB)
```
supabase/migrations/
  20260601043059_remap_categories_dispatch_station_printer_model.sql   (✅ APPLIQUÉ)
supabase/tests/
  category_station_remap.test.sql
```

### New / changed (domain + POS)
```
packages/domain/src/printing/
  groupItemsByStation.ts                         (NEW, pure)
  __tests__/groupItemsByStation.test.ts          (NEW)
  index.ts                                        (export Station + helper)
apps/pos/src/services/print/printService.ts       (EXTEND: StationTicketPayload kind prep|bill|receipt + printStationTicket + mock + recibler printReceipt→cashier)
apps/pos/src/features/products/hooks/useProducts.ts (EXTEND select: dispatch_station)  [si absent]
apps/pos/src/features/cart/hooks/useStationPrinters.ts   (NEW — Map<role,device>)
apps/pos/src/features/cart/hooks/useFireToStations.ts    (NEW — remplace useSendToKitchen, prep only)
apps/pos/src/features/cart/hooks/usePrintBill.ts          (NEW — note/addition → cashier|waiter)
apps/pos/src/features/cart/hooks/useSendToKitchen.ts     (DELETE ou re-export deprecated)
apps/pos/src/features/cart/SendToKitchenButton.tsx       (REWIRE useFireToStations + toasts par poste)
apps/pos/src/features/cart/PrintBillButton.tsx            (NEW — bouton note)
apps/pos/src/features/cart/ActiveOrderPanel.tsx           (monter PrintBillButton)
apps/pos/src/features/payment/hooks/useCheckout.ts       (auto-fire prep non-imprimés post-paiement)
apps/pos/src/features/payment/SuccessModal.tsx            (receipt via imprimante cashier résolue)
apps/pos/src/stores/cartStore.ts                          (printedItemIds + markPrinted + reset)
apps/pos/src/features/cart/__tests__/fire-to-stations.smoke.test.tsx          (NEW)
apps/pos/src/features/cart/__tests__/fire-printer-unreachable.smoke.test.tsx  (NEW)
apps/pos/src/features/cart/__tests__/print-bill.smoke.test.tsx                (NEW)
apps/pos/src/features/payment/__tests__/checkout-autofire.smoke.test.tsx      (NEW)
apps/pos/src/features/payment/__tests__/receipt-targets-cashier.smoke.test.tsx (NEW)
```

---

## Wave 1 — DB + station exposée

- [x] **W1.1 ✅ APPLIQUÉ `20260601043059_remap_categories_dispatch_station_printer_model`** (version cloud-assignée). Beverage→`barista`, Sandwiches→`kitchen`, Pastry/Bread→`bakery` (Viennoiserie/Bagel déjà `bakery`, Plate/Savoury déjà `kitchen`, Ingredient `none`). **CHECK existant** `categories_dispatch_station_check` = `kitchen|barista|bakery|none` → réutilise `bakery` (pas de migration de contrainte). Résultat vérifié : barista=13, kitchen=16, bakery=27, none=0 vendable. Fichier miroir écrit.
- [ ] **W1.2** Étendre `useProducts` (`apps/pos/src/features/products/hooks/useProducts.ts:22`) — le select n'expose PAS `dispatch_station` (vérifié W0.4) : ajouter l'embed `categories(dispatch_station)` → aplatir en `dispatch_station` par produit. Étendre le type `Product` (`@breakery/domain`) : `dispatch_station?: 'barista'|'kitchen'|'bakery'|'none'`.
- [ ] **W1.3** Pas de regen types nécessaire (aucune signature RPC changée) — sauf si `Product`/types touchés (regen non lié DB).

---

## Wave 2 — domain + impression + wiring

- [ ] **W2.1 `groupItemsByStation` (domain pur).** `(items: {id, product_id, name, quantity, modifiers}[], stationByProductId: Record<string, Station|'none'>) → Partial<Record<Station, Item[]>>`. Ignore `none`. Export `Station` type. Unit tests co-localisés.
- [ ] **W2.2 `printService.ts`** : `interface StationTicketPayload` (kind `prep|bill|receipt`, spec §2 Choix 4) ; `printStationTicket(printer:{ip_address,port}, payload) → {success,error?}` (POST `/print/ticket`, timeout 5s) ; **mode mock** (`import.meta.env.VITE_PRINT_MOCK` → buffer module-level + `success:true`). Garder `printReceipt` mais accepter une cible imprimante (cashier).
- [ ] **W2.3 `useStationPrinters`** : sur `useLanDevices({deviceType:'printer'})`, `Map<role, {ip_address,port,name}>` depuis `capabilities.station` (rôles `barista|kitchen|bakery|cashier|waiter`, selon W0.2). Rôle sans imprimante → absent (géré aval).
- [ ] **W2.4 `cartStore.ts`** : `printedItemIds: string[]` + `markPrinted(ids)` + `unprintedItems()/unprintedItemIds()` ; reset `[]` dans `clear()`/`resetCartAfterCheckout()` ; dans `partialize`.
- [ ] **W2.5 `useFireToStations`** (remplace `useSendToKitchen`, **prep only**) : `unprintedItems()` → `groupItemsByStation` (barista/kitchen/bakery) → par poste : résoudre imprimante ; absente → `{role, ok:false, error:'no_printer'}` ; sinon `printStationTicket(kind:'prep')`. Agréger `results[]` ; `markPrinted` des items des postes `ok:true`.
- [ ] **W2.6 `usePrintBill`** : construit un payload `bill` de la **commande entière** (items + totaux via `calculateTotals`, **sans** payment) → imprime sur l'imprimante `cashier` (comptoir) ou `waiter` (tablette/table picked-up) selon contexte. Ré-imprimable (pas de marquage). Échec → toast.
- [ ] **W2.7 `SendToKitchenButton.tsx`** : `useFireToStations` ; toast **par poste** (succès/échec + Reprint, Choix 7) ; retirer commentaire mensonger ; disabled si `unprintedItems().length===0`. **`PrintBillButton.tsx`** (nouveau) monté dans `ActiveOrderPanel` → `usePrintBill`.
- [ ] **W2.8 `useCheckout.ts`** : après paiement, auto-fire prep non-imprimés (`useFireToStations`) ; ne PAS bloquer le succès paiement sur échec imprimante prep (toast + reprint). **`SuccessModal`** : `printReceipt` reciblé sur l'imprimante `cashier` résolue (kind `receipt`). Contenu du reçu (méthode/total) = findings P1 séparés, non touchés ici.
- [ ] **W2.9 `pnpm typecheck`.**

---

## Wave 3 — mock & sanity (pas d'écran)

- [ ] **W3.1** Vérifier le mode mock : `VITE_PRINT_MOCK=1` → `useFireToStations` enregistre les payloads, aucun appel réseau. Exposer un getter de buffer pour les tests.
- [ ] **W3.2** Sanity manuelle (`execute_sql`) : après `_010`, `SELECT name, dispatch_station FROM categories ORDER BY dispatch_station` = mapping attendu.

---

## Wave 4 — tests, doc, remise contrat

- [ ] **W4.1 Domain unit** `groupItemsByStation.test.ts` (4 cas, spec §7).
- [ ] **W4.2 pgTAP** `category_station_remap.test.sql` (T1 mapping, T2 idempotence, T3 aucun vendable en `none`) via MCP `execute_sql` enveloppe `BEGIN…ROLLBACK`.
- [ ] **W4.3 POS smoke** : `fire-to-stations`, `fire-printer-unreachable`, `checkout-autofire`, `print-bill` (note commande entière sans payment → cashier/waiter), `receipt-targets-cashier` (spec §7) — sous `VITE_PRINT_MOCK`.
- [ ] **W4.4 Non-régression** : `pnpm typecheck` ; `pnpm --filter @breakery/domain test` ; `pnpm --filter @breakery/app-pos test payment cart`.
- [ ] **W4.5 Remise contrat pont (dépendance externe)** : documenter le contrat `/print/ticket` (spec §2 Choix 4) dans `docs/reference/` ou ticket dédié ; ouvrir le suivi « pont multi-imprimantes » ; tracer le repro physique en S34-FOLLOWUP.
- [ ] **W4.6 INDEX** `docs/workplan/plans/2026-06-01-session-34-station-printing-INDEX.md` : waves, deviations, mapping catégories, dépendance pont, hors-scope (écrans S35).
- [ ] **W4.7 CLAUDE.md** : bump « Active Workplan » (Current session → S34 station printing) + bloc « Session 34 reference » + migration `20260601043059`. **Tracer explicitement S35** : kitchen KDS revival (`is_locked`/`kitchen_status`/draft order — finding audit original) + écran waiter (commande groupée).
- [ ] **W4.8 PR** `swarm/session-34` → `master`. Titre `feat(pos): session 34 — station ticket printing (route fired items to barista/kitchen/bakery printers)`.

---

## Deviations log (à remplir en cours d'implémentation)

| ID | Sévérité | Description |
|---|---|---|
| _(à compléter Wave 1+)_ | | |

Candidats anticipés :
- **DEV-S34-W0-01** : pivot de direction métier (2026-06-01) — imprimantes d'abord, écrans (kitchen KDS + waiter) déférés S35. Le finding audit original « KDS écran reçoit rien » est ré-adressé via impression ; le revival écran reste à faire S35.
- **DEV-S34-W0-02** : pont d'impression `localhost:3001` mono-imprimante → extension multi-imprimantes = tâche EXTERNE hors-repo. S34 livre contrat + mock ; repro physique différé.
- **DEV-S34-W2-01** : `useSendToKitchen` supprimé/remplacé — vérifier qu'aucun autre consommateur ne l'importe (grep).
- **Hors scope S35+** : kitchen KDS revival (`is_locked`/`kitchen_status`/draft order) + écran waiter ; édition BO map rôle→imprimante ; reçu fidèle au mode de paiement (P1) ; tiroir conditionnel cash (P1) ; verrou anti double-fire concurrent tablette ; catégorie retail routée vers `cashier` (le rôle cashier existe déjà comme imprimante reçu/note).
