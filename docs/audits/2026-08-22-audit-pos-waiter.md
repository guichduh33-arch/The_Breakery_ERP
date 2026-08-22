# Audit du module POS Waiter — 2026-08-22

> **Statut** : rapport d'audit. Aucun fichier de code ou de schéma n'a été modifié.
> **Base interrogée** : Supabase cloud V3 dev `ikcyvlovptebroadgtvd`.
> **Branche** : `master`, arbre propre au démarrage (`b06a25e7`).
> **Méthode** : lecture du code + interrogation directe du schéma via MCP Supabase.
> Chaque affirmation porte un chemin de fichier, un numéro de ligne, ou la requête
> SQL qui l'établit.

---

## Suivi — état au 2026-08-22, après livraison

> **Ce bloc est le seul ajout postérieur au constat.** Tout ce qui suit à partir
> de la section 0 décrit l'état de la journée du 2026-08-22 **avant** correction,
> et n'a pas été retouché : réécrire un relevé effacerait la mesure qui l'a
> motivé. Lire le corps comme une photo, ce tableau comme la légende.

| Lot | Sujet | État |
|---|---|---|
| A | `order_items` absente de `supabase_realtime` (§2.1) | **livré** |
| B | tables occupées après paiement (§2.2) | **livré** |
| D | verrou absent sur `/tablet` + deux états réseau contradictoires (§2.3, §2.4) | **livré** |
| E | aucune couverture bout en bout (§2.8) | **livré** |
| C | RLS décorative et `p_waiter_id` non vérifié (§2.3 a et b) | **ouvert — 2 décisions en attente** |
| F | empaquetage Android (§2 ABSENT) | **ouvert — chantier neuf** |

Repères durables, plutôt que des empreintes de commit qui bougeraient à la
première fusion écrasante :

- migration `supabase/migrations/20260822000001_realtime_publish_order_items.sql` ;
- prédicat unique `apps/pos/src/features/tables/tableActivity.ts` ;
- hook unique d'état réseau `apps/pos/src/features/tablet/hooks/useTabletConnectionState.ts` ;
- filet de transport `supabase/tests/realtime_publication_orders.test.sql` ;
- parcours de salle `tests/e2e/waiter-flow.spec.ts`, projet Playwright `waiter`.

**Ce que la livraison n'a PAS établi**, et qui reste vrai du corps ci-dessous :

- la preuve bout en bout du lot A **dans un navigateur** — un article passé
  « prêt » qui déclenche le toast — n'a pas été faite ; elle demande une session
  PIN. Le *transport* est en revanche asserté par le pgTAP nommé ci-dessus,
  éprouvé dans les deux sens (vert en l'état, rouge après retrait de la table) ;
- l'état de la publication **en production** n'a pas été relevé (§1.4) ;
- la lenteur supposée des 376 cartes produit n'a pas été mesurée sur un appareil
  réel (§2.7) ;
- il n'existe toujours **aucun compte waiter dédié aux tests** : la spec E2E passe
  par un compte porteur de `sales.create`, donc le garde `role_code = 'waiter'`
  lui-même n'est pas éprouvé.

**Décisions toujours en attente** : les points 2 à 7 de la section 6. Les points 2
et 3 bloquent le lot C. Le point 1 est tranché — le dossier `docs/audits/` a été
créé et ce rapport y est versionné.

---

## 0. Deux corrections de prémisse, à lire avant tout

Le mandat parlait de « tablettes Android / mini-POS » et d'une « config Capacitor ».
Deux choses n'existent pas :

1. **Il n'y a aucun empaquetage mobile dans le dépôt.** Pas de `capacitor.config.*`,
   pas de dossier `android/` ni `ios/`, pas de `src-tauri/`, et aucune dépendance
   `@capacitor/*` ou `tauri` dans `package.json` (racine, `apps/*`, `packages/*`).
   Le module waiter est **une route web responsive** — `/tablet` — servie par le
   même bundle Vite que la caisse. Elle s'ouvre dans le navigateur de la tablette.

2. **La skill `db-schema-audit` citée dans le mandat n'existe pas** dans les skills
   disponibles de cette session. L'audit du schéma a été mené directement par le
   MCP Supabase (`execute_sql` sur les catalogues système).

Ces deux points ne sont pas des défauts : ce sont des faits qui changent la lecture
du reste du rapport.

---

## 1. Inventaire factuel

### 1.1 Le code spécifique au rôle waiter

| Zone | Chemin | Lignes |
|---|---|---|
| Coquille + navigation basse | `apps/pos/src/pages/tablet/TabletLayout.tsx` | 137 |
| Liste « My Orders » | `apps/pos/src/pages/tablet/TabletOrdersPage.tsx` | 52 |
| Prise de commande | `apps/pos/src/features/tablet/` — 1 page, 7 composants, 5 hooks | ~1 400 |
| Plan de salle | `apps/pos/src/features/floor-plan/` + `apps/pos/src/features/tables/` | ~900 |
| Réception côté caisse | `apps/pos/src/features/inbox/` — 2 composants, 4 hooks | ~290 |
| Bus LAN + hors-ligne | `apps/pos/src/features/lan/` — 12 modules | ~1 180 |
| Panier de salle | `apps/pos/src/stores/tabletCartStore.ts` | 119 |

**Routes** — `apps/pos/src/routes/index.tsx:142-166` :

```
/tablet          → TabletLayout (lazy)
  index          → redirection vers /tablet/order
  /tablet/order  → features/tablet/TabletOrderPage
  /tablet/orders → pages/tablet/TabletOrdersPage
```

Un commentaire du même fichier (`routes/index.tsx:11-14`) note qu'une version
appauvrie de la page de prise de commande a existé en doublon et a été supprimée.

**Garde de rôle** — `pages/tablet/TabletLayout.tsx:54-61` :

```ts
if (!isAuthenticated) return <Navigate to="/login" replace />;
const canAccessTablet =
  user?.role_code === 'waiter' || permissions.includes('sales.create');
if (!canAccessTablet) return <TabletAccessDenied />;
```

À noter : `/tablet` est la **seule** route applicative déclarée sans `<Protected>`
ni `<ProtectedLazy>` (`routes/index.tsx:142-146`). Le garde est équivalent, mais il
vit dans le composant. Cette différence a une conséquence, traitée en §2.3.

**Stores concernés** : `tabletCartStore.ts` (panier de salle),
`posSettingsStore.ts` (code appareil `T1`/`T2`, code source de numérotation),
`authStore.ts` (session, verrou), `cartStore.ts` (panier caisse, côté réception).

### 1.2 Cartographie waiter ↔ caisse

Il n'y a **pas** de liaison directe d'appareil à appareil en fonctionnement
nominal. Deux transports coexistent.

#### Transport 1 — le cloud Supabase (nominal)

| Geste | Écriture | Lecture par l'autre bout |
|---|---|---|
| Envoi en cuisine | RPC `create_tablet_order_v7` (`useCreateTabletOrder.ts:115`) | `usePendingTabletOrders` — realtime `orders` + filet 30 s (`usePendingTabletOrders.ts:28,48`) |
| 2ᵉ tournée sur une table servie | même RPC avec `p_order_id` (`useCreateTabletOrder.ts:127`) | `usePickedUpOrderSync` — realtime `order_items` + filet 20 s (lignes 90, 96) |
| Reprise de la commande à la caisse | RPC `pickup_tablet_order` (`usePickupTabletOrder.ts:153`) | — |
| Clôture d'une commande vidée | RPC `close_cancelled_tablet_order_v1` (`useCloseCancelledTabletOrder.ts:327`) | — |
| Retour cuisine → salle | le KDS écrit `order_items.kitchen_status` | `useTabletOrderStatusListener` — realtime `order_items` (ligne 37) |
| Occupation des tables | dérivée de `orders` | `useTableOccupancy` — realtime `orders` + filet 30 s (lignes 39, 52) |

**Tables et colonnes touchées** : `orders` (`waiter_id`, `created_via='tablet'`,
`table_number`, `status`, `sent_to_kitchen_at`, `session_id`, `order_number`),
`order_items` (`name_snapshot`, `line_total`, `is_locked`, `kitchen_status`,
`dispatch_stations`, `is_cancelled`), `restaurant_tables`,
`tablet_order_idempotency_keys`, `order_sequences`, `audit_logs`.

**Qui écrit quoi** : la tablette n'écrit **jamais** en direct. Toutes ses écritures
passent par des RPC `SECURITY DEFINER`. Conforme au pattern « Order writes = RPCs
uniquement » de `CLAUDE.md`.

#### Transport 2 — le bus LAN WebSocket (coupure internet)

`features/lan/hubBusClient.ts` — singleton refcompté, `ws://<hub>:3001/ws`,
protocole v1, reconnexion en repli 1 s → 30 s, déduplication par `msg_id`
(capacité 2 000), rattrapage du tampon circulaire à la reconnexion.

Topics : `order.fired`, `order.item_status`, `order.paid_offline`, `cart.mirror`,
`presence.heartbeat`, `settings.changed` (`hubBusClient.ts:24-30`).

En mode hors-ligne, l'envoi tablette publie `order.fired` : le KDS reçoit le ticket
sans cloud (`useCreateTabletOrder.ts:107`). Aucun secret, aucun prix négocié, aucun
nonce ne transite sur le bus (`busTopics.ts:4`). Toutes les charges utiles entrantes
sont validées par des gardes de parsing (`busTopics.ts:91-132`).

### 1.3 État réel côté base

**Les RPC du flux** (relevées sur le corps live via `pg_get_functiondef`) :

| Fonction | Arguments | `SECURITY DEFINER` | Bénéficiaires `EXECUTE` |
|---|---|---|---|
| `create_tablet_order_v7` | 9 args | oui | postgres, authenticated, service_role |
| `pickup_tablet_order` | 2 args | oui | postgres, authenticated, service_role |
| `close_cancelled_tablet_order_v1` | 2 args | oui | postgres, authenticated, service_role |

`anon` n'apparaît nulle part. Le test pgTAP
`supabase/tests/adr010_close_cancelled_tablet_order.test.sql:119` verrouille ce fait
pour la troisième.

**Gardes du corps de `create_tablet_order_v7`**, dans l'ordre d'exécution :

1. `auth.uid()` non nul, sinon `P0001` ;
2. `p_client_uuid` non nul, sinon `check_violation` ;
3. **rattrapage d'idempotence** — lecture de `tablet_order_idempotency_keys`, retour
   immédiat de l'`order_id` existant ;
4. `p_source_code` conforme à `^(P|T[0-9]+|BO)$`, sinon `check_violation` ;
5. permission `sales.create`, sinon `P0003` ;
6. au moins un article, sinon `check_violation` ;
7. **en création** : `dine_in` exige une table, sinon `P0011` ;
8. **en ajout** : la commande visée doit être `created_via='tablet'` et
   `status IN ('pending_payment','draft')`, sous `FOR UPDATE`, sinon `P0002` ;
9. par article : existence du produit (`P0002`), puis vendabilité
   (`_assert_product_sellable_v1`) sauf si `p_tolerate_unsellable` ;
10. écriture de la clé d'idempotence, avec rattrapage sur `unique_violation`.

Les lignes naissent `is_locked = true`, `kitchen_status = 'pending'`,
`sent_to_kitchen_at = now()`. Les stations de dispatch sont résolues serveur
(`_resolve_dispatch_stations_v1`). Les totaux de ligne sont calculés serveur
(`round_idr((unit_price + modificateurs) × quantité)`) — le prix envoyé par le client
sert d'entrée, jamais d'autorité sur le calcul.

L'audit est écrit avec le bon acteur : `SELECT id FROM user_profiles WHERE
auth_user_id = v_user_id` — conforme à la règle `actor_id` de `CLAUDE.md`.

**RLS** (requête sur `pg_policy`, champ `polpermissive` inclus) :

| Table | Politique | Commande | Permissive | Prédicat |
|---|---|---|---|---|
| `orders` | `auth_read` | SELECT | oui | `is_authenticated() OR has_kiosk_jwt(NULL)` |
| `orders` | `tablet_waiter_own_pending` | SELECT | oui | `is_authenticated() AND created_via='tablet' AND status='pending_payment' AND (waiter_id = get_current_profile_id() OR has_permission(auth.uid(),'payments.process'))` |
| `order_items` | `auth_read` | SELECT | oui | `is_authenticated() OR has_kiosk_jwt(NULL)` |
| `restaurant_tables` | `auth_read` | SELECT | oui | `is_authenticated() AND deleted_at IS NULL` |

Aucune politique INSERT / UPDATE / DELETE sur `orders` ni `order_items` : les
écritures passent exclusivement par les RPC. C'est cohérent et voulu.

**Index** utiles à ce flux :

- `idx_orders_pending_tablet` — `(sent_to_kitchen_at DESC) WHERE status='pending_payment' AND created_via='tablet'`. Couvre exactement la requête de la réception caisse.
- `idx_orders_active_table` — `(table_number) WHERE table_number IS NOT NULL AND status <> ALL (ARRAY['paid','voided'])`.
- `idx_oi_kds_station`, `idx_oi_dispatch_stations_gin` — côté cuisine.
- `orders_order_number_per_day_key` — unicité du numéro par jour métier `Asia/Makassar`.
- **Aucun index ne mentionne `orders.waiter_id`** (0 résultat sur `pg_indexes`).

**Triggers** : la numérotation passe par `order_sequences` en `INSERT … ON CONFLICT
DO UPDATE RETURNING`, dans la RPC, pas par un trigger.

**Publication realtime** — `pg_publication_tables` pour `supabase_realtime` :

```
business_config, categories, orders, products, receipt_templates
```

`order_items` **n'y figure pas**. Conséquences en §2.1.

**Volumétrie dev** : 60 commandes, 71 lignes, 0 commande `created_via='tablet'`,
11 tables actives, 376 produits actifs, 34 catégories.

### 1.4 État hors-ligne et synchronisation

**File locale** — `features/lan/offlineOutbox.ts`. IndexedDB
(`breakery-pos-offline`, v2, magasins `outbox` + `quarantine`), repli localStorage
pour jsdom et les hôtes exotiques. Écriture **avant** publication sur le bus
(`useCreateTabletOrder.ts:77` puis `:107`).

Quatre genres d'intention, **format append-only** : `fire`, `payment`,
`cash_payment` (hérité, plus jamais émis mais toujours lu), `tablet_order`. Le
commentaire `offlineOutbox.ts:74-77` explique pourquoi le genre hérité ne se retire
pas : un poste mis à jour avec des ventes en file rejouerait dans le vide, et ces
enregistrements sont de l'argent déjà encaissé.

**Rejeu** — `features/lan/offlineReplay.ts`. Séquentiel, ordre strict par `seq`,
verrou de module contre la réentrance (`:95`, `:215`), sans effet si non
authentifié (`:216`). Chaque intention rejoue la RPC **existante** avec sa clé
d'idempotence d'origine : un double rejeu est sans effet côté serveur.

**Résolution des conflits** — ADR-018. Une liste explicite de codes définitifs
(`offlineReplay.ts:35-40` : `P0011`, `23514`, `23503`, `22P02`). Tout code absent de
cette liste est réputé transitoire : le drain s'arrête et l'ordre est préservé. Un
code définitif met l'intention en quarantaine **avec tout ce qui en dépend**
(cascade, `:267-277`) et le drain continue. L'asymétrie est documentée : se tromper
en gardant coûte un retard, se tromper en quarantinant coûte la remontée d'une
vente.

Le registre de quarantaine est durable et append-only, sans purge automatique ni
péremption (`offlineOutbox.ts:103-106`).

**Idempotence de l'envoi tablette** : `clientUuidRef` posé en `useRef`
(`TabletOrderPage.tsx:112`), régénéré seulement après un envoi réussi (`:171`). Un
double appui sur « Send to Kitchen » réutilise donc la même clé, et le serveur rend
la commande déjà créée.

**Deux gardes qui protègent la file** :

- `useCreateTabletOrder.ts:51` — un `dine_in` sans table est refusé **avant** la mise
  en file. Sans cela, l'intention serait acceptée localement, le ticket partirait en
  cuisine par le bus, puis le rejeu la refuserait à chaque tentative, bloquant les
  encaissements derrière elle.
- `useCreateTabletOrder.ts:61` — la 2ᵉ tournée est **en ligne seulement**. Hors
  ligne il faudrait empiler une intention désignant une commande qui n'existe pas
  encore en cloud.

**Numérotation hors-ligne** : `L-<compteur>` par terminal
(`localOrderNumber.ts:147`). La collision entre terminaux est sans conséquence :
l'identité serveur est le `client_uuid`, pas ce numéro.

---

## 2. Diagnostic par zone

Légende : **COMPLET** / **PARTIEL** / **ABSENT** / **CASSÉ**.

### 2.1 Temps réel — CASSÉ

**Le fait** : `order_items` n'appartient pas à la publication `supabase_realtime`.

- Preuve base : `SELECT tablename FROM pg_publication_tables WHERE pubname='supabase_realtime'` → `business_config`, `categories`, `orders`, `products`, `receipt_templates`.
- Preuve dépôt : `grep -rn supabase_realtime supabase/migrations/` renvoie trois migrations (`…000022`, `…000181`, `…000202`). Aucune n'ajoute `order_items`.

**Ce qui est mort** :

`features/tablet/hooks/useTabletOrderStatusListener.ts:37-83` s'abonne à
`postgres_changes` UPDATE sur `order_items` avec le filtre
`kitchen_status=eq.ready`. Aucun événement ne sera jamais émis pour cette table.
**Le toast « Item ready » ne peut pas se déclencher** — c'est-à-dire la boucle de
retour cuisine → salle, la raison d'être de l'onglet « Orders » du serveur.

**Ce qui aggrave** : ni ce hook ni `useMyTabletOrders.ts` n'ont de `refetchInterval`.
La liste « My Orders » ne se rafraîchit que sur un envoi
(`useCreateTabletOrder.ts:137`) ou sur l'événement `online`
(`useTabletOrderStatusListener.ts:85`). Un plat qui sort de cuisine ne produit
**aucun** signal sur la tablette, ni immédiat ni différé.

**Ce qui survit par polling** — les autres consommateurs de `order_items` ont un
filet, ce qui explique que la panne soit restée invisible :

| Consommateur | Filet |
|---|---|
| `useKdsRealtime` | `useKdsOrders.ts:157` — `refetchInterval: 30_000` |
| `usePickedUpOrderSync` | ligne 96 — `setInterval(reload, 20_000)` |
| `useTabletOrderStatusListener` | **aucun** |

**Pourquoi les tests ne l'ont pas vu** :
`features/tablet/__tests__/tablet-ready-toast.test.tsx:19-30` remplace tout le
module `@/lib/supabase` par un faux qui capture le rappel passé à `.on()` et le
rejoue à la main. Le test vérifie la logique de tri et de déduplication — ce qui est
utile et juste — mais il ne peut structurellement rien dire du transport. Idem pour
`useTabletOrderStatusListener.uniqueChannel.test.tsx`.

**Ce qui va bien dans cette zone** : les noms de canaux sont uniques par montage
partout (`useTabletOrderStatusListener.ts:96`, `usePendingTabletOrders.ts:24`,
`usePickedUpOrderSync.ts:281`, `useTableOccupancy.ts:49`), avec la génération de
l'UUID **à l'intérieur** de l'effet — le piège StrictMode décrit dans `CLAUDE.md`
est traité, et commenté à chaque site.

**Limite de ce constat** : vérifié sur la V3 dev uniquement. L'état de la
publication en production n'a pas été relevé.

### 2.2 State et cohérence code ↔ base — CASSÉ

**Le fait** : `features/tables/hooks/useTableOccupancy.ts:24` établit l'occupation
par

```ts
.not('status', 'in', '(completed,voided)')
```

Or le paiement pose `status = 'paid'`
(`supabase/migrations/…_pay_existing_order_*.sql`, `status = 'paid'` dans chaque
version jusqu'à `v16`). L'énumération `order_status` vaut
`{draft, paid, voided, pending_payment, completed, b2b_pending}` : `paid` et
`completed` sont deux valeurs distinctes.

**Mesure sur la base dev** :

```sql
select count(distinct table_number) from orders
 where table_number is not null and status not in ('completed','voided');           -- 3
select count(distinct table_number) from orders
 where table_number is not null and status not in ('completed','voided','paid','b2b_pending'); -- 0
```

**3 tables sur 11 sont affichées occupées alors qu'aucune commande n'est ouverte.**
Toutes les commandes concernées sont payées.

**L'incohérence code ↔ base est explicite** : la base porte déjà la bonne définition
d'une table active — `idx_orders_active_table` est déclaré
`WHERE table_number IS NOT NULL AND status <> ALL (ARRAY['paid','voided'])`. Le
schéma exclut `paid`, le code ne l'exclut pas. Les deux ne disent pas la même chose.

**Le hook voisin est correct** : `useTableOrders.ts:65-67` calcule `appendable`
par `created_via === 'tablet' && (status === 'pending_payment' || status ===
'draft')`, miroir exact des gardes serveur. Le bouton « ajouter à la commande » ne
s'affiche donc pas à tort. Seul l'affichage occupé / libre est faux.

**Arbitrage retenu par le propriétaire (2026-08-22)** : libérer la table au
paiement, en alignant le code sur l'index.

### 2.3 Sécurité et RLS — PARTIEL

Trois constats distincts, aucun n'est une fuite d'argent.

#### a) La politique de cloisonnement waiter n'a aucun effet

Sur `orders`, deux politiques SELECT, **toutes deux `polpermissive = true`**. Les
politiques permissives se combinent par OU. La première,
`auth_read` = `is_authenticated() OR has_kiosk_jwt(NULL)`, accorde déjà la lecture
de toute la table à tout compte authentifié. La seconde,
`tablet_waiter_own_pending`, ne peut donc rien restreindre.

Le fait qu'une serveuse ne voie que ses commandes tient **au seul filtre client**
`useMyTabletOrders.ts:39` (`.eq('waiter_id', userId)`). Via PostgREST, un compte
waiter peut lire toutes les commandes du restaurant.

C'est une lecture plus large que ce que la politique laisse croire à qui lit le
schéma. Les écritures, elles, restent verrouillées derrière les RPC.

#### b) `p_waiter_id` n'est pas vérifié contre l'appelant

Le corps live de `create_tablet_order_v7` contrôle `auth.uid()` et la permission
`sales.create`, puis écrit `p_waiter_id` tel quel dans `orders.waiter_id`. Il ne
vérifie **jamais** que ce profil est celui de l'appelant.

Tout porteur de `sales.create` peut donc attribuer une commande à un autre serveur.
L'impact porte sur la traçabilité, l'imputation du service et les pourboires — pas
sur l'encaissement, qui reste gouverné par la session de caisse.

#### c) `pickup_tablet_order` n'est pas versionnée

Elle n'a pas de suffixe `_vN`, contrairement à `create_tablet_order_v7` et
`close_cancelled_tablet_order_v1`, et contre le pattern « RPC versioning monotone »
de `CLAUDE.md`. Toute évolution de sa signature devra soit rompre le pattern, soit
commencer par la renommer.

Son corps est par ailleurs correct : gate `payments.process`, `UPDATE … WHERE status
= 'pending_payment' AND created_via = 'tablet' RETURNING`, avec `P0012` si la ligne
n'existe plus. La reprise concurrente par deux caissiers est bien gérée par cette
mise à jour conditionnelle, et le message est traité côté client
(`usePickupTabletOrder.ts:186`).

#### Ce qui est solide dans cette zone

- Aucun droit `anon` sur les trois RPC du flux.
- Aucune écriture directe en table depuis l'application.
- L'acteur des lignes d'audit est bien résolu depuis `user_profiles`, jamais
  `auth.uid()`.
- La reprise à la caisse refuse d'écraser un panier en cours
  (`usePickupTabletOrder.ts:149`).

### 2.4 Hors-ligne et synchronisation — PARTIEL

Le socle est **solide** : file durable écrite avant publication, rejeu ordonné et
idempotent, quarantaine append-only, gardes qui empêchent de mettre en file ce que
le serveur refuserait. Rien à reprendre là.

Le défaut est ailleurs : **deux détecteurs d'état réseau coexistent et peuvent se
contredire.**

| Hook | Rythme | Signaux | Ce qu'il pilote |
|---|---|---|---|
| `useTabletOffline.ts:172` | ping 30 s | `navigator.onLine` + `HEAD /auth/v1/health` | la pastille du bandeau et de l'en-tête (**affichage**) |
| `useCloudPing.ts:73` + `offlineMode.ts:11` | ping 15 s | les mêmes, **plus** l'état du hub LAN | le chemin réellement emprunté (**décision**) |

`isOfflineMode()` exige cloud injoignable **ET** hub LAN joignable
(`offlineMode.ts:11-14`). La pastille ne regarde pas le hub.

**Cas concret, cloud coupé et hub coupé** — la pastille de l'en-tête
(`TabletLayout.tsx:80-95`) affiche « Offline », mais `isOfflineMode()` vaut `false` :
`useCreateTabletOrder.ts:70` prend la branche en ligne, l'appel RPC échoue, et la
serveuse reçoit un message d'erreur brut alors que l'écran venait de lui annoncer
le mode hors-ligne. Rien n'est perdu — mais rien n'est mis en file non plus, et
l'écran a menti.

Le commentaire `useCloudPing.ts:67` assume la coexistence (« `useTabletOffline`
reste intact »). Le coût de cette coexistence est que l'écran ne décrit pas le
comportement du code.

### 2.5 Verrouillage de session — PARTIEL

`IdleTimeoutMount` est monté dans `App.tsx:80`, donc actif sur **toutes** les
routes, `/tablet` comprise. À expiration il appelle `lock()`
(`IdleTimeoutMount.tsx:24`) → `authStore.isLocked = true` (`authStore.ts:203`).
`sessionDeathWatch.ts` pose le même état sur une session morte
(`authStore.ts:232`).

Mais l'écran de verrouillage n'est rendu qu'à deux endroits : `pages/Pos.tsx:333`
et `routes/index.tsx:63` (le conteneur `ProtectedLazy` des écrans satellites).
`/tablet` est déclaré **hors** de `ProtectedLazy` (`routes/index.tsx:142-146`), et
`TabletLayout.tsx` n'importe pas `TerminalLockedOverlay`.

**Résultat : la tablette passe à l'état verrouillé sans jamais l'afficher, et reste
entièrement pilotable.** Elle est laissée sur une table ou un passe ; c'est
précisément l'appareil qui a le plus besoin du verrou.

Le commentaire `routes/index.tsx:53-56` décrit ce défaut mot pour mot et raconte sa
correction pour les satellites : « avant, `isLocked` passait à true et l'écran
`/pos/reports` restait pilotable sans overlay ». `/kds` est **volontairement** exclu
(écran cuisine, jamais verrouillé). `/tablet` n'est ni corrigé ni déclaré comme
exception.

### 2.6 Interface, design et conformité au système — PARTIEL

**Aucun écart des classes mortes** : zéro occurrence d'alpha sur un jeton de couleur
`var()` (`bg-gold/5` et compagnie) dans les sept répertoires du périmètre. Le piège
n°1 du dépôt est absent ici.

**Tokens sémantiques employés partout** : `bg-bg-base`, `border-border-subtle`,
`text-text-secondary`, `bg-success-soft`, `text-gold`, `bg-gold-fg`. Aucune couleur
en dur relevée.

**Cibles tactiles** : `min-h-11` (44 px) posé sur les commandes principales —
`TabletOrderPage.tsx:222,254,290,313`. La grille produit est déclarée 2 colonnes en
portrait, 3 en paysage (`TabletProductGrid.tsx:151`). Le panneau panier se replie en
portrait (`TabletCartPanel.tsx:72`). Le mouvement respecte
`prefers-reduced-motion` via le jeton `--motion-base` (`TabletCartPanel.tsx:41-42`).

**Ce qui manque** :

| # | Constat | Preuve |
|---|---|---|
| a | Un message d'interface en **français** | `features/inbox/hooks/usePickedUpOrderSync.ts:82` — `` toast.info(`Nouvel article en salle : ${names}`) ``. `CLAUDE.md` : « L'interface parle ANGLAIS ». C'est le seul écart de langue du périmètre — les 14 autres messages sont en anglais. |
| b | Erreur serveur brute affichée à la serveuse | `features/tablet/TabletOrderPage.tsx:193` — `toast.error(raw)` en branche par défaut. Deux causes connues sont traduites, la troisième expose le message PostgREST. |
| c | Pas de garde design CI sur le POS | Six des sept gardes design déclarent `scanned: ['apps/backoffice/src/']` (`scripts/ci/tight-corner.mjs:83`, `gold-fills.mjs:67`, `focus-ring-controls.mjs:101`, `lying-font-classes.mjs:60`, `toolbar-button-scope.mjs:78`, `hardcoded-theme-colors.mjs:66`). Seule `tailwind-dead-classes.mjs:69` couvre `apps/` entier. |

Le point (c) est un **périmètre volontaire**, argumenté dans chaque en-tête de garde
(« le POS a ses propres cibles tactiles et sa propre rondeur »). Ce n'est pas un
défaut : c'est un fait à connaître avant de conclure qu'une PR frontend waiter est
couverte. Une seule garde design la voit.

### 2.7 Performances sur tablette d'entrée de gamme — PARTIEL

**Ce qui est fait** : chargement différé des routes (`routes/index.tsx:10-11`),
images en `loading="lazy"` (`features/products/ProductCard.tsx:107`), historique
tablette borné à 50 commandes (`useMyTabletOrders.ts:26`), ensemble de déduplication
borné à 1 000 entrées (`useTabletOrderStatusListener.ts:71`), cache de menu en
localStorage valable 24 h et incluant le plan de salle
(`useTabletMenuCache.ts:82,88-94`).

**Ce qui interroge** : `TabletProductGrid.tsx:151` rend `filtered.map(…)` sans
fenêtrage. Sans catégorie choisie, `selectedSlug` vaut `null` et le filtre laisse
tout passer (`:50-62`) : **376 cartes produit** dans le DOM à l'ouverture, chacune
avec image et badges.

Le compte de 376 produits actifs est un fait mesuré en base. La lenteur qui en
découlerait sur un appareil réel est une **hypothèse non vérifiée** : aucune mesure
n'a été prise sur un appareil, et le chargement différé des images en atténue une
partie.

**Point mineur** : aucun index sur `orders.waiter_id`, alors que
`useMyTabletOrders.ts:39` filtre dessus. Avec 60 commandes en base, l'impact est
**nul aujourd'hui**. Il ne le restera pas indéfiniment.

### 2.8 Tests — PARTIEL

**Ce qui existe** — 12 fichiers de test dans le périmètre tablette, plus les voisins :

| Couverture | Fichiers |
|---|---|
| Prise de commande | `TabletOrderPage.test.tsx`, `tablet-append`, `tablet-note`, `tablet-dine-in-guard`, `tablet-grid-error`, `tablet-send-idempotent` |
| Interface | `TabletCartPanel.touch`, `TabletCategorySidebar`, `TabletOrderConfirmation`, `TabletLayout.header`, `FloorPlanView` |
| Temps réel | `tablet-ready-toast`, `useTabletOrderStatusListener.uniqueChannel` |
| Hors-ligne | `TabletOffline`, `offlineReplay`, `offlineQuarantine`, `offlineOutbox`, `offlineMode`, `hubBusClient`, `busTopics`, `useHubPresence`, `useLanHeartbeat`, `useOfflinePaymentGate` |
| Base (pgTAP) | `adr010_close_cancelled_tablet_order.test.sql`, `adr022_pos_gates_sellability.test.sql` (cas T6/T7/T8 sur `create_tablet_order_v7`) |

C'est une couverture unitaire dense et sérieuse.

**Ce qui manque** :

1. **Aucun test E2E du parcours waiter.** `tests/e2e/` compte 12 specs ; une seule
   cite « tablet » (`s43-pos-audit-fixes.spec.ts`), et aucune ne joue le parcours
   salle → cuisine → caisse. De plus, le déclencheur `pull_request` de
   `playwright-e2e.yml` est désarmé (`CLAUDE.md`, section Commandes) : même
   existante, une spec ne protégerait pas les PR aujourd'hui.

2. **Aucun test ne voit le transport.** C'est la cause structurelle du §2.1 : tous
   les tests temps réel remplacent le client Supabase. Un test qui interroge
   `pg_publication_tables` aurait attrapé la panne en une ligne.

3. **La suite POS complète ne tourne pas en local** (`CLAUDE.md` : délai dépassé).
   La CI est le seul filet complet. Les tests du périmètre n'ont **pas été exécutés**
   dans le cadre de cet audit — l'audit était en lecture seule.

---

## 3. Tableau de synthèse

| Zone | Statut | Preuve principale |
|---|---|---|
| Temps réel | **CASSÉ** | `order_items` hors de `supabase_realtime` ; `useTabletOrderStatusListener.ts:37` sans filet |
| State / cohérence code↔DB | **CASSÉ** | `useTableOccupancy.ts:24` vs `idx_orders_active_table` ; 3 tables fausses sur 11 |
| Verrouillage de session | **PARTIEL** | `routes/index.tsx:142` hors `ProtectedLazy` ; `App.tsx:80` verrouille pourtant |
| Sécurité / RLS | **PARTIEL** | deux politiques permissives combinées par OU sur `orders` |
| Identité du serveur | **PARTIEL** | `p_waiter_id` non vérifié dans le corps live de `create_tablet_order_v7` |
| Hors-ligne — socle | **COMPLET** | `offlineOutbox.ts`, `offlineReplay.ts`, ADR-018 |
| Hors-ligne — affichage | **PARTIEL** | deux détecteurs, `useTabletOffline.ts:172` vs `offlineMode.ts:11` |
| Idempotence | **COMPLET** | `tablet_order_idempotency_keys` + `TabletOrderPage.tsx:112` |
| Design / système | **PARTIEL** | tokens et cibles tactiles corrects ; un message en français, une garde CI sur sept |
| Perfs tablette | **PARTIEL** | 376 cartes non fenêtrées ; lenteur non mesurée |
| Tests unitaires | **COMPLET** | 12 fichiers dans le périmètre |
| Tests bout en bout | **ABSENT** | aucune spec du parcours waiter |
| Empaquetage Android | **ABSENT** | aucun Capacitor, aucun `android/`, aucune dépendance |

### Ce qui tient et ne doit pas être touché

- L'idempotence de l'envoi, des deux côtés — client et serveur.
- La file hors-ligne et sa quarantaine append-only.
- La garde « dine-in exige une table », appliquée client **et** serveur.
- Les noms de canaux temps réel uniques par montage.
- La 2ᵉ tournée limitée au mode en ligne.
- Le panier de salle persistant en `sessionStorage` — il survit à une mise en
  veille, pas au service suivant.

---

## 4. Constaté contre hypothèse

**Constaté** — code lu ou base interrogée : tout ce qui précède, sauf ci-dessous.

**Hypothèses à vérifier** :

1. Que `order_items` soit **aussi** absent de la publication en production. Seule la
   V3 dev a été interrogée.
2. Que 376 cartes produit dégradent l'usage sur une tablette d'entrée de gamme. Le
   compte est un fait, la lenteur n'a pas été mesurée.
3. Que les tests du périmètre passent aujourd'hui. Ils n'ont pas été exécutés —
   l'audit était en lecture seule.

**Information manquante, non comblée** :

- Le modèle exact des tablettes en service, leur version d'Android et leur
  navigateur. Rien dans le dépôt ne les documente.
- L'adresse et l'état du hub LAN en boutique. Le code le dérive de `printerUrl` ;
  la valeur réelle n'est pas dans le dépôt.

---

## 5. Plan de clôture

Ordre : **A seul d'abord**. Puis **B, C, D en parallèle**. Puis **E**. Puis **F**.

### Lot A — Temps réel (bloquant)

- **Objectif** : le retour cuisine → salle fonctionne réellement.
- **Sous-agent** : `db-engineer`.
- **Périmètre** : une migration neuve dans `supabase/migrations/` ;
  `apps/pos/src/features/tablet/hooks/useMyTabletOrders.ts`.
- **Travail** : `ALTER PUBLICATION supabase_realtime ADD TABLE public.order_items` ;
  ajouter un `refetchInterval` de secours à `useMyTabletOrders`.
- **Acceptation vérifiable** : `pg_publication_tables` liste `order_items` ; un
  `UPDATE` de `kitchen_status` déclenche le toast, **constaté dans le navigateur**,
  pas dans un test avec client simulé.
- **Dépendances** : aucune. **Bloque le lot E.**

### Lot B — Occupation des tables

- **Objectif** : une table payée redevient libre.
- **Sous-agent** : `pos-specialist`.
- **Périmètre** : `features/tables/hooks/useTableOccupancy.ts`,
  `features/tables/hooks/useTableOrders.ts`, leurs répertoires `__tests__/`.
- **Travail** : aligner le prédicat sur `idx_orders_active_table` — exclure `paid`.
- **Acceptation vérifiable** : sur la base dev, 0 table comptée occupée (3
  aujourd'hui) ; un test couvre explicitement le cas `paid`.
- **Dépendances** : aucune.

### Lot C — Sécurité et RLS

- **Objectif** : la politique dit ce qu'elle fait ; un serveur ne peut pas se faire
  passer pour un autre.
- **Sous-agent** : `db-engineer`, avec la skill `security-auth`.
- **Périmètre** : migration neuve ; passage de `create_tablet_order_v7` à `_v8`.
- **Travail** : (1) trancher le sort de `tablet_waiter_own_pending` — la rendre
  restrictive, ou la retirer et assumer la lecture large ; (2) `_v8` vérifie que
  `p_waiter_id` est bien le profil de l'appelant, sauf permission d'attribution
  explicite.
- **Acceptation vérifiable** : test pgTAP — un serveur A ne peut pas créer au nom de
  B ; paire `REVOKE … FROM PUBLIC` présente ; types régénérés ; `_v7` supprimée dans
  la même migration.
- **Dépendances** : aucune. **Demande deux décisions préalables** (§6).

### Lot D — Hors-ligne et verrouillage

- **Objectif** : un seul état de connexion affiché ; la tablette se verrouille.
- **Sous-agent** : `pos-specialist`.
- **Périmètre** : `features/tablet/hooks/useTabletOffline.ts`,
  `features/tablet/components/OfflineBanner.tsx`, `routes/index.tsx`,
  `pages/tablet/TabletLayout.tsx`.
- **Travail** : (1) la pastille lit la même source que `isOfflineMode()` et
  distingue trois états — en ligne / hors-ligne avec bus / coupure totale ; (2)
  rendre `<TerminalLockedOverlay>` sur `/tablet`, comme pour les écrans satellites.
- **Acceptation vérifiable** : un test prouve que `isLocked` affiche l'écran de
  verrouillage sur `/tablet` ; un test prouve que « cloud coupé + hub coupé »
  n'annonce pas « Offline ».
- **Dépendances** : aucune.

### Lot E — Tests bout en bout

- **Objectif** : un filet qui voit le transport, pas seulement le code.
- **Sous-agent** : `test-engineer`.
- **Périmètre** : `tests/e2e/waiter-flow.spec.ts` (neuf) ; le pgTAP du lot C.
- **Travail** : parcours complet — connexion serveur, choix de table, envoi,
  apparition dans la réception caisse, passage d'un article en « prêt », réception
  du toast.
- **Acceptation vérifiable** : la spec passe contre la base dev, **et échoue** si on
  retire `order_items` de la publication.
- **Dépendances** : **après A, B, C, D**.

### Lot F — Empaquetage Android

- **Objectif** : une application installable sur la tablette.
- **Sous-agent** : `pos-specialist`, dans un arbre de travail isolé.
- **Périmètre** : `apps/pos/capacitor.config.ts`, `apps/pos/android/`,
  `apps/pos/package.json`, un runbook de fabrication.
- **Travail** : Capacitor, icônes, écran de démarrage, permissions Android, mode
  kiosque, fabrication signée.
- **Acceptation vérifiable** : un APK s'installe et ouvre `/tablet` ; la file
  hors-ligne survit à une mise en veille de l'appareil.
- **Dépendances** : **après E**. C'est un chantier **neuf**, pas une clôture : il
  pèse autant que A à E réunis.

### Régime des sous-agents

Conforme à `CLAUDE.md` :

- Le plan est approuvé avant tout envoi ; toute déviation remonte, jamais arbitrée
  en interne.
- Un seul agent écrivain à la fois, périmètre de fichiers déclaré à l'avance.
- Le relecteur travaille à contexte vierge : il reçoit le diff, la spécification et
  les invariants — jamais le résumé de l'implémenteur.
- Boucle implémentation ↔ relecture plafonnée à une correction.
- La relecture ne remplace jamais les tests exécutés.

---

## 6. Décisions à trancher avant de lancer

1. **`docs/audits/`** — ce dossier n'existait pas et ne figure pas dans la
   hiérarchie de vérité de `CLAUDE.md`. Il a été créé pour porter ce rapport, à ta
   demande explicite. Le **commit** attend ta validation (règle documentaire 1).

2. **Lot C — la politique RLS.** La rendre restrictive, de sorte qu'une serveuse ne
   lise plus que ses propres commandes ? Le risque est de couper un écran qui lisait
   large sans le déclarer. Ou la retirer, et assumer par écrit que tout compte
   authentifié lit toutes les commandes ?

3. **Lot C — l'attribution.** Un responsable doit-il pouvoir créer une commande au
   nom d'un autre serveur ? Si oui, il faut une permission dédiée et une trace
   d'audit ; si non, la vérification est simple.

4. **Faut-il un ADR ?** Les lots C et F changent un comportement et une
   architecture. `CLAUDE.md` règle 6 exige un accord explicite **avant** l'action.

5. **La production.** Puis-je vérifier l'état de la publication temps réel en
   production, ou ce rapport s'en tient-il à la V3 dev ?

6. **La grille de 376 produits.** Je mesure sur un appareil réel avant de proposer
   quoi que ce soit, ou ce point reste-t-il ouvert ?

7. **Le message en français** (`usePickedUpOrderSync.ts:82`). Correction isolée
   immédiate, ou rattachée au lot D ?

---

## 7. Ce que cet audit n'a pas fait

- Aucun test n'a été exécuté.
- Aucun fichier de code, de schéma ou de configuration n'a été modifié.
- La production n'a pas été interrogée.
- Aucune mesure de performance n'a été prise sur un appareil réel.
- Le rapport n'a pas été commité.
