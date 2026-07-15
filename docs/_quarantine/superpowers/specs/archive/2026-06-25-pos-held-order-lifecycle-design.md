# Spec A — POS held-order lifecycle (addition ouverte)

> **Date** : 2026-06-25
> **Statut** : design validé (brainstorming), en attente de relecture utilisateur avant plan d'implémentation.
> **Périmètre** : `apps/pos`, `packages/domain` (cart), `supabase/migrations` + RPC.
> **Hors périmètre (→ Spec B séparée)** : station `display`, destination transversale `waiter`, impression caisse vs waiter, écran KDS waiter, mapping complet des catégories. Voir « Suite » en fin de document.

## 1. Contexte et problème

Le bouton **« Send to Kitchen »** du POS est **inactif en permanence**. Cause racine confirmée empiriquement sur la DB V3 dev (`ikcyvlovptebroadgtvd`) : **100 % des 363 produits actifs** ont `dispatch_station = 'none'`. Le bouton se désactive quand `firableCount === 0` (`apps/pos/src/features/cart/SendToKitchenButton.tsx` + `useFireToStations.ts`), or aucun produit ne route vers une station de prep. Ce n'est pas un bug de code : c'est une **configuration de routage jamais faite**.

Au-delà du déblocage, le comportement métier attendu n'existe pas encore : le **cycle de vie « addition ouverte »** propre au service à table.

### Comportement cible (demande utilisateur)

1. Après la prise de commande, **« Send to Kitchen »** dispatche les items vers les stations **et place automatiquement la commande dans les held orders**, en **vidant le terminal** (caisse libre pour le client suivant).
2. Un **checkout direct** dispatche aussi automatiquement vers les stations, puis renvoie vers l'écran de paiement.
3. Tout produit **déjà envoyé en cuisine** ne peut plus être renvoyé : il devient un **produit bloqué** de la commande lors de la réouverture.
4. Une held order peut être **rouverte** ; on peut y **ajouter de nouveaux produits**. À leur envoi, les produits de la première phase **ne sont pas réimprimés** et le **nouveau KOT porte la mention « ADDITIONAL ORDER »**.

## 2. État de l'existant (vérifié dans le code)

- `fire_counter_order_v4` (`supabase/migrations/20260705000014_bump_fire_counter_order_v4.sql`) **persiste déjà** la commande : crée un `orders` en `status='pending_payment'`, `sent_to_kitchen_at = now()`, et insère chaque ligne avec **`is_locked = true`**, `kitchen_status = 'pending'`. Son **mode append** (`p_order_id`) n'accepte qu'une commande `pending_payment`, `created_via='pos'`, même `session_id`. → Le verrouillage des items envoyés et l'ajout d'items **existent déjà côté DB**.
- `useFireToStations.ts` appelle ce RPC (sauf en `printOnly`), puis `markLocked` + `markPrinted` localement, puis imprime par station (best effort). Idempotence flavor‑2 via `p_client_uuid` (un UUID par fire, conservé entre retries).
- `order_items` possède déjà les colonnes **`is_locked`** et **`kitchen_status`** → l'état « bloqué » peut vivre sur la ligne DB.
- Held orders **brouillons** : `hold_order_v1` (`20260620000011`) crée un `orders` en `status='draft'`, `is_held=true`, items `is_locked=false`. `restore_held_order_v1` (`20260620000013`) **supprime** le brouillon et renvoie le snapshot — `useRestoreHeldOrder.ts` régénère des ids neufs **sans préserver le lock**. La liste (`useHeldOrdersQuery.ts`) lit `orders WHERE is_held = true`.
- `BottomActionBar.tsx` : Hold est **désactivé** quand `pickedUpOrderId !== null` (« Order already sent to kitchen — pay or void it »). Void post‑envoi gated PIN manager.
- `pay_existing_order` accepte déjà les fired counter orders (`20260627000016`).
- `dispatch_station` = `text` avec CHECK `('kitchen','barista','bakery','none')` (pas un enum). UI BackOffice de routage par catégorie : `CategoryFormDialog.tsx`.

**Conclusion** : l'essentiel de la mécanique backend existe. Spec A est surtout du **câblage** + 2 petits RPC additifs + un flag d'impression + une réhydratation de cart enrichie.

## 3. Modèle retenu (décision validée)

La « held order » réouvrable après envoi = **la vraie commande envoyée** (`status='pending_payment'`) **flaggée `is_held=true`** (modèle « addition ouverte »). Les brouillons `hold_order_v1` restent pour **parquer sans envoyer** en cuisine. Les deux cohabitent dans `orders` (discriminés par `status`).

## 4. Conception détaillée

### Bloc 1 — Déblocage routage (migration de données, minimal)

Router seulement les catégories **non ambiguës** vers les 2 stations existantes, pour activer le flux et le rendre testable. Le mapping fin est reporté en Spec B.

| Station | Catégories routées (Spec A) |
|---|---|
| `barista` | Coffee, Speciale Latte, Special Drinks |
| `kitchen` | Simple Plate, Panini, Savoury Croissant (+ catégorie combos plate si distincte) |

- Tout le reste reste `none` (viennoiserie/pains = vitrine, sandwichs froids/chauds, jus → Spec B).
- Migration **de données** uniquement (`UPDATE categories SET dispatch_station = … WHERE name = …`), idempotente et réversible. **Aucun changement de schéma.** Cibler par identifiant stable (id/name) ; documenter le down.
- ⚠️ Mapping à confirmer par l'utilisateur en relecture (connaissance métier).

### Bloc 2 — Send to Kitchen → parque en held + vide le terminal

- **Nouveau RPC** `hold_fired_order_v1(p_order_id uuid) RETURNS void` (ou `boolean`) :
  - `SECURITY DEFINER`, `SET search_path = public`.
  - Vérifie `auth.uid()`, gate `has_permission(uid, 'pos.sale.create')`.
  - `UPDATE orders SET is_held = true WHERE id = p_order_id AND status = 'pending_payment' AND created_via = 'pos'` ; lève `P0002` si 0 ligne.
  - `INSERT INTO audit_logs (actor_id, action='order.held', entity_type='orders', entity_id=p_order_id, metadata)`.
  - **Paire REVOKE S25** : `REVOKE EXECUTE … FROM PUBLIC` + `FROM anon` + `ALTER DEFAULT PRIVILEGES … REVOKE EXECUTE … FROM PUBLIC` (migration dédiée).
  - Idempotent par nature (poser `is_held=true` deux fois est inoffensif).
  - *Choix : RPC additif plutôt que bumper `fire_counter_order` en v5 — moins invasif, pas de DROP/recreate ni de mise à jour de tous les callers. Le held ne concerne que le chemin Send‑to‑Kitchen, pas le checkout direct.*
- **Front** (`SendToKitchenButton` / `useFireToStations`) : après succès du fire **et** de l'impression, appeler `hold_fired_order_v1(order_id)` puis **vider le terminal** (`cartStore.reset()` / équivalent existant) et invalider `['held-orders']`. La commande quitte le terminal et apparaît dans Held Orders.
- Checkout direct : **inchangé** (auto‑fire `printOnly` existant → écran paiement).
- Conséquence UI : l'item de menu « Hold » (brouillon) reste pour parquer **avant** envoi ; après un Send, plus besoin de la garde `pickedUpOrderId` puisque le terminal est vidé.

### Bloc 3 — Réouverture avec produits bloqués

- **Nouveau RPC** `reopen_held_order_v1(p_order_id uuid) RETURNS jsonb` :
  - Gate `pos.sale.create`. **Ne supprime pas** la commande.
  - Renvoie l'enveloppe : `order_id`, `order_number`, `order_type`, `table_number`, `customer_id`, `notes`, et `items[]` avec `id` (= `order_items.id`), `product_id`, `name_snapshot`, `unit_price`, `quantity`, `modifiers`, `is_locked`, `kitchen_status`.
  - Pose **`is_held = false`** (claim : la commande sort de la liste tant qu'elle est ouverte sur un terminal → évite l'ouverture concurrente par deux caisses). Garde `status='pending_payment'`.
  - `audit_logs` `order.reopened`.
  - Paire REVOKE S25.
- **`cartStore`** : nouvelle action `reopenOrder(payload)` qui
  - charge les items (réutilise les `order_items.id` comme ids de ligne pour un suivi stable du lock),
  - pose `pickedUpOrderId = order_id`,
  - pousse les items `is_locked=true` dans `lockedItemIds` **et** `printedItemIds` → **non éditables, non re‑envoyés, non réimprimés**,
  - réattache table/customer/notes (réutiliser le pattern `get_customer_v2` de `useRestoreHeldOrder` pour le badge).
- **Liste Held Orders** : `useHeldOrdersQuery` ajoute `status` (et/ou `sent_to_kitchen_at`) à la sélection. La modale (`HeldOrdersModal`) branche : `status='draft'` → `restore_held_order_v1` (chemin brouillon existant) ; `status='pending_payment'` → `reopen_held_order_v1` (nouveau). Badge visuel distinguant « brouillon » vs « envoyée ».

### Bloc 4 — KOT « ADDITIONAL ORDER » + checkout

- Ajout de produits sur une commande rouverte → fire **append** : `useFireToStations` passe déjà `p_order_id = pickedUpOrderId` et exclut les lignes `lockedItemIds` du RPC. Seuls les **nouveaux** items partent.
- **Flag additional** : `StationTicketPayload` (`apps/pos/src/services/print/printService.ts`) reçoit un champ `additional?: boolean`. `useFireToStations` le met à `true` quand `pickedUpOrderId` était **déjà** posé au moment du fire (= la commande existait → c'est une 2ᵉ phase). Le template d'impression affiche l'en‑tête **« ADDITIONAL ORDER »**.
- Phase 1 non réimprimée : garanti par `printedItemIds` réhydraté depuis la DB à la réouverture (Bloc 3).
- Checkout d'une commande rouverte : auto‑fire `printOnly` des nouveaux items puis `pay_existing_order` (déjà compatible). Au paiement, `is_held` est déjà `false` (claim au reopen) ; la commande sort définitivement de la liste held.

## 5. Invariants & sécurité (gate de shippabilité)

- **RPC versioning monotone** : les 2 nouveaux RPC sont des créations (`_v1`), pas des éditions. `fire_counter_order_v4` **non modifié**.
- **Paire REVOKE S25** sur `hold_fired_order_v1` et `reopen_held_order_v1` (PUBLIC + anon + ALTER DEFAULT PRIVILEGES).
- **Idempotence** : fire inchangé (flavor‑2 `p_client_uuid`). `hold`/`reopen` naturellement re‑jouables (read / set‑true / set‑false).
- **audit_logs** : `order.held` (hold), `order.reopened` (reopen) ; l'append de discount reste tracé par `fire_counter_order_v4`.
- **Void** : une held order rouverte (`pickedUpOrderId` posé) suit le chemin void serveur existant, gated PIN manager. Vérifier que `useVoidServerOrder` couvre une commande counter `pending_payment` (et pas seulement un pickup tablet).
- **Écritures via RPC** : aucune écriture brute sur `orders`/`order_items` côté app.
- **Regen types** après les nouvelles migrations (`types.generated.ts`).
- **Concurrence** : le claim `is_held=false` au reopen empêche l'ouverture simultanée ; un 2ᵉ reopen sur une commande déjà ouverte renvoie 0 ligne → message « déjà ouverte ».

## 6. Tests & vérification

- **pgTAP** (MCP `execute_sql`, BEGIN/ROLLBACK) : `hold_fired_order_v1` (gate, P0002 sur id absent/mauvais statut, audit), `reopen_held_order_v1` (renvoie items + locks, pose is_held=false, ne supprime pas, audit, REVOKE anon).
- **Vitest live RPC** (`@breakery/supabase`) : hold→reopen round‑trip ; append additional ne duplique pas les lignes lockées.
- **Smoke POS** (`@breakery/app-pos`) : parcours Send→terminal vidé→commande dans la liste→reopen→items bloqués (non éditables/non firables)→ajout→fire additional (KOT « ADDITIONAL », phase 1 non réimprimée)→checkout.
- **Domain unit** : réhydratation des locks (`reopenOrder` peuple `lockedItemIds`+`printedItemIds` à partir de `is_locked`).
- **Cheap d'abord** : `pnpm typecheck`, `pnpm --filter @breakery/domain test`, puis smokes ciblés. Cible DB = V3 dev cloud, jamais Docker/prod.

## 7. Risques / réserves

- **Réserve sur « waiter = 4e destination par produit »** (émergé en discussion) : router un produit vers **plusieurs** destinations casse le modèle actuel (1 produit → 1 station). À concevoir en Spec B comme **vue/impression de la commande entière** plutôt que routage multiple. Hors Spec A.
- Le **mapping minimal** (Bloc 1) est volontairement réduit ; à confirmer en relecture.
- La liste held mêlant brouillons et commandes envoyées impose un discriminateur fiable (`status`) — couvert Bloc 3.

## 8. Suite — Spec B (séparée)

Station `display`, destination transversale `waiter` (vue/impression de la commande entière), impression caisse (bon + reçu) vs waiter (bons par table), écran KDS waiter, mapping complet des catégories (résolution de l'overlap sandwichs froids/chauds, jus, viennoiserie/pains). Dépend de Spec A livrée.
