# Module 02b — Orders (page BO — suivi des commandes)

> ⚠️ **Mise à jour S60 (2026-07-05, `swarm/session-60`)** : **D1.1 livré** — le void BO envoie désormais `x-idempotency-key` (parité POS S55, EF inchangée) ; **D1.2 livré** — commentaire stale « PIN in body » corrigé. Le caveat idempotence du C-B1.15 est levé. Voir `docs/workplan/plans/archive/2026-07-05-session-60-INDEX.md`.

> **Module hors Description v1.2 (page BO transverse) — source doc : fiche de référence 02b (S13, potentiellement périmée).**
>
> **Remise à plat — analyse comparative.** Doc : `docs/reference/04-modules/02b-orders.md` (« Last verified 2026-05-13 »). Code : commit `5b0fa92` (2026-07-03).
> **Statut annoncé par la doc :** Opérationnel (Partie I écrite au présent ; Partie II explicitement « stub structurée, à vérifier contre le code »).
> **Verdict global de l'analyse :** la page existe et est plus moderne que la doc (liste v2 serveur cursor-based, drawer riche, edit-items, void EF) mais la doc S13 décrit une page largement imaginaire sur les actions (refund / mark paid / relink customer / re-print absents), le son KDS (absent), le mapping des statuts (enum réel ≠ vocabulaire doc) et les défauts (60 jours au lieu de « today », 50/page cursor au lieu de 500 + pagination cliente). La doc dit aussi « la page ne modifie pas les items » — le code fait désormais l'inverse.

## A. Ce qui fonctionne réellement (code vérifié)

- **Route + navigation** : `/backoffice/orders` gatée `PermissionGate required="orders.read"` (`apps/backoffice/src/routes/index.tsx:476-482`) ; entrée sidebar groupe **Sales → Orders** (`apps/backoffice/src/layouts/Sidebar.tsx:72`). [UI câblée]
- **Page liste « Live Orders »** : `apps/backoffice/src/pages/orders/OrdersListPage.tsx` — header (badge Live, Refresh, Export), 5 KPI cards, rangée de filtres, pills de statut, table, « Load more ». [UI câblée]
- **Liste v2 serveur (infinite query cursor)** : `useOrdersList` (`apps/backoffice/src/features/orders/hooks/useOrdersList.ts:66-85`) → RPC **`get_orders_list_v2`** (live : `supabase/migrations/20260618000011_bump_get_orders_list_v2_server_filters.sql`, gate serveur `has_permission('orders.read')` l.27, REVOKE anon `_000012`). Pagination cursor `p_limit` 50/page, `next_cursor`. Filtres serveur : `status`, `order_type`, `payment_method`, `customer_id`, `served_by`, `customer_type`, `total_min/max`, `refund_status`, `hour`, `terminal_id` — tous honorés depuis l'URL (`OrdersListPage.tsx:99-116`), ce qui fait fonctionner les liens de drill-down des rapports. [UI câblée]
- **État d'URL = source de vérité des filtres** : `useSearchParams`, `start`/`end` par défaut **J-60 → aujourd'hui** (`OrdersListPage.tsx:42-47`). Recherche texte **client-side** sur `order_number` + `customer_name` des lignes chargées (`OrdersListPage.tsx:121-129`).
- **5 KPI cards** : Total orders / Total amount / Completion % / Paid (count+montant) / Unpaid (count+montant), calculés en mémoire **sur les lignes chargées + filtrées texte** (`OrdersListPage.tsx:131-146`) — pas sur tout le périmètre serveur.
- **Pills de statut** mappées sur l'enum réel `order_status` (`draft | paid | voided | pending_payment | completed | b2b_pending`) : All / New→`pending_payment` / Preparing→`draft` / Ready→`paid` / Completed / Cancelled→`voided` (`OrdersListPage.tsx:68-77`) — mapping sémantiquement discutable (voir C).
- **Realtime** : `useOrdersRealtime` (`features/orders/hooks/useOrdersRealtime.ts`) — canal unique par mount (pattern CLAUDE.md), `postgres_changes` INSERT/UPDATE sur `public.orders`, invalidation de la query liste, badge Live/Offline (`OrdersListPage.tsx:218-221`). **Aucun son, aucun listener KDS.** [UI câblée]
- **Drawer détail riche** : `OrderDetailDrawer` (`features/orders/components/OrderDetailDrawer.tsx`) ouvert par le bouton Details de chaque ligne — info grid (ID, date, type, statut paiement, méthode, heure paiement), items avec badge **`kitchen_status`** (new/preparing/ready/served) et barré si `is_cancelled`, totaux (subtotal/discount/tax/total + cash reçu/monnaie du 1er paiement), « Activity Log » **synthétisée** (création + paiements triés — pas de lecture d'`audit_logs` ni d'`order_activity_log`). Lecture via `useOrderDetail` = SELECT PostgREST direct avec embeds `order_items`/`order_payments`/`refunds`/`customers`/`user_profiles` (`features/orders/hooks/useOrderDetail.ts:67-82`). [UI câblée]
- **Page détail dédiée** `/backoffice/orders/:id` gatée `orders.read` (`routes/index.tsx:484-489`) : `OrderDetailPage.tsx` read-only — items, payments, **refunds** (table dédiée si non vide), totaux PB1, drill-down links customer/served_by/produit. Cible du drill-down `entity: 'order'` des rapports (`features/reports/utils/buildDrilldownUrl.ts:60`). [UI câblée]
- **Void depuis la liste** : bouton ligne si `hasPermission('orders.void')` et `status === 'paid'` (`OrdersListPage.tsx:360-364`) → `VoidOrderModal` (raison ≥ 10 car. + PIN 6 chiffres, `features/orders/components/VoidOrderModal.tsx`) → `useVoidOrder` qui POSTe l'**EF `void-order`** avec `x-manager-pin` en header (`features/orders/hooks/useVoidOrder.ts:34-42`) ; l'EF appelle **`void_order_rpc_v4`** via client admin et relaie `x-idempotency-key` (`supabase/functions/void-order/index.ts:50,73-78,108-113`). ⚠️ **Le BO n'envoie PAS `x-idempotency-key`** : `VoidOrderModal.tsx:19` génère une clé `useRef(crypto.randomUUID())`… jamais transmise au hook (le POS, lui, l'envoie : `apps/pos/src/features/order-history/hooks/useVoidOrder.ts:44`). [UI câblée + EF]
- **Edit items sur commande ouverte** : bouton ligne si `hasPermission('orders.edit_open')` et statut `draft`/`pending_payment` (`OrdersListPage.tsx:355-359`) → `EditOrderItemsModal` (2 colonnes ProductPicker + preview diff) → orchestrateur `useEditOrderItems` (removes → updates → adds, clés d'idempotence stables par opération, `features/orders/hooks/useEditOrderItems.ts:34-41`) → RPCs **`add_order_item_v1` / `update_order_item_qty_v1` / `remove_order_item_v1`** (créées `20260618000015/17/19`, gate serveur `orders.edit_open`, statuts éditables corrigés `draft|pending_payment` dans `20260618000023:45`, REVOKE anon `_016/18/20`, perms seedées `20260618000021`). [UI câblée + RPC]
- **Export CSV** client-side avec BOM UTF-8 (`OrdersListPage.tsx:158-180`) — n'exporte que les lignes chargées ; aucun gate de permission propre (accessible dès `orders.read`).
- **Gestion d'erreur** : bandeau `role="alert"` sur erreur query (`OrdersListPage.tsx:309`), toast si le fetch des items pour l'édition échoue (`OrdersListPage.tsx:192-195`), empty state « No orders matching these filters ».
- **Tests** : smoke `pages/orders/__tests__/OrdersListPage.smoke.test.tsx` (T1 défauts RPC v2, T2 propagation URL→filtres, T3 drawer, T4 toast erreur), `OrderDetailPage.smoke.test.tsx`, `features/orders/hooks/__tests__/useOrdersList.test.tsx`, `features/orders/__tests__/order-detail-invalidation.smoke.test.tsx`, `product-picker.smoke.test.tsx`.
- **Permissions réelles** : `orders.read`, `orders.edit_open`, `orders.void` (`packages/supabase/src/rls/permissions.ts:147-150`). Les codes `sales.view`/`sales.void`/`sales.refund` de la doc n'existent pas.

## B. Ce que la doc demande

### B1. Revendiqué comme fonctionnant (« Ce qu'on peut faire aujourd'hui »)
- B1.1 Page Orders au BO, route `/orders`, 4 sections (header / stats / filtres / table) + modale détail superposée.
- B1.2 Mise à jour temps réel avec badge « Live » ; bouton Refresh manuel ; badge s'éteint si déconnecté.
- B1.3 **Son** (`playOrderReadySound`) via `useKdsStatusListener` quand une commande passe `ready` cuisine ; désactivable dans Settings → POS Configuration.
- B1.4 **5 KPI** (total, montant total, completion rate, paid count+montant, unpaid count+montant) recalculés à la volée sur le **périmètre filtré**.
- B1.5 Défaut « aujourd'hui seulement » ; max **500 commandes**/requête + pagination **cliente** (`ITEMS_PER_PAGE`).
- B1.6 Filtre statut : All / Pending / Preparing / Ready / Completed / Voided / Refunded.
- B1.7 Filtre type : dine-in / takeaway / delivery / B2B.
- B1.8 Filtre **payment status** : All / Paid / Unpaid / **Partial**.
- B1.9 Recherche : `order_number` + `customer_name` + **`table_number`**.
- B1.10 Date range from/to.
- B1.11 Table : Order # / heure / type / table-client / items count / total / badges status + payment / action détail ; tri date desc.
- B1.12 Modale 360° : items avec **modifiers + surcoût**, **item status** par ligne (pending/preparing/ready/served/cancelled), **dispatch station** KDS.
- B1.13 Bloc financial : subtotal / discount / **service charge** / tax PB1 / total / méthode / cash reçu / monnaie.
- B1.14 Bloc actions : **re-print reçu**, **re-print kitchen ticket**, void, refund, **mark paid** (ardoises), **relink customer** (rétro-loyalty).
- B1.15 Void : PIN manager + raison obligatoire ; reversals stock/loyalty/JE.
- B1.16 **Refund partiel ou total** depuis la modale (PIN + raison).
- B1.17 Timeline d'activité lisant `order_activity_log` (qui-quoi-quand).
- B1.18 Export CSV gaté **`reports.sales`**, UTF-8 BOM.
- B1.19 Permissions : accès `sales.view`, void `sales.void`, refund `sales.refund` ; RLS UPDATE dédiées sur `orders`.
- B1.20 Erreur de chargement → message + bouton Refresh, pas de page blanche.

### B2. Annoncé « À venir » (Partie III, backlog R/O/Y/G)
- B2.1 Filtre par cashier / serveur. — B2.2 Bulk actions (mark paid en masse). — B2.3 Heatmap d'âge des commandes en cours. — B2.4 Filtre « Mes commandes ». — B2.5 Toast riche cliquable sur `ready`. — B2.6 **Édition de la commande après coup** (add/remove item + PIN). — B2.7 Vue calendrier des pré-commandes. — B2.8 Export PDF par commande. — B2.9 Lien direct vers le KDS.

## C. Écarts (revendications vs code)

| # | Revendication doc | Réalité code | Verdict |
|---|---|---|---|
| B1.1 | Page 4 sections + modale détail | Page complète `/backoffice/orders` (header/KPI/filtres/pills/table) ; détail en **drawer** (Sheet) + page dédiée `/orders/:id` — équivalent fonctionnel | ✅ CONFORME |
| B1.2 | Realtime + badge Live + Refresh | `useOrdersRealtime` sur `public.orders`, badge Live/Offline, bouton Refresh (`OrdersListPage.tsx:218-231`) | ✅ CONFORME |
| B1.3 | Son « order ready » via listener KDS, toggle Settings | **Aucun son, aucun `useKdsStatusListener` dans le BO** (grep `sound/Audio/playOrderReady` = 0 hit) ; le realtime écoute `orders`, pas les items KDS | 🔴 MANQUANT |
| B1.4 | 5 KPI sur le périmètre filtré | 5 cards présentes mais calculées **sur les pages chargées** (50/page cursor) — un périmètre de 800 commandes affiche les KPI des 50 premières tant qu'on n'a pas cliqué Load more (`OrdersListPage.tsx:131-146`) | 🟠 PARTIEL |
| B1.5 | Défaut « today » ; 500 max + pagination cliente | Défaut **J-60** (`OrdersListPage.tsx:42-44`) ; cursor serveur 50/lot + « Load more » (`useOrdersList.ts:76`) — architecture différente ET défaut contraire à la doc | 🔴 MANQUANT (la doc décrit un autre système) |
| B1.6 | Statuts Pending/Preparing/Ready/Completed/Voided/Refunded | Enum réel `draft/paid/voided/pending_payment/completed/b2b_pending` ; pills New/Preparing/Ready re-mappées dessus de façon trompeuse (Preparing=`draft`, Ready=`paid`) ; pas de pill Refunded (filtre `refund_status` URL-only) | 🟠 PARTIEL |
| B1.7 | Filtre type dine-in/takeaway/delivery/B2B | Select `order_type` serveur (`OrdersListPage.tsx:275-279`) | ✅ CONFORME |
| B1.8 | Filtre payment status Paid/Unpaid/Partial | Le filtre réel est **payment_method** (cash/card/qris/…) ; paid/unpaid affiché = heuristique client `isPaidLine` (`OrdersListPage.tsx:82-84`) ; aucun état « partial » | 🟠 PARTIEL |
| B1.9 | Search order # / client / table | Client-side sur `order_number`+`customer_name` des lignes chargées ; pas de `table_number` (absent d'`OrdersListLine`) | 🟠 PARTIEL |
| B1.10 | Date range from/to | Inputs start/end → params RPC (`OrdersListPage.tsx:269-274`) | ✅ CONFORME |
| B1.11 | Colonnes table + badges + détail | Toutes présentes sauf « table » (colonne Customer seule) ; tri serveur date desc | ✅ CONFORME |
| B1.12 | Détail : modifiers + surcoût, item status, dispatch station | `kitchen_status` badgé + `is_cancelled` barré ✅ ; **modifiers chargés (`useOrderDetail.ts:76`) mais jamais affichés** ; **aucune dispatch station** dans le drawer ni la page détail | 🟠 PARTIEL |
| B1.13 | Financial : subtotal/discount/service charge/tax/total/cash/monnaie | Tout sauf **service charge** (inexistant dans le modèle) ; cash/monnaie du 1er paiement seulement (`OrderDetailDrawer.tsx:165-180`) | 🟠 PARTIEL |
| B1.14 | Actions : print ×2, void, refund, mark paid, relink customer | Seuls **void** et **edit items** existent (boutons de ligne, pas dans le drawer — drawer 100 % read-only) ; pas de re-print, pas de mark paid, pas de relink customer (grep `mark_order_paid/relink` = 0 hit) | 🔴 MANQUANT |
| B1.15 | Void PIN + raison + reversals | `VoidOrderModal` (raison ≥10 + PIN) → EF `void-order` `x-manager-pin` → `void_order_rpc_v4` (reversals serveur) ; ⚠️ clé d'idempotence générée mais **non envoyée** (`VoidOrderModal.tsx:19` vs `useVoidOrder.ts:34-42`) — le POS l'envoie | ✅ CONFORME (caveat idempotence) |
| B1.16 | Refund partiel/total depuis la page | **Aucun flux refund côté BO** — l'EF `refund-order` n'est appelée que du POS ; le BO ne fait qu'afficher les refunds (`OrderDetailPage.tsx:133-159`) et filtrer `refund_status` | 🔴 MANQUANT |
| B1.17 | Timeline lisant `order_activity_log` | « Activity Log » du drawer = **synthèse client** (création + paiements) ; aucune lecture d'`order_activity_log`/`audit_logs` (grep = 0 hit) | 🟠 PARTIEL |
| B1.18 | Export CSV gaté `reports.sales` | Export CSV client + BOM ✅ mais **aucun gate dédié** (dispo dès `orders.read`) et limité aux lignes chargées | 🟠 PARTIEL |
| B1.19 | Permissions `sales.view`/`sales.void`/`sales.refund` + RLS UPDATE | Ces codes **n'existent pas** ; réels : `orders.read`/`orders.void`/`orders.edit_open` (`permissions.ts:147-150`) ; écriture via RPC/EF SECURITY DEFINER, pas via policies UPDATE sur `orders` | 🔴 MANQUANT (la doc décrit un autre modèle — la fonction équivalente existe) |
| B1.20 | Erreur → message + Refresh | Bandeau `role="alert"` + Refresh header + toast sur échec fetch items | ✅ CONFORME |

**Compte : ✅ 7 · 🟠 8 · 🔴 5 · ⚫ 0 · ⚠️ 0**

**Bonus code (le code fait plus que la doc) :**
- 🔵 **Edit-items sur commande ouverte** (add/update/remove, 3 RPCs idempotentes `_v1` + orchestrateur diff + ProductPicker) — la doc §13 affirmait explicitement « la page **ne modifie pas** les items » ; c'était aussi le backlog B2.6, désormais livré (S33/S39).
- 🔵 **Filtres serveur de drill-down** non documentés : `customer_id`, `served_by`, `customer_type`, `total_min/max`, `refund_status`, `hour`, `terminal_id` (S33) — dont un **filtre par cashier fonctionnel côté RPC** (B2.1 « à venir »… déjà là côté serveur, sans contrôle UI).
- 🔵 **Page détail dédiée `/backoffice/orders/:id`** avec drill-down links (customer/user/produit) et table Refunds — cible du `buildDrilldownUrl` des rapports.
- 🔵 **Liste v2 serveur gatée `orders.read` dans le RPC lui-même** (défense en profondeur au-delà du PermissionGate).
- 🔵 Pills de statut « fulfillment-style » + heuristique paid/unpaid en colonne Payment.

## D. Plan de correction du module

### D1. Quick wins (< 1 session, pas de spec)
1. **Câbler `x-idempotency-key` sur le void BO** : passer `idem.current` de `VoidOrderModal.tsx` à `useVoidOrder` et l'envoyer en header (parité POS S55 — l'EF le supporte déjà, `void-order/index.ts:73-78`). Done : header présent dans un smoke test miroir de `void-idempotency-header.smoke.test.tsx` (POS).
2. **Corriger le commentaire stale** `VoidOrderModal.tsx:4` (« PIN sent in body per DEV-S33-PRE-02 » — faux depuis S34, le PIN part en header). Done : commentaire aligné sur le code.
3. **Afficher les modifiers** dans `OrderDetailDrawer` et `OrderDetailPage` (les données sont déjà dans `useOrderDetail`, champ `modifiers`). Done : sous-ligne modifiers visible sous chaque item.
4. **Relabelliser les pills de statut** avec le vocabulaire réel (Draft / Awaiting payment / Paid / Completed / Voided) ou assumer le mapping en tooltip — « Preparing→draft » et « Ready→paid » sont trompeurs pour un manager. Done : labels honnêtes, test T2 ajusté.
5. **Défaut de plage à « Today »** (+ presets Today/7d/30d) au lieu de J-60, et bannière « KPIs calculés sur N lignes chargées / Load more » tant que `hasNextPage`. Done : mount par défaut ne tire qu'aujourd'hui ; l'utilisateur est prévenu que les KPI sont partiels.
6. **Exposer le filtre cashier dans l'UI** (select `served_by` alimenté par `user_profiles`) — le RPC v2 le supporte déjà. Done : filtre visible + propagé à l'URL.

### D2. Chantiers moyens (1 session, plan requis)
1. **KPIs serveur** : petit RPC d'agrégats (`count`, `sum(total)`, completion, paid/unpaid) sur le même périmètre `p_start/p_end/p_filters` que `get_orders_list_v2`, pour que les 5 cards reflètent tout le périmètre et non les pages chargées.
2. **Refund depuis le BO** : réutiliser l'EF `refund-order` (déjà PIN-header + idempotence côté POS) avec un `RefundOrderModal` BO — décision produit préalable : le refund BO est-il souhaité ou volontairement POS-only ?
3. **Timeline réelle** dans le drawer : lire `audit_logs` (via `get_audit_logs_v1/_v2`, RLS admin_read) + `refunds` + `order_payments` pour un vrai qui-quoi-quand, en remplacement de la synthèse client.
4. **Recherche serveur** (`order_number`/`customer_name` en filtre RPC) pour que la recherche ne soit plus bornée aux lignes chargées.

### D3. Chantiers lourds (spec dédiée avant code)
1. **Actions manquantes de la « modale 360° »** si le métier les confirme : mark paid d'une ardoise depuis le BO (aujourd'hui `pay_existing_order_v11` est un flux POS ; B2B settle vit dans le module B2B S52), relink customer avec attribution rétroactive loyalty, re-print reçu/kitchen ticket via la print-queue. Chaque action touche la money-path ou la loyalty → spec + pattern-guardian.
2. **Notifications « ready » côté BO** (toast/son) : nécessite un canal realtime sur `order_items.kitchen_status` + réglage utilisateur — à spécifier seulement si le besoin du manager BO est réel (le KDS/POS couvre déjà le plancher).

### D4. Amendements à la doc (si c'est la doc qui doit bouger, pas le code)
1. Réécrire la fiche 02b sur le réel : enum `order_status` réel, drawer + page détail (pas de « modale »), liste v2 cursor 50/page « Load more » (supprimer « 500 + pagination cliente » et `ITEMS_PER_PAGE`), défaut de plage effectif, filtres serveur S33 (drill-down), permissions `orders.read/void/edit_open` (supprimer `sales.view/void/refund` et les policies RLS UPDATE imaginaires).
2. Supprimer le son KDS et `useKdsStatusListener` de la Partie I (jamais implémentés côté BO) ou les déplacer en backlog.
3. Inverser §13 : la page **modifie** désormais les items d'une commande ouverte (edit-items S33) ; documenter les 3 RPCs et le gate `orders.edit_open`.
4. Retirer de la Partie II les hooks/services/composants « présumés » (`useOrderStats`, `orderService`, `OrderStatsRow`… — aucun n'existe sous ces noms) au profit des vrais fichiers `features/orders/*`.
5. Marquer B2.6 (édition après coup) **livré** et B2.1 (filtre cashier) **livré côté serveur**.

## E. Dépendances croisées
- **POS / money-path (module 02)** : le void passe par l'EF `void-order` → `void_order_rpc_v4` (EF-only S55) partagée avec le POS ; tout chantier refund/mark-paid BO doit réutiliser `refund-order` / `pay_existing_order_v11` sans dupliquer la logique.
- **KDS (module 04)** : `kitchen_status` affiché dans le drawer vient du KDS ; le chantier « notifications ready BO » dépend du vocabulaire realtime KDS.
- **Reports (module 14)** : la page est la **cible de drill-down** (`buildDrilldownUrl` → `/backoffice/orders?…` et `/backoffice/orders/:id`) — ne pas casser les params URL S32/S33 en refactorant les filtres.
- **B2B (module 09)** : statut `b2b_pending` listé ici, mais règlement/annulation B2B vivent dans le module B2B (`record_b2b_payment_v2`, `cancel_b2b_order_v1`) — un « mark paid » BO ne doit pas court-circuiter les allocations S52.
- **Customers (module 08)** : drill-down customer ; un futur « relink customer » implique la rétro-attribution loyalty.
- **Sécurité/RBAC + Audit** : codes `orders.*` ; timeline réelle dépendante de `get_audit_logs_v1/_v2` et de la table `audit_logs` (seule surface depuis S56).
