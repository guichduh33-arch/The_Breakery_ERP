<!-- Audit POS — 2026-07-10 (S72). Skill pos-flow-audit, 5 agents parallèles + vérification main-loop. -->

# Audit du parcours POS commande→paiement — 2026-07-10 (S72)

> **Méthode** : skill `pos-flow-audit`, 5 agents lecture-seule en parallèle (paiement · panier/promos/fidélité · KDS/cuisine · tablette/tables · clôture/display/refund), chacun appliquant le « silent-failure sweep ». Chaque finding est fondé sur un `file:line` réellement lu. Les findings 🔴/🟠 confirmés en DB ont été re-vérifiés par le main-loop contre le projet dev `ikcyvlovptebroadgtvd`.
> **Bilan** : 1 P0, 7 P1, 13 P2, ~13 P3. Ce document sert de backlog priorisé ; les items **✅ CORRIGÉ S72** sont livrés dans la PR associée.

## Résumé exécutif

Le **socle transactionnel serveur est solide** (money-path v17 autoritaire : totaux/taxe/prix recalculés serveur, taxe PB1 extraite, idempotence UNIQUE + pré-check, nonce discount PIN S55, comptage aveugle anti-fraude, held orders DB-backed, PIN refund/void en header). Les défauts se concentrent sur **un piège d'attribution systémique** (auth.uid() écrit dans des colonnes FK `user_profiles`), la **surface tablette** (invariants non répliqués vs le comptoir), et des **écarts d'affichage/UX** (reçu, split, realtime multi-station).

**Découverte-clé (P0)** : plusieurs RPCs écrivaient `auth.uid()` (l'`auth_user_id`) dans des colonnes contraintes par une **FK vers `user_profiles(id)`**. Comme `user_profiles.id = gen_random_uuid() ≠ auth_user_id` pour tout employé créé par la vraie chaîne d'embauche (`create_user_v1`), l'écriture lève `foreign_key_violation` et **fait rollback toute la transaction**. Les 2 comptes seed (`id == auth_user_id`) masquaient le bug — aucun test ne l'exerçait. Sweep live après correction : **plus aucune fonction** n'écrit une colonne FK-`user_profiles` `= auth.uid()` (UPDATE-style).

## 🔴 P0 — Corrige une opération quotidienne

### 1. `close_shift` : `closed_by`/audit `actor_id` = `auth.uid()` → clôture de caisse impossible pour un employé réel — ✅ **CORRIGÉ S72**
`close_shift_v5:286` écrivait `closed_by = v_uid` (auth id) dans `pos_sessions.closed_by` (FK `user_profiles.id`) ; **et** le 2ᵉ insert `audit_logs` (`zreport.draft_created`) utilisait `v_uid` comme `actor_id` (aussi FK). Deux violations → toute la clôture rollback → pas de JE d'écart, pas de draft Z-report, **tiroir infermable**.
→ `close_shift_v6` (migration `20260710000142`) : les deux passent à `v_profile`. Corps live verbatim, DROP v5, trio REVOKE, caller bumpé, types regen. **pgTAP 5/5 live** (`close_shift_v6_closed_by_profile.test.sql`) exerçant un user `id ≠ auth_user_id`.

## 🟠 P1 — Friction fréquente / risque réel

### 2. KDS `mark_item_served` : `served_by = auth.uid()` (FK) + aucun gate de permission — ✅ **CORRIGÉ S72**
`order_items.served_by` est FK `user_profiles.id` → « servi » cassé pour les users réels (même racine que le P0). De plus, seul RPC KDS **sans** gate (`kds.operate`). anon n'avait déjà plus l'EXECUTE (révoqué), mais le corps était ouvert à tout `authenticated`.
→ migration `20260710000143` : `served_by = v_profile` + gate `has_permission(auth.uid(),'kds.operate')` + trio REVOKE. **pgTAP 4/4 live** (`mark_item_served_gate_and_profile.test.sql`).

### 3. Tablette : commande dine-in envoyable SANS table — ✅ **CORRIGÉ S72**
`TabletOrderPage.handleSend` ne vérifiait que `userId && !isEmpty` ; `create_tablet_order_v3` n'avait aucune garde `table_required`. L'invariant propriétaire « table obligatoire en salle » (2026-07-07) n'existait que sur le comptoir (`fire_counter_order_v4` P0011). Une commande `dine_in` `table_number=''` → KOT sans table + occupation fantôme.
→ garde UI (`handleSend` : bloque + ouvre le plan de salle) **et** filet serveur `create_tablet_order_v4` (migration `20260710000144`, mirror exact de `fire_counter_order_v4` : `table_required_for_dine_in`/P0011). Caller bumpé, types regen. **pgTAP 4/4 live** (`create_tablet_order_v4_table_guard.test.sql`).

### 4. Tablette : pickup écrase le panier POS en cours — ✅ **CORRIGÉ S72**
`usePickupTabletOrder` appelait `restoreCart` sans condition ; ouvrir l'inbox en plein encaissement walk-in effaçait le panier sans confirmation.
→ garde client : refus (toast) si `unlockedItemIds().length > 0` ou une commande tablette est déjà chargée (`pickedUpOrderId`), **avant** le claim RPC.

### 5. Tablette : pickup partiel piège la commande en `draft` — ⏳ **FOLLOW-UP**
`usePickupTabletOrder.ts:46-59` : le claim RPC (`pending_payment → draft`) réussit, puis un `select` séparé des lignes ; si ce fetch échoue, la commande a quitté l'inbox, panier non restauré, **irrécupérable**. Fix propre = `pickup_tablet_order` retourne `order + items` atomiquement (reshape RPC + parsing client ; implications RLS à valider) → hors périmètre de cette PR.

### 6. Clôture : deadlock d'approbation si seul un volet non-cash dépasse le seuil PIN — ✅ **CORRIGÉ S72**
`CloseShiftModal.tsx` calculait `pinRequired`/`noteRequired` sur le **cash seul** ; le serveur (`close_shift_v6`) déclenche `pin_approval_required`/`variance_note_required` sur les 3 volets. Le **comptage aveugle** cache l'expected QRIS/carte au client → impossible de répliquer l'OR. Fix : le `catch` du submit arme `serverPinRequired`/`serverNoteRequired` sur le renvoi serveur → révèle la section approbateur/note pour un resubmit, au lieu de boucler sur un toast.

### 7. Paiement : le tiroir-caisse s'ouvre pour tout paiement carte/QRIS — ✅ **CORRIGÉ S72**
`SuccessModal.tsx` : `openCashDrawer()` était gardé par le seul réglage `autoOpenDrawer`. Fix : `needsDrawer = paymentMethod === 'cash' || changeGiven > 0` gate désormais **l'appel** (couvre un split avec cash) — une vente carte/QRIS pure ne pope plus le tiroir.

### 8. Panier : multiplicateur de fidélité en branche morte — ✅ **CORRIGÉ S72**
Nouveau helper domaine partagé **`resolveLoyaltyMultiplier(lifetime_points, categoryMultiplier)`** (tier × catégorie, source unique) ; `LoyaltyPointsLine` reçoit le multiplicateur (via `ActiveOrderPanel`) et `OrderSummaryPanel` est dédupé sur le même helper → le panier affiche enfin les points au bon palier, identiques à l'écran de paiement. Tests domaine + smoke mis à jour (Gold ×1.1 : 35→38 pts).

## 🟡 P2 — À corriger (toutes ⏳ FOLLOW-UP)

| # | Finding | Preuve |
|---|---|---|
| 9 | Reçu/display mentent sur la méthode en split-tender (1er tender seulement) | `usePaymentFlowLogic.ts:212`, `SuccessModal.tsx:126-189` |
| 10 | Split « par article » cassé dès qu'il y a remise/promo (sous-totaux pré-remise → `sum_mismatch` → finalisation bloquée) | `split/ItemAssignStep.tsx:55-64` vs `usePaymentFlowLogic.ts:87` |
| 11 | `cart.promotionTotal` = champ mort neutralisant le garde `post_promotion<0` du domaine | `packages/domain/src/cart/calculateTotals.ts:51-55` |
| 12 | Estimation fidélité de secours ignore le multiplicateur de catégorie | `usePaymentFlowLogic.ts:208`, `earnPoints.ts:19-23` |
| 13 | KDS multi-station : un seul `kitchen_status` partagé (bump cuisine ⇒ ready sur display) | `fire_counter_order_v4:253-271`, `useKdsOrders.ts:133-138` |
| 14 | KDS realtime filtre le scalaire `dispatch_station` → aucun push live vers la station secondaire | `useKdsRealtime.ts:80` vs `useKdsOrders.ts:134` |
| 15 | Pas de réimpression KOT si l'imprimante cuisine tombe (items scellés après le RPC) | `useFireToStations.ts:206-208` |
| 16 | Idempotence `create_tablet_order` : INSERT orders hors savepoint → commande orpheline sur double-appel concurrent | `create_tablet_order` body (idem key insert après la commande) |
| 17 | Split BILL (par convive) inexistant : breakdown jeté, pas de reçu par convive | `payment/split/types.ts:2-8`, `SplitPaymentFlow.tsx` |
| 18 | Transfert de table ne déplace que la commande la plus récente si la table en porte plusieurs | `useTableOrders.ts:6-7`, `transfer_order_table_v1` |
| 19 | Pas de reprint du reçu de vente original depuis l'historique | `OrderDetailDrawer.tsx:124-144` |
| 20 | Historique borné au shift ouvert courant (aucun void/refund/reprint J+1 en caisse) | `useOrderHistory.ts:70-84` |
| 21 | Customer display via `BroadcastChannel` same-origin → écran client sur device séparé ne reçoit jamais le miroir/merci | `useCartBroadcast.ts:47`, `CustomerDisplayPage.tsx:45-71` |

## ⚪ P3 — Polish / stratégique (⏳ FOLLOW-UP)
Reçu split `cash_received:0` · horodatage reçu = horloge client · double-submit → 500 au lieu de replay idempotent · pas de coursing/séquencement · `served_at`/`served_by` dormant (métrique rotation table) · pas de refetch KDS au reconnect `SUBSCRIBED` · constantes fidélité hardcodées (`loyalty/constants.ts`) · pas de hint « à 1 item du seuil » (upsell) · notes par ligne tablette absentes · prédicat « table occupée » dupliqué en 3 endroits · affordance « restore » trompeuse sur table occupée · « Close Shift » no-op si le résumé échoue à charger · `LiveSessionsModal` lecture seule + libellé « cash » trompeur.

## ✅ Vérifié SAIN (faux positifs écartés)
Money-path v17 autoritaire · idempotence order UNIQUE + pré-check · PIN refund/void/discount en header `x-manager-pin` · nonce discount PIN (S55) · comptage aveugle anti-fraude réel · gardes note+PIN+coupures enforced serveur · held orders DB-backed idempotents (confirm dialog anti-écrasement) · default `order_type = take_out` correct · canal KDS unique par mount (testé) · double-claim inbox bloqué serveur (`P0012`) · transfert de table atomique `FOR UPDATE` · `useDisplayRealtime` reconnect-invalidate OK.

## Livré dans la PR S72
- **P0-1** `close_shift_v6` (FK closed_by + audit actor_id) · migration `_142` + pgTAP 5/5.
- **P1-2** `mark_item_served` (FK served_by + gate `kds.operate` + REVOKE) · migration `_143` + pgTAP 4/4.
- **P1-3** dine-in table obligatoire tablette : garde UI + `create_tablet_order_v4` · migration `_144` + pgTAP 4/4.
- **P1-4** pickup n'écrase plus le panier en cours (garde client).
- **P1-6** deadlock approbation clôture 3-volets (révélation section sur renvoi serveur).
- **P1-7** tiroir conditionnel à la méthode/monnaie.
- **P1-8** multiplicateur fidélité panier (helper domaine `resolveLoyaltyMultiplier`).
- Callers bumpés (`close_shift_v6`, `create_tablet_order_v4`) + types regen + tests POS/domaine mis à jour (238 POS + 22 domaine loyalty).

## Reste-à-faire priorisé (follow-ups)
1. **P1-5** pickup atomique (reshape `pickup_tablet_order` retournant les items) — migration + RLS.
2. **P2** lot reçu/split (9,10,12,17), KDS multi-station realtime (13,14), reprint/historique (15,19,20), customer-display transport (21).
3. **P3** — voir §P3 (dont : le champ mort `cart.promotionTotal` #11, constantes fidélité hardcodées, refetch KDS au reconnect).

> **P1 tous traités** hormis le pickup atomique (#5) qui exige un reshape RPC. Les 7 P1 de l'audit : 4 corrigés dans le 1ᵉʳ lot (P0 close_shift, mark_item_served, dine-in table, pickup-cart) + 3 quick-wins client corrigés dans le 2ᵉ lot (deadlock clôture, tiroir, fidélité panier).
