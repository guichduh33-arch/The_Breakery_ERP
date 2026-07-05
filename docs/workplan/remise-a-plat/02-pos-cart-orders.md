# Module 02 — Caisse : panier & commandes

> ⚠️ **Mise à jour S60 (2026-07-05, `swarm/session-60`)** : **D1.1 livré** — le CTA « Pay » de `/pos/debts` charge la créance dans le panier (`useLoadDebtOrder`, mirror pickup) et l'encaissement route vers `pay_existing_order_v11` ; lignes B2B exclues (hint « settle in Backoffice »). Le B1.7 passe 🟠→✅ pour l'ardoise retail (D1.2 « bouton Ardoise nommé » reste ouvert). Voir `docs/workplan/plans/2026-07-05-session-60-INDEX.md`.

> **Remise à plat — analyse comparative.** Doc : Description v1.2 (2026-07-03), module 2. Code : commit `5b0fa92` (2026-07-03).
> **Statut annoncé par la doc :** Opérationnel
> **Verdict global de l'analyse :** La doc est largement fidèle au code — le cœur (panier, envoi cuisine verrouillé, hold/reprise, promos serveur, void gaté PIN, tablette) est réel et câblé ; deux surclamations légères : l'« ardoise » est un flux implicite sans action dédiée, et le tarif négocié ne se recalcule pas si on lie le client après coup (la doc le classe d'ailleurs en « à venir »).

## A. Ce qui fonctionne réellement (code vérifié)

- **Gate session** : pas de vente sans session ouverte — côté client `useCheckout` jette `no_open_shift` (`apps/pos/src/features/payment/hooks/useCheckout.ts:65`) ET côté serveur `complete_order_with_payment_v17` vérifie la session `open` (`supabase/migrations/20260710000092_complete_order_v17_combo_pricing_promo_caps.sql:192-197`, P0001). Alerte `ShiftClosedState` + `OpenShiftModal` montés dans `apps/pos/src/pages/Pos.tsx:200-208`. [UI câblée]
- **Types de service** : Dine-In / Take-Out / Delivery via tabs (`apps/pos/src/features/cart/ActiveOrderPanel.tsx:47-51`), forwardés en `order_type` jusqu'au RPC. [UI câblée]
- **Choix de table sur plan de salle** : `TableSelectorButton` ouvre `FloorPlanModal` (sections + occupation) — `apps/pos/src/features/tables/components/TableSelectorButton.tsx:14,43` ; occupation temps réel + refetch 30 s (`apps/pos/src/features/tables/hooks/useTableOccupancy.ts:33-39`). [UI câblée]
- **Options (modifiers)** et **variantes** : `VariantSelectModal` (`apps/pos/src/features/cart/VariantSelectModal.tsx`), modifiers portés sur chaque ligne et re-pricés serveur (`_resolve_line_price_v1`, S51). **Formules/combos** : `ComboConfigModal` (`apps/pos/src/features/combos/components/ComboConfigModal.tsx`) ; composition validée ET facturée serveur via `_resolve_combo_price_v1` (`supabase/migrations/20260710000090_resolve_combo_price_v1.sql`) dans v17. [UI câblée]
- **Envoi cuisine + verrouillage** : `SendToKitchenButton` → `useFireToStations` persiste via `fire_counter_order_v4` (idempotent `p_client_uuid`) puis imprime par poste (`apps/pos/src/features/cart/hooks/useFireToStations.ts:1-120`) ; lignes verrouillées (`cartStore.lockedItemIds`, `canEdit` — `apps/pos/src/stores/cartStore.ts:335`), rendu « Sent to kitchen — locked » (`apps/pos/src/features/cart/CartLineRow.tsx:13-14,101`). Retrait d'une ligne envoyée = EF `cancel-item` avec **PIN manager en header `x-manager-pin` + motif + idempotency** (`apps/pos/src/features/cart/hooks/useCancelOrderItem.ts:41-59`) → `cancel_order_item_rpc_v3` (replay S55, `supabase/migrations/20260710000083`, EF-only `_084`). [UI câblée]
- **Mise en attente / reprise** : drafts via `hold_order_v1` / `restore_held_order_v1` / `discard_held_order_v1` (gate `orders.void`, motif ≥ 10 chars) (`apps/pos/src/features/heldOrders/hooks/useHoldOrder.ts`, `useRestoreHeldOrder.ts`, `useDiscardHeldOrder.ts`) ; commandes **déjà envoyées en cuisine** : `hold_fired_order_v1` / `reopen_held_order_v1` qui préservent les ids + verrous (`apps/pos/src/features/heldOrders/hooks/useReopenHeldOrder.ts:8-12` ; fixes récents `supabase/migrations/20260710000097..098`). Inbox held orders realtime multi-terminaux (`useHeldOrdersRealtime.ts`). [UI câblée]
- **Client lié + tarif négocié** : recherche/création via RPC definer `search_customers_v3` / `create_customer_v2` (`apps/pos/src/pages/Pos.tsx:96-119`) ; le prix par catégorie client est résolu **à l'ajout au panier** via RPC `get_customer_product_price` (`apps/pos/src/features/products/ProductTapHandler.tsx:26,49` ; hook `apps/pos/src/features/customerCategories/hooks/useCustomerProductPrice.ts`). Fidélité : points résolus serveur (multiplicateur tier × catégorie, S44), affichage `LoyaltyPointsLine`. [UI câblée]
- **Remise** : `DiscountModal` exige un motif ≥ 5 chars et **un PIN manager pour TOUTE remise** (pas seulement au-delà d'un seuil) — `packages/ui/src/components/DiscountModal.tsx:4-6,35-37` ; vérification finale in-EF + nonce `discount_authorizations` (S55). [UI câblée]
- **Promotions auto** : `usePromotionsAutoEval` + `usePromotionsRealtime` ancrés dans le panneau (`apps/pos/src/features/cart/ActiveOrderPanel.tsx:71-73`) sur `evaluate_promotions_v2` (caps S57) ; le serveur re-valide et fixe les prix de ligne (v17 canonical, `_092`). [UI câblée]
- **Ardoise (implicite)** : une commande envoyée (fired) et non payée reste en créance ; panneau `/pos/debts` (`apps/pos/src/features/customers/CustomerDebtsPanel.tsx`, hook `useOutstandingDebts.ts:47` sur `get_pos_b2b_debts_v3`) ; le solde passe par le détail historique → `pay_existing_order_v11` (`useCheckout.ts:169`). [UI câblée]
- **Void / remboursement** : `useVoidServerOrder` (client-only si jamais persisté, sinon EF `void-order` PIN header) (`apps/pos/src/features/cart/hooks/useVoidServerOrder.ts:27-50`) ; `VoidOrderModal`/`RefundOrderModal` dans l'historique (`apps/pos/src/features/order-history/components/`) → `void_order_rpc_v4` / EF `refund-order` (replay idempotent S55, `_082`). Restock (`sale_void` via ledger) + JE de contrepassation gérés par les RPCs. [UI câblée]
- **Réception tablette** : inbox `TabletInboxModal` + `usePickupTabletOrder` → RPC `pickup_tablet_order` (`apps/pos/src/features/inbox/hooks/usePickupTabletOrder.ts`). [UI câblée]
- **Clôture de journée** : comptage tiroir + écart + récap via `CloseShiftModal`/`close_shift_v2` (détail au module 12). [UI câblée]
- **En plus de la doc** : broadcast panier vers l'écran client (`useCartBroadcast`, `ActiveOrderPanel.tsx:73`) ; avertissement « article routé nulle part » au fire (`useFireToStations.ts:72-79`) ; print bill pré-paiement (`PrintBillButton`).

## B. Ce que la doc demande

### B1. Revendiqué comme fonctionnant (« Ce qu'on peut faire aujourd'hui »)
- B1.1 Ouvrir la journée en comptant le fond de caisse ; sans session ouverte, aucune vente possible.
- B1.2 Commande sur place (choix de table sur plan de salle), à emporter ou en livraison ; options et formules.
- B1.3 Envoi cuisine : articles verrouillés ; retrait d'un article en préparation impossible sans code manager (anti-fraude).
- B1.4 Mettre une commande en attente, puis la reprendre.
- B1.5 Lier un client (fidélité, tarif négocié auto) ; remise au-delà du seuil : validation manager + motif obligatoires.
- B1.6 Promotions actives auto-appliquées ; le système central vérifie et fixe lui-même les prix (appareil trafiqué inoffensif).
- B1.7 Ouvrir une ardoise pour un habitué et la solder en dix secondes à son retour.
- B1.8 Annuler/rembourser : code manager + motif, remise en stock et écriture comptable automatiques.
- B1.9 Recevoir les commandes tablette ; fermer la journée avec comptage, écart calculé et récapitulatif.

### B2. Annoncé « À venir »
- B2.1 Mode coupure internet (panne = encaissement bloqué aujourd'hui).
- B2.2 Sauvegarde de secours du panier en cours de saisie.
- B2.3 Recalcul des prix quand on change de client en cours de panier.
- B2.4 Réservations avec acompte.
- B2.5 Vue « tables ouvertes » pour le service en salle.

## C. Écarts (revendications vs code)

| # | Revendication doc | Réalité code | Verdict |
|---|---|---|---|
| B1.1 | Session obligatoire pour vendre | Gate client (`useCheckout.ts:65`) + serveur (v17 `_092:192-197`) ; ouverture avec fond de caisse (`OpenShiftModal`) | ✅ CONFORME |
| B1.2 | Sur place (plan de salle) / emporter / livraison ; options ; formules | 3 order_types (`ActiveOrderPanel.tsx:47-51`), `FloorPlanModal` avec occupation, modifiers + combos validés/pricés serveur (v17) | ✅ CONFORME |
| B1.3 | Verrouillage après envoi ; retrait = code manager | `lockedItemIds`/`canEdit` + EF `cancel-item` PIN header + motif (`useCancelOrderItem.ts:47`) | ✅ CONFORME |
| B1.4 | Mise en attente / reprise | Drafts (`hold_order_v1`) ET commandes fired (`hold_fired_order_v1`/`reopen_held_order_v1`), inbox realtime | ✅ CONFORME |
| B1.5 | Client lié, tarif négocié auto ; remise au-delà du seuil = manager+motif | Tarif catégorie appliqué à l'ajout (`ProductTapHandler.tsx:49`) mais PAS recalculé si client lié après (toast explicite `Pos.tsx:123`) ; remise : PIN + motif pour **toute** remise (plus strict que le seuil annoncé) | ✅ CONFORME (code plus strict ; la limite du non-recalcul est assumée en B2.3) |
| B1.6 | Promos auto ; prix fixés par le serveur | `usePromotionsAutoEval` + v17 : prix de ligne, combos, promos, caps — tous re-validés serveur (client `unit_price` ignoré) | ✅ CONFORME |
| B1.7 | Ouvrir une ardoise, la solder en 10 s | Aucune action « ardoise » dédiée : c'est une commande fired laissée impayée ; visible `/pos/debts`, mais le « Pay » renvoie au détail historique (commentaire `CustomerDebtsPanel.tsx:10-13` : « Inline payment … is deferred ») — pas du 10 s one-tap ; aucun contrôle de plafond de crédit à l'ouverture | 🟠 PARTIEL |
| B1.8 | Void/refund : PIN + motif, restock + JE auto | EF `void-order`/`refund-order` PIN header, `void_order_rpc_v4` contrepasse stock+JE, replay idempotent | ✅ CONFORME |
| B1.9 | Réception tablette ; clôture avec comptage/écart/récap | `TabletInboxModal` + `pickup_tablet_order` ; `close_shift_v2` (variance + JE + Z-draft) | ✅ CONFORME |

**Bonus code (le code fait plus que la doc) :**
- 🔵 PIN manager exigé pour **toutes** les remises, pas seulement au-delà d'un seuil (`DiscountModal.tsx:4-6`).
- 🔵 Hold des commandes **déjà envoyées en cuisine** avec préservation des verrous (`reopen_held_order_v1`) — la doc ne parle que de « mettre en attente ».
- 🔵 Alerte « article non routé vers un poste » au moment du fire (`useFireToStations.ts:72-79`).
- 🔵 Miroir temps réel du panier vers l'écran client (`useCartBroadcast`) + broadcast `payment_complete` (S57).

## D. Plan de correction du module

### D1. Quick wins (< 1 session, pas de spec)
1. **Solder l'ardoise depuis `/pos/debts`** : brancher le CTA « Pay » de `CustomerDebtsPanel.tsx` directement sur le flux `pay_existing_order_v11` (pickup dans le panier via `pickedUpOrderId`) au lieu du détour par l'historique. Done : payer une créance en ≤ 3 taps depuis le panneau debts.
2. **Nommer le flux ardoise** : bouton explicite « Ardoise / Pay later » dans `BottomActionBar` (= fire + attach client obligatoire + toast de confirmation). Done : un caissier peut ouvrir une ardoise sans connaître le flux implicite.

### D2. Chantiers moyens (1 session, plan requis)
1. **Plafond de crédit retail à l'ouverture d'ardoise** : gate serveur dans `fire_counter_order_v4` (ou RPC dédié) comparant l'encours `get_pos_b2b_debts_v3` au plafond client ; UI de refus. (Dépend de la décision produit : plafond par catégorie client ?)
2. **Recalcul des prix au changement de client (B2.3)** : re-résoudre `get_customer_product_price` pour chaque ligne non verrouillée à l'attach/detach (aujourd'hui toast « Re-add items » `Pos.tsx:123`).
3. **Sauvegarde du panier en cours (B2.2)** : persist `cartStore` (zustand persist / IndexedDB) + restauration au boot.
4. **Vue « tables ouvertes » (B2.5)** : la brique existe (`useTableOccupancy`, `FloorPlanModal`) — il manque un écran service listant les commandes ouvertes par table.

### D3. Chantiers lourds (spec dédiée avant code)
1. **Mode offline (B2.1)** : file d'attente locale des encaissements + resync idempotent (les 2 saveurs d'idempotence existent déjà côté serveur, c'est le client/queue qui manque). Spec obligatoire (conflits, stock, promos).
2. **Réservations avec acompte (B2.4)** : nouveau domaine (acompte = paiement partiel avant commande, impact comptable et Z-report).

### D4. Amendements à la doc (si c'est la doc qui doit bouger, pas le code)
1. B1.5 : écrire « toute remise exige validation manager + motif » (le code est plus strict que « au-delà du seuil »).
2. B1.7 : reformuler l'ardoise en « laisser une commande envoyée en attente de paiement, suivie dans l'écran Créances » tant que D1.1/D1.2 ne sont pas faits, et retirer « en dix secondes ».

## E. Dépendances croisées
- **Module 3 (Encaissement)** : même money-path (`process-payment` → v17, `pay_existing_order_v11`) — toute correction ardoise/plafond touche les deux fiches.
- **Module 12 (Shifts)** : gate session, clôture ; **Module 13 (Promotions)** : évaluation/caps serveur ; **Module 4 (KDS)** : fire/routage ; **Module 17 (Tablette)** : pickup ; **Module 8/9 (Clients/B2B)** : tarif négocié, plafond de crédit (D2.1 doit s'aligner sur le plafond B2B existant `create_b2b_order_v3`).
