# Module 17 — Commande sur tablette

> ⚠️ **Mise à jour S59 (2026-07-04, `swarm/session-59`)** : **D1.1 (note par commande) livré** — `create_tablet_order_v3(+ p_notes)` (DROP v2, trio S20, idempotence préservée) ; textarea `TabletCartPanel` → `orders.notes`, affichée sur le KDS et au pickup caisse ; C-B1.1 n'est plus 🟠 sur la note. La **note par ligne** (D2.1) reste un chantier moyen. Voir `docs/workplan/plans/2026-07-04-session-59-INDEX.md`.

> **Remise à plat — analyse comparative.** Doc : Description v1.2 (2026-07-03), module 17. Code : commit `5b0fa92` (2026-07-03).
> **Statut annoncé par la doc :** Opérationnel pour le service courant
> **Verdict global de l'analyse :** Largement fidèle — identification serveur, plan de salle, envoi idempotent, indicateur hors-ligne, historique et annulation sont réels. Deux écarts notables : **aucune saisie de notes/allergies** (revendiquée comme fonctionnant), et le flux décrit est faux dans le bon sens : la cuisine reçoit la commande **immédiatement** à l'envoi (l'« envoi direct en cuisine » listé « à venir » est déjà le comportement du code) ; la validation caisse ne conditionne que l'encaissement.

## A. Ce qui fonctionne réellement (code vérifié)

- **Routes `/tablet` → `/tablet/order` + `/tablet/orders`**, lazy, avec layout dédié (header serveur + table active + pill online/offline + nav bas 2 onglets avec badge compteur) — `apps/pos/src/routes/index.tsx:92-124`, `apps/pos/src/pages/tablet/TabletLayout.tsx`. [UI câblée]
- **Identification nominative + gating** : session PIN obligatoire (`isAuthenticated`), accès réservé `role_code='waiter'` ou permission `sales.create` ; chaque commande porte `waiter_id` — `TabletLayout.tsx:23-27`, `features/tablet/hooks/useCreateTabletOrder.ts` (payload `p_waiter_id`). [UI câblée]
- **Choix de la table sur plan de salle** : overlay `FloorPlanView` (tables + occupation temps réel via `useRestaurantTables`/`useTableOccupancy`), toggle Dine-in / Take-out, total live — `features/tablet/TabletOrderPage.tsx:76-197`. [UI câblée]
- **Saisie produits** : sidebar catégories + grille produits tactile (cibles ≥ 44 px), panier zustand dédié (`tabletCartStore`), modifiers supportés (`domainAddItem` avec `SelectedModifiers`) — `components/TabletMenuView.tsx`, `TabletProductGrid.tsx`, `stores/tabletCartStore.ts:27-31`. [UI câblée]
- **Envoi idempotent** : `create_tablet_order_v2(p_client_uuid, …)` (migration `20260602000011`, REVOKE anon `_000012`) — clé client `crypto.randomUUID()` gardée dans un `useRef` (survit aux re-renders/retries), **rotée seulement après succès** ; côté SQL, table `tablet_order_idempotency_keys` PK + catch `unique_violation` → renvoie l'order existante (pas de doublon sur double-tap/coupure) — `TabletOrderPage.tsx:95,110-129`, `useCreateTabletOrder.ts:19-25`, migration `20260602000010-11`. [UI + RPC]
- **Accusé de réception** : le succès affiché (« Order sent to kitchen ») n'est émis **qu'au retour du RPC** (la commande est persistée en DB) ; échec → toast d'erreur explicite, panier conservé — `TabletOrderPage.tsx:110-129`. [UI câblée]
- **Envoi direct en cuisine** : `create_tablet_order_v2` insère les items avec `is_locked=true, kitchen_status='pending', sent_to_kitchen_at=now()` et le `dispatch_station` de la catégorie → ils apparaissent **immédiatement** sur le KDS (la query KDS filtre exactement ces flags) — migration `20260602000011:74-110`, `features/kds/hooks/useKdsOrders.ts:128-133`. [RPC]
- **Réception côté caisse** : bouton inbox « tablet orders » sur la barre POS (realtime `orders created_via=tablet` + poll 30 s), pickup par `pickup_tablet_order(p_order_id, p_session_id)` qui recharge la commande dans le panier caisse pour encaissement — `features/inbox/hooks/usePendingTabletOrders.ts`, `usePickupTabletOrder.ts`, mount `features/cart/BottomActionBar.tsx` ; migration `20260507000004`. [UI câblée]
- **Indicateur hors-ligne honnête** : double signal `navigator.onLine` + ping HEAD `auth/v1/health` toutes les 30 s (récupération = les deux OK), bannière + pill « Offline » avec « Last synced … » — `hooks/useTabletOffline.ts`, `components/OfflineBanner.tsx`, pill `TabletLayout.tsx:44-63`. Le bouton « Pick a table » est désactivé hors-ligne. [UI câblée]
- **Menu consultable hors-ligne** : cache localStorage 24 h des catégories+produits, écrit en write-through sur chaque fetch réussi, lu par la grille quand le réseau est mort — `hooks/useTabletMenuCache.ts` (branché dans `TabletMenuView.tsx:26-41`). [UI câblée]
- **Historique « My Orders »** : commandes du serveur connecté (`waiter_id` + `created_via='tablet'`), items avec `kitchen_status` par ligne, statut commande, **annulation** par bouton (RPC `cancel_tablet_order`, migration `20260507000006`) — `pages/tablet/TabletOrdersPage.tsx`, `hooks/useMyTabletOrders.ts`, `useCancelTabletOrder.ts`. ⚠️ Non borné au jour (toutes les commandes du serveur, tri décroissant). [UI câblée]
- **Notification « item prêt »** : toast temps réel quand un item passe `ready`, **dédupliqué** (Set borné 1000 clés — replays realtime absorbés) + resync sur reconnexion — `hooks/useTabletOrderStatusListener.ts` (monté par `TabletOrdersPage`). [UI câblée]
- Sur le disque mais sans consommateur : `features/tablet/hooks/useKioskAuth.ts` (scope kiosque tablette) — la tablette utilise la session PIN, pas le JWT kiosque. [⚫ NON-CÂBLÉ]

## B. Ce que la doc demande

### B1. Revendiqué comme fonctionnant (« Ce qu'on peut faire aujourd'hui »)
- B1.1 Le serveur s'identifie avec son code personnel (commande nominative), choisit la table, tape les produits, **ajoute des notes (« sans lait », allergie)** et envoie.
- B1.2 Accusé de réception explicite de la caisse — pas de commande perdue.
- B1.3 Protection contre les doublons (double-appui, coupure réseau).
- B1.4 Si le wifi tombe : affichage clair « hors ligne » + menu consultable.
- B1.5 Historique de ses commandes **du jour** avec statut (en attente, payée, annulée).
- (Cadrage) « La commande part vers la caisse, le caissier la valide et encaisse ; la cuisine reçoit [ensuite]. La tablette ne touche jamais à l'argent. »

### B2. Annoncé « À venir »
- B2.1 Prise de commande sans internet avec rattrapage automatique (besoin n°1).
- B2.2 Envoi direct en cuisine sans attendre la validation du caissier (en option).
- B2.3 Formules composées complètes sur tablette.
- B2.4 Ergonomie tactile à finaliser.
- B2.5 Transfert propre d'une table d'un serveur à un autre.

## C. Écarts (revendications vs code)

| # | Revendication doc | Réalité code | Verdict |
|---|---|---|---|
| B1.1 | Identification, table, produits, **notes/allergies**, envoi | Identification ✓, plan de salle ✓, produits+options ✓ — mais **aucun champ note** : ni dans `tabletCartStore`, ni dans `buildSubmitPayload` (`packages/domain/src/tablet/buildSubmitPayload.ts` — product_id/quantity/unit_price/modifiers seulement), ni dans `order_items` (pas de colonne note) ; `orders.notes` existe mais n'est jamais alimentée par la tablette | 🟠 PARTIEL |
| B1.2 | Accusé de réception explicite de la caisse | Ack **serveur** réel (toast au retour RPC = commande persistée) + inbox caisse temps réel ; ce n'est pas un ack humain du caissier, mais « pas de commande perdue dans le tuyau » est tenu | ✅ CONFORME |
| B1.3 | Anti-doublons (double-appui, coupure réseau) | ✓ `p_client_uuid` idempotent bout en bout (useRef + table PK + catch unique_violation) — `20260602000010-11` | ✅ CONFORME |
| B1.4 | « Hors ligne » clair + menu consultable | ✓ Double détection réseau, bannière + pill, cache menu 24 h — `useTabletOffline.ts`, `useTabletMenuCache.ts` | ✅ CONFORME |
| B1.5 | Historique **du jour** avec statuts | Historique ✓ avec statuts et annulation, mais **sans borne de date** (tout l'historique du serveur) — `useMyTabletOrders.ts:33-37` | 🟠 PARTIEL |
| B1.6 (cadrage) | La cuisine reçoit **après** validation caisse | Faux : les items partent au KDS **dès l'envoi tablette** (`is_locked=true` à l'insert) ; la validation caisse ne gouverne que l'encaissement. « La tablette ne touche jamais à l'argent » reste vrai (aucun RPC de paiement côté tablette) | 🟠 PARTIEL (doc inexacte sur le flux) |

**Bonus code (le code fait plus que la doc) :**
- 🔵 **B2.2 déjà fait** : l'envoi direct en cuisine sans validation caisse est le comportement actuel (annoncé « à venir »).
- 🔵 Annulation d'une commande tablette par le serveur (`cancel_tablet_order`) — non mentionnée.
- 🔵 Toast « item ready » temps réel dédupliqué + resync reconnexion (le serveur sait quand apporter le plat).
- 🔵 Plan de salle avec occupation temps réel + badge compteur de commandes dans la nav.

## D. Plan de correction du module

### D1. Quick wins (< 1 session, pas de spec)
1. **Notes de commande** (le vrai manquant de B1.1) : champ note libre au niveau commande — textarea dans `TabletCartPanel`, propager dans `buildSubmitPayload` (+ arg `p_notes` sur un bump `create_tablet_order_v3`, écrire `orders.notes` qui existe déjà), afficher sur le KDS et le pickup caisse. Fichiers : `tabletCartStore.ts`, `TabletCartPanel.tsx`, `packages/domain/src/tablet/*`, migration `create_tablet_order_v3` (+ DROP v2), `useCreateTabletOrder.ts`, `KdsOrderCard.tsx`. Done : « sans gluten » saisi tablette, visible cuisine. (Note par ligne = D2.)
2. **Borner l'historique au jour** : filtre `sent_to_kitchen_at >= début de journée (tz magasin)` dans `useMyTabletOrders`. Done : la liste correspond au titre « du jour ».
3. **Supprimer ou câbler `features/tablet/hooks/useKioskAuth.ts`** (code mort trompeur).

### D2. Chantiers moyens (1 session, plan requis)
1. **Notes par ligne** (« sans lait » sur UN cappuccino) : nouvelle colonne `order_items.note` + payload item + rendu KDS/tickets — coordonner avec le module 4 (affichage) et les templates d'impression.
2. **Formules (combos) sur tablette** (B2.3) : le pricing serveur combo existe (`_resolve_combo_price_v1`, S57) mais la money-path passe par la caisse ; il faut que `create_tablet_order_vN` accepte `combo_components` comme `fire_counter_order_v4` le fait déjà.
3. **Transfert de table entre serveurs** (B2.5) : RPC dédié + audit trail + UI.

### D3. Chantiers lourds (spec dédiée avant code)
1. **Mode hors-ligne écrivain avec rattrapage** (B2.1, besoin n°1 doc) : file locale de commandes, rejeu idempotent au retour réseau (le socle `p_client_uuid` rend le rejeu sûr), gestion conflits table/stock — spec obligatoire.

### D4. Amendements à la doc (si c'est la doc qui doit bouger, pas le code)
- Corriger le cadrage : « la commande part **simultanément** en cuisine (KDS) et vers la caisse ; le caissier encaisse ensuite » — et retirer B2.2 de l'à-venir (déjà le comportement).
- Retirer « ajoute des notes (allergie) » du « aujourd'hui » tant que D1.1 n'est pas livré.
- « Historique du jour » → « historique de ses commandes » (ou livrer D1.2).
- Mentionner l'annulation par le serveur et l'alerte « item prêt » (fonctionnalités réelles absentes de la doc).

## E. Dépendances croisées
- **Module 4 (KDS)** : consommateur direct des envois tablette ; les notes (D1.1/D2.1) doivent y être affichées pour servir à quelque chose.
- **Module 2/3 (Caisse/encaissement)** : pickup + paiement des commandes tablette (`pickup_tablet_order`, `pay_existing_order_v11`).
- **Module 5 (Catalogue)** : combos tablette (D2.2) dépendent de la validation/pricing serveur des formules (S57).
- **Module 21 (Réseau local)** : le mode hors-ligne écrivain (D3.1) et la fiabilité réseau générale.
- **Module 18 (App mobile)** : la refonte téléphone réutilisera ces surfaces tablette.
