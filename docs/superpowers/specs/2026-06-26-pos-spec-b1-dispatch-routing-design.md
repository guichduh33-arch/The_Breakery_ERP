# Spec B-1 — POS dispatch/print routing (display station, mapping complet, ticket waiter, multi-station produit)

> **Date** : 2026-06-26
> **Statut** : design validé (brainstorming), en attente de relecture utilisateur avant plan d'implémentation.
> **Périmètre** : `apps/pos` (cart/fire, KDS), `apps/backoffice` (catégories + produits), `packages/domain` (routing/print types), `supabase/migrations` + RPC.
> **Hors périmètre (→ Spec B-2 « Service salle »)** : écran **KDS waiter interactif** (statuts/served/distribution à l'écran), impression caisse (bon + reçu) vs bons par table, division d'addition. L'**assignation des stations de _production_** (`product_sections`, 19/363 produits) reste un chantier séparé (module production).
> **Dépend de** : Spec A (held-order lifecycle) — mergée #120/#121.

---

## 1. Contexte et problème

Spec A a débloqué le flux Send-to-Kitchen (held-order lifecycle) mais a volontairement reporté en « Suite » : la station `display`, le mapping complet des catégories, et la destination transversale `waiter`. Trois problèmes restent ouverts.

**(a) `dispatch_station` confond _production_ et _dispatch de vente_.** La colonne `categories.dispatch_station ∈ {kitchen, barista, bakery, none}` porte la valeur `bakery` qui décrit *où l'article est produit* — mais elle est *utilisée comme cible de routage à la vente*. Or au moment de la vente, un pain/viennoiserie n'est pas « à la boulangerie » : il est **en vitrine**, et c'est de là qu'on le récupère pour le servir/emballer. Router le KOT de vente vers `bakery` est sémantiquement faux.

**(b) Le mapping est incomplet.** 100 % des produits étaient `none` avant Spec A (le bouton était inerte) ; Spec A n'a routé qu'un sous-ensemble non ambigu. Beaucoup de catégories POS réelles (Buns, Cake, Bagel, Individual Pastries, Sandwiches Baguette…) restent `none` → leurs items n'atteignent aucune station.

**(c) Modèle 1-produit-1-station trop rigide.** Un même article doit parfois être dispatché vers **plusieurs stations** pour la logistique de handoff. Exemple métier : un **sandwich** part en **kitchen** (informer qu'il faut le faire) **et** en **display** (la personne au display récupère le sandwich de la cuisine avant de le transférer au waiter, ou directement au client si take-away). Le modèle actuel ne le permet pas.

S'ajoute une demande transversale : un **ticket `waiter`** récapitulant **toute** la commande, imprimé à chaque envoi, pour que les serveurs gèrent proprement la distribution en table comme en take-away.

## 2. Décision d'architecture — deux axes de « station » décorrélés

Le système doit **dissocier** deux notions de « station » qui coexistent déjà dans le schéma mais étaient conflées dans le vocabulaire :

| Axe | Porté par | Rôle | Touché par B-1 ? |
|---|---|---|---|
| **Station de _production_** | `sections` (`kind='production'` : Bakery, Viennoiserie, Hot Kitchen, Pastry) + `product_sections` + `production_records.section_id` | Où l'article est fabriqué + contexte de déduction de stock (#122 `track_inventory`/`deduct_stock`). | **Non** — axe séparé, intouché. |
| **Station de _dispatch/impression_** | `dispatch_station` (catégorie + snapshot `order_items`) + `kds_station` | Où l'on récupère/prépare l'article **à la vente** → KOT, lane KDS, impression. | **Oui** — c'est le sujet de B-1. |

« Dissocier impression et production » = **cesser de faire porter au dispatch des noms de production** (`bakery`) et le rendre purement « où récupérer à la vente » (`kitchen / barista / display`). La production reste dans `sections`, axe parallèle non modifié par le routage de vente.

## 3. État de l'existant (vérifié dans le code / la DB V3 dev `ikcyvlovptebroadgtvd`)

- **`categories.dispatch_station`** : `TEXT NOT NULL DEFAULT 'none'`, CHECK `categories_dispatch_station_check = ('kitchen','barista','bakery','none')` (migration `20260505000002`). Colonne sœur **`kds_station`** (`expo`/`prep`/`hot`/`cold`/`bar`) = sous-filtre KDS client-side, distinct.
- **Discriminateur métier fiable** : `categories.category_type ∈ {finished, semi_finished, raw_material}` + `categories.show_in_pos BOOL`. Toutes les matières premières / semi-finis (BEVERAGE, CHOCOLAT, FLOUR, DAIRY, SFG-58, meat, SAUCE…) sont `raw_material`/`semi_finished` **et** `show_in_pos=false` → **non vendues au POS, restent `none`**. Seules les catégories `finished` + `show_in_pos=true` ont besoin d'un routage.
- **`order_items.dispatch_station`** : `TEXT` nullable, **sans CHECK** (snapshot libre). Copié de `categories.dispatch_station` au INSERT par les RPC de création de commande (`complete_order_with_payment_*`, `fire_counter_order_v4`, `create_tablet_order_v2`) via `SELECT c.dispatch_station FROM products p JOIN categories c ON c.id=p.category_id`. Index partiel `idx_oi_kds_station(dispatch_station, kitchen_status)`.
- **Stations de prep côté front** : `PREP_STATIONS = ['barista','kitchen','bakery']` (`useFireToStations.ts:21`). Le groupement passe par `groupItemsByStation(items, stationByProductId)` (`@breakery/domain`) ; types `DispatchStation` / `PrepStation` / `PrinterRole` côté domain. L'impression d'un bucket = `printStationTicket(printer, { kind:'prep', role, … })` (`apps/pos/src/services/print/printService.ts`).
- **KDS** : onglet par station via `KdsStationSelector` (`STATIONS = kitchen | barista | bakery`), type `KdsStation` (`kdsStore`), requête serveur `useKdsOrders` filtrée par `dispatch_station`.
- **Impression — seulement 2 types de tickets** : `ticket_type ∈ {receipt, kitchen, barista}`. Le hub LAN **rejette** explicitement tout autre type (`lanHubMessageHandler.ts` : « Unsupported ticket type »). Donc aujourd'hui les items `bakery` s'affichent au KDS mais **n'impriment aucun ticket physique**. Le print-server (process Express séparé, hors `src/`) expose `/print/receipt|kitchen|barista`.
- **`sections`** : table avec `kind ∈ {production, sales, warehouse}`. Existe déjà une section de vente **« Front Display »** (`kind='sales'`). `product_sections` ne couvre que **19/363** produits.

**Conclusion** : l'axe dispatch existe et fonctionne, mais (1) son vocabulaire emprunte un nom de production (`bakery`), (2) le mapping est incomplet, (3) il est mono-station, (4) il n'imprime ni `display` ni `waiter`.

## 4. Modèle retenu

1. **Vocabulaire dispatch** = `kitchen | barista | display | none`. `bakery` (production) **disparaît** du dispatch de vente, renommé `display` (vitrine, point de récupération à la vente).
2. **`waiter`** n'est **pas** une valeur de `dispatch_station` (un produit ne « route » pas vers waiter). C'est un **type de ticket transversal** : à chaque fire, un récap unique de **toute** la commande est imprimé vers la station waiter, table **et** take-away.
3. **Multi-station au niveau produit** : un produit peut router vers **plusieurs** stations ; l'**article entier** (nom, qté, modificateurs) apparaît sur le KOT/KDS de **chaque** station concernée. **Pas de découpage en composants.** Set de stations **fixe** (`kitchen, barista, display`) ; la flexibilité = chaque produit choisit librement sa/ses station(s) en BackOffice. La catégorie fournit le **défaut/seed** ; le produit peut surcharger.
4. **Décorrélation production/dispatch** maintenue : `sections` (production) intouché.

## 5. Conception détaillée — découpée en 2 phases (le plan les implémentera séparément)

### Phase 1 — Vocabulaire `display` + mapping complet + ticket `waiter` (shippable seule)

Palier autonome et livrable : routage **mono-station par catégorie** (modèle actuel), mais vocabulaire corrigé, mapping complet, et impression display + waiter câblées.

#### Bloc 1.1 — Migration vocabulaire `bakery → display`
- **Schéma** : remplacer la contrainte `categories_dispatch_station_check` par `('kitchen','barista','display','none')` (DROP + ADD dans la même migration ; pas de `bakery`).
- **Données** : `UPDATE categories SET dispatch_station='display' WHERE dispatch_station='bakery'`. Idempotent. Down documenté (re-CHECK avec `bakery` + UPDATE inverse).
- **`order_items`** (snapshot historique) : pas de CHECK à modifier (colonne libre), mais `UPDATE order_items SET dispatch_station='display' WHERE dispatch_station='bakery'` pour la cohérence du KDS et des lectures. Réversible.
- **`COMMENT`** des colonnes mis à jour (le commentaire actuel cite encore `bakery`).

#### Bloc 1.2 — Mapping complet des catégories (migration de données, idempotente, cibler par `name`/`slug` stable)
Catégories `finished` + `show_in_pos=true` (validées avec l'utilisateur en relecture du brainstorming) :

| Station | Catégories |
|---|---|
| `barista` | Coffee, Speciale Latte, Special Drinks |
| `kitchen` | Panini, Simple Plate, Plate, Savoury, Sandwiches, **Savoury Croissant**, **Bagel, Classic Sandwiches, Sandwiches Baguette** |
| `display` | Bread, Pastry, Viennoiserie, Buns, Cake, Classic Breads, Classic Viennoiserie, Individual Pastries, Others Viennoiserie, Sourdough Breads, **Savouries, Other drinks, HASIL BOHEMI** |
| `none` | Toute catégorie `show_in_pos=false` (raw_material/semi_finished) + catégories test/legacy (Ingredient, Ingredients (merged), S41E2E) |

- Décisions métier confirmées : Bagel/Classic Sandwiches/Sandwiches Baguette = **kitchen** (préparés/chauffés à la commande) ; Savouries/Other drinks/HASIL BOHEMI = **display** (pré-faits / embouteillés pris en vitrine) ; Savoury Croissant reste **kitchen**.
- Garde-fou : `WHERE category_type='finished' AND show_in_pos=true` pour ne jamais router une matière première.

#### Bloc 1.3 — Câblage `display` (KDS + impression)
- **Domain** (`@breakery/domain`) : ajouter `'display'` à `DispatchStation` / `PrepStation` / `PrinterRole` ; `groupItemsByStation` accepte le bucket `display`.
- **POS fire** : `PREP_STATIONS = ['barista','kitchen','display']` (`useFireToStations.ts`). `useStationPrinters` / `useStationMap` exposent le rôle `display`. `firableCount`/`unroutedCount` suivent automatiquement.
- **KDS** : `KdsStationSelector` onglet `bakery`→`display` (label « Display / Vitrine ») ; type `KdsStation` (`kdsStore`) ; `useKdsOrders` (filtre serveur déjà sur `dispatch_station`).
- **Impression** : `printService` gère le rôle `display` ; étendre l'union `ticket_type` (`lanProtocol`) et la validation du hub (`lanHubMessageHandler`) pour accepter `display`. ⚠️ **Dépendance print-server** : endpoint `/print/display` sur le process Express séparé — si indisponible, **repli** sur l'endpoint `kitchen` avec un en-tête de titre « DISPLAY / VITRINE » (décision d'implémentation à acter au plan).
- **BackOffice** : `CategoryFormDialog` option `bakery`→`display`.

#### Bloc 1.4 — Ticket `waiter` transversal
- **Nouveau `kind`** de payload d'impression (`waiter`) : un récap **unique** de la commande entière — tous les items (y compris `none`), n° de table / type de commande (table/take-away), serveur, horodatage.
- **POS fire** (`useFireToStations`) : après le groupement par station, émettre **un** ticket `waiter` consolidé à chaque fire (best-effort, comme les KOT station — un échec d'impression n'invalide jamais la commande persistée). S'imprime pour **toutes** les commandes firées (table + take-away), confirmé utilisateur.
- **Hub/print-server** : étendre `ticket_type` + validation pour `waiter` ; endpoint `/print/waiter` ou repli `kitchen` avec en-tête « WAITER — ORDER ». Résolution du printer waiter via `useStationPrinters` (nouveau rôle `waiter`).
- **Pas de re-impression** : le ticket waiter d'un fire « additional order » (Spec A) ne récapitule que la commande courante ; l'en-tête « ADDITIONAL ORDER » de Spec A reste porté par les KOT station, le waiter ticket peut hériter du même flag pour cohérence.

### Phase 2 — Multi-station au niveau produit (override + résolution + snapshot tableau)

Construit sur Phase 1. Introduit le routage **par produit, multi-valué**.

#### Bloc 2.1 — Schéma
- **`products.dispatch_stations text[] NULL`** : override produit. `NULL` ⇒ hériter `[categories.dispatch_station]` (mono, défaut Phase 1). Non-null ⇒ liste explicite (1..N stations), CHECK que chaque élément ∈ `('kitchen','barista','display')` (jamais `none` dans la liste — `none` = liste vide/produit non routé) et unicité.
- **`order_items.dispatch_stations text[] NULL`** : **snapshot** de la résolution à la vente (KOT historiques stables). On **conserve** `order_items.dispatch_station` (single) en legacy/dérivé (= premier élément) le temps de migrer les lectures, OU on bascule le KDS sur le tableau (décision au plan ; préférence : basculer KDS sur `ANY(dispatch_stations)` et garder le single nullable rempli pour rétro-compat des lectures non migrées).
- Index KDS adapté : `… WHERE 'kitchen' = ANY(dispatch_stations)` (GIN ou index d'expression ; à dimensionner au plan).

#### Bloc 2.2 — Résolution + snapshot dans les RPC
- **Helper SQL** `_resolve_dispatch_stations_v1(p_product_id uuid) RETURNS text[]` (internal, REVOKE PUBLIC+anon+authenticated) : `COALESCE(p.dispatch_stations, ARRAY[c.dispatch_station]) FILTER (≠ 'none')`.
- **RPC du money-path à étendre** pour snapshotter le tableau dans `order_items.dispatch_stations` : `fire_counter_order_v4`, `complete_order_with_payment_v14`, `create_tablet_order_v2`, `pay_existing_order_v10` (et tout autre INSERT order_items). ⚠️ **Versioning monotone** : chaque RPC dont la signature publique change → `_vN+1` + `DROP …(<old args>)` même migration + mise à jour des call-sites + EF. Si l'extension est **interne au corps** (pas de changement de signature), on peut REPLACE en place (cf. précédent `complete_order_with_payment_v14` #122) — à trancher RPC par RPC au plan.
- **Paire REVOKE S25** sur tout nouveau RPC/helper. **Regen types** après migrations.

#### Bloc 2.3 — Domain + POS + KDS multi-bucket
- **`groupItemsByStation`** : un item dont la résolution = `[kitchen, display]` tombe dans **les deux** buckets → le sandwich s'imprime sur le KOT kitchen **et** le KOT display, article entier. `stationByProductId` devient `stationsByProductId: Record<uuid, DispatchStation[]>`.
- **`firableCount`/`unroutedCount`** : un item est « firable » s'il a ≥1 station ; « unrouted » si liste vide.
- **KDS** : un item multi-station apparaît sur chaque board concerné (requête `ANY(dispatch_stations)`).

#### Bloc 2.4 — BackOffice override produit
- Formulaire produit : multi-sélection des stations de dispatch (parmi `kitchen/barista/display`), `NULL`/vide = « hériter de la catégorie ». RPC produit (create/update) étendu pour persister `dispatch_stations`. Affichage du défaut hérité quand non surchargé.

## 6. Invariants & sécurité (gate de shippabilité)

- **Décorrélation production/dispatch** : aucune écriture sur `sections`/`product_sections`/`production_records` dans ce spec. Le dispatch ne lit jamais `sections`.
- **RPC versioning monotone** (Phase 2) : pas d'édition d'une signature publiée ; `_vN+1` + DROP de l'ancienne dans la même migration si la signature change. `fire_counter_order_v4` non modifié si l'extension reste interne.
- **Paire REVOKE S25** sur `_resolve_dispatch_stations_v1` et tout nouveau RPC (PUBLIC + anon + ALTER DEFAULT PRIVILEGES).
- **Écritures via RPC** : aucune écriture brute sur `orders`/`order_items`. Le snapshot `dispatch_stations` est posé server-side.
- **Idempotence inchangée** : fire (flavor-2 `p_client_uuid`) et money-path conservent leur idempotence ; aucune nouvelle clé requise (le routage est déterministe par produit).
- **CHECK d'intégrité** : `categories.dispatch_station` reste contraint (`kitchen/barista/display/none`) ; `products.dispatch_stations` contraint élément-par-élément (`kitchen/barista/display`).
- **Impression best-effort** : KOT station + ticket waiter sont best-effort (un échec n'invalide pas la commande persistée — pattern Spec A / S43 P0-3).
- **Regen types** (`types.generated.ts`) après chaque migration de schéma.

## 7. Tests & vérification

- **pgTAP** (MCP `execute_sql`, BEGIN/ROLLBACK) :
  - Ph1 : CHECK accepte `display`, rejette `bakery` ; migration mapping idempotente (re-run = no-op) ; aucune catégorie `show_in_pos=false` routée ≠ `none`.
  - Ph2 : `_resolve_dispatch_stations_v1` (override produit > défaut catégorie ; `none` filtré) ; snapshot `order_items.dispatch_stations` posé par le RPC ; REVOKE anon sur le helper.
- **Vitest live RPC** (`@breakery/supabase`) : fire d'un produit multi-station persiste l'item une fois mais route vers N stations ; un produit `display` only ne part jamais en kitchen.
- **Domain unit** : `groupItemsByStation` — item `[kitchen,display]` présent dans 2 buckets, article entier ; item liste-vide → unrouted.
- **Smoke POS** (`@breakery/app-pos`) : Send-to-Kitchen d'un sandwich multi-station → KOT kitchen **et** display ; ticket waiter consolidé émis (tous items, table + take-away) ; produit vitrine → display.
- **Smoke BO** (`@breakery/backoffice`) : override multi-station produit ; option catégorie `display` ; héritage affiché quand non surchargé.
- **Cheap d'abord** : `pnpm typecheck`, `pnpm --filter @breakery/domain test`, puis smokes ciblés. Cible DB = V3 dev cloud, jamais Docker/prod.

## 8. Risques / réserves

- **Dépendance print-server externe** : les types `display` et `waiter` exigent idéalement des endpoints `/print/display` et `/print/waiter` sur le process Express séparé (hors `src/`). Repli prévu sur l'endpoint `kitchen` + en-tête de titre ; à acter au plan (et signaler que sans endpoint dédié, la résolution de printer par rôle peut router sur la mauvaise imprimante physique).
- **Migration du snapshot single→array (Ph2)** : coexistence `order_items.dispatch_station` (single, legacy) et `dispatch_stations` (array) le temps de migrer le KDS et les lectures. Risque de divergence si une lecture oublie le tableau ; plan doit lister tous les lecteurs de `dispatch_station`.
- **Volume de RPC touchés en Ph2** : plusieurs RPC du money-path écrivent le snapshot ; chaque changement de signature = bump + REVOKE + call-sites + EF + regen. Préférer l'extension interne (REPLACE en place) quand la signature ne change pas.
- **Bruit du ticket waiter en take-away** : confirmé voulu par l'utilisateur (table + take-away). Si bruit constaté en prod, une option de gating par `order_type` est triviale à ajouter (non retenue ici).
- **`kds_station` (expo/prep/hot) non touché** : reste le sous-filtre client-side ; aucune interaction avec le multi-station dispatch dans ce spec.

## 9. Suite — Spec B-2 « Service salle » (séparée)

Écran **KDS waiter interactif** (commandes entières, statuts, served, distribution à l'écran), impression caisse (bon + reçu) vs bons par table, division d'addition / split tender. Dépend de B-1 livrée. L'assignation des **stations de production** (`product_sections`, 19/363) est un chantier distinct du module production.
