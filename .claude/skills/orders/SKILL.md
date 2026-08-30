---
name: orders
description: >-
  Orders domain expert — order lifecycle, liste serveur (filtres + tri + keyset), edit-items
  RPCs, void/refund, held, realtime. Cross-app business logic (POS writes + BO management);
  distinct from pos-specialist (POS UI surface) and backoffice-specialist (BO UI surface). Use
  this skill whenever the task mentions order(s) / commande(s), statut de commande, void /
  annulation, refund / remboursement, pending_payment, held order / commande en attente,
  ardoise, complete_order_with_payment, pay_existing_order, fire_counter_order,
  create_tablet_order, order items / lignes de commande, totaux de commande, orders
  realtime — or touches apps/backoffice features/orders, POS order-history, or any supabase
  migration/test with order in the name. Invoke it BEFORE editing any order lifecycle RPC
  or status transition, even a small one.
pathPatterns:
  - 'apps/backoffice/src/features/orders/**'
  - 'apps/backoffice/src/pages/**/Order*'
  - 'apps/pos/src/features/order-history/**'
  - 'supabase/migrations/*order*.sql'
  - 'supabase/tests/*order*.test.sql'
promptSignals:
  phrases:
    - 'order list'
    - 'order status'
    - 'edit order item'
    - 'void order'
    - 'order refund'
    - 'pending_payment'
    - 'get_orders_list'
    - 'order totals'
    - 'orders realtime'
    - 'complete_order'
    - 'add_order_item'
    - 'remove_order_item'
---

# Orders — The Breakery ERP

> **ADR applicables : ADR-009** (cycle de vie : aucune écriture sur `orders`/`order_items`
> hors RPC ; transition `paid → completed` par trigger ; le void est la seule sortie de
> `completed`) · **ADR-010** (un item verrouillé en cuisine est intouchable — annulation,
> baisse de quantité, suppression : autorisation manager vérifiée serveur **et** perte
> obligatoire) · **ADR-013** (void interdit après refund partiel · exactement une
> contre-passation · nonce PIN manager sur toute remise · contrat d'idempotence
> contraignant sur money-path et edit-items) · **ADR-022** (une commande n'existe qu'envoyée
> en cuisine ou payée — la voie brouillon serveur est supprimée) · **ADR-025** (compteurs de
> la liste des commandes). Ils font loi : une proposition qui les contredit se **signale**,
> elle ne s'implémente pas.
>
> **Convention (appliquée, pas seulement promise)** : le corps de ce fichier cite des
> **familles** d'objets DB (`complete_order_with_payment`, `cancel_order_item_rpc`), jamais
> une version comme pointeur du vivant. Les seules versions écrites ici sont **des faits
> datés** — l'inventaire du 2026-08-31 ci-dessous — ou des **noms de fichiers**
> (migrations, tests), qui sont des faits. La version vivante se re-vérifie toujours dans
> `supabase/migrations/` (numéro le plus haut) **et** au call-site.
>
> **Re-vérification : 2026-08-31.** Enums, familles RPC, permissions et chemins ci-dessous
> ont été relevés contre le code à cette date. Au moindre écart, **le code gagne** : signale
> la ligne fausse, ne la contourne pas.

Expert on order business logic across POS (writes) and Backoffice (management). Two use-cases:

1. **Guide** changes to the order lifecycle — new status transitions, edit-items flows, new filters.
2. **Audit** order integrity — status guards, idempotency, realtime consistency, totals recalc.

**`CLAUDE.md` est la source de vérité** pour les patterns projet (RPC versioning, REVOKE pairs, PIN header, idempotency). Ce skill ajoute uniquement la surface map ordres, les noms réels vérifiés, et les checklists préventives spécifiques.

**Anti-overlap boundary :** ce skill couvre la logique métier ordres (RPCs, tables, enums, guards). `pos-specialist` couvre l'UI POS (ProductGrid, CartSidebar, …). `backoffice-specialist` couvre l'UI BO (OrdersListPage, filtres, ExportButtons). Les trois coexistent sans collision.

---

## Mental model — Order lifecycle

```
POS writes                          BO management
──────────                          ─────────────
fire_counter_order                  get_orders_list
 ↓ status: pending_payment            ↓ filtres JSONB + tri blanc-listé
 ↓ numéro de commande minté           ↓ keyset générique (valeur_de_tri, id)
 ↓ append sur commande existante
                                    get_orders_counters
complete_order_with_payment          ↓ agrégats de la même grammaire de filtres
 ↓ status: paid → completed (trigger)
                                    search_orders
pay_existing_order                   ↓ palette de commandes (numéro / client)
 ↓ pending_payment → paid
                                    add / update_order_item_qty / remove_order_item
create_tablet_order                  ↓ draft | pending_payment uniquement
 ↓ status: draft (created_via=tablet) ↓ _recalc_order_totals atomique
                                     ↓ ligne verrouillée → nonce manager (ADR-010)
create_b2b_order
 ↓ status: b2b_pending              void_order_rpc / refund_order_rpc
                                     ↓ via EF void-order / refund-order
hold_fired_order                     ↓ PIN en en-tête x-manager-pin (EF)
 ↓ is_held sur une commande ENVOYÉE   ↓ idempotence en en-tête + en argument
reopen_held_order / discard_held_order
                                    useOrdersRealtime
transfer_order_table                 ↓ postgres_changes INSERT+UPDATE
cancel_order_item_rpc (ADR-010)      ↓ StrictMode-safe via useId
close_cancelled_tablet_order
```

### order_status enum — valeurs réelles

Vérifié dans `packages/supabase/src/types.generated.ts` (2026-08-31), posé par
`20260503000000_init_extensions_enums.sql` et corrigé côté guards par
`20260618000023_fix_edit_items_rpc_status_enum.sql` :

```
draft | paid | voided | pending_payment | completed | b2b_pending
```

> **PAS de valeur `open`** — le corrective `20260618000023` a corrigé exactement ce bug dans
> les 3 RPCs edit-items (était `IN ('draft', 'open')`, doit être
> `IN ('draft', 'pending_payment')`). Ne jamais introduire `'open'`.

### order_type enum — valeurs réelles

Vérifié dans `types.generated.ts` (2026-08-31) : posé par
`20260503000000_init_extensions_enums.sql`, étendu par
`20260601000005_extend_order_type_enum_b2b.sql` :

```
dine_in | take_out | delivery | b2b
```

> **`tablet` n'est PAS un `order_type`** — c'est une valeur de la colonne
> `orders.created_via`, colonne TEXT contrainte `CHECK (created_via IN ('pos','tablet'))`
> par `20260507000001_extend_orders_tablet.sql`. Confondre les deux fait écrire un filtre
> qui ne matchera jamais, et un `ADD VALUE` d'enum qui n'a pas lieu d'être.

### Schema reality (noms de colonnes réels — diffèrent de l'intuition)

| Table | Colonne réelle | Pas |
|-------|---------------|-----|
| `orders` | `total` | `total_amount` |
| `orders` | `served_by` | `created_by` |
| `order_items` | `name_snapshot` | `product_name` |
| `order_items` | `modifiers` (JSONB array) | `modifiers_json` |
| `refunds` | `total` | `amount` |
| `customers` | `name` | `full_name` |

**`orders.session_id` nullable — UNE contrainte, TROIS exemptions.**
`orders_session_id_required_for_pos` est reconstruite à chaque relaxation ; sa forme
actuelle (`20260620000015_relax_orders_session_id_for_held.sql`) exempte :

```
session_id IS NOT NULL
  OR order_type = 'b2b'          (20260601000007_relax_orders_session_id_nullable.sql)
  OR created_via = 'tablet'      (20260602000014_relax_orders_session_id_for_tablet.sql)
  OR is_held = true              (20260620000015_relax_orders_session_id_for_held.sql)
```

Toute reprise de cette contrainte doit reporter **les trois** exemptions : en oublier une
casse silencieusement un parcours entier (B2B, tablette, ou mise en attente).

---

## Familles RPC — inventaire daté

> **État relevé le 2026-08-31** contre `packages/supabase/src/types.generated.ts` (le
> catalogue des fonctions live) **et** les call-sites. Les versions de cette colonne sont un
> instantané historique, **pas** un pointeur : elles bumpent presque chaque session. On cite
> la famille ailleurs, et on re-relève ici avant de s'y fier.

### Write RPCs (JAMAIS d'INSERT direct — passe toujours par RPC)

| Famille | État 2026-08-31 | Notes |
|---------|-----------------|-------|
| `complete_order_with_payment` | v27 | Money-path principal, appelé par l'EF `process-payment` (jamais par le POS en direct). Garde `table_required_for_dine_in` (P0011). Remise autorisée par nonce `p_discount_auth_id`, pas par PIN. |
| `pay_existing_order` | v18 | `pending_payment → paid` d'une commande déjà envoyée. |
| `fire_counter_order` | v7 | Envoi en cuisine côté comptoir : **crée ou complète** la commande (`p_order_id` optionnel = append), minte le numéro, exige `p_session_id`. Call-sites : `useFireToStations`, `useCheckout`, `offlineReplay`. |
| `create_tablet_order` | v8 | Commande serveur/tablette. `p_client_uuid` + `p_waiter_id` + `p_table_number` requis ; idempotence métier via table dédiée. |
| `create_b2b_order` | v6 | Gate `validate_b2b_credit_limit`. Status `b2b_pending`. |
| `refund_order_rpc` | v10 | Appelée par l'EF `refund-order`. Reçoit `p_authorized_by` (profil manager) + `p_acting_auth_user_id` — **pas** le PIN. |
| `void_order_rpc` | v10 | Appelée par l'EF `void-order`. Gate `pos.sale.void`. Émet JE-VOID + stock `sale_void` + reverse loyalty. |
| `cancel_order_item_rpc` | v6 | ADR-010 — annulation d'une ligne, perte obligatoire si verrouillée (`p_waste_qty`). Passe par l'EF `cancel-item` (call-site `useCancelOrderItem`). |
| `hold_fired_order` | v1 | **La seule** mise en attente : pose `is_held` sur une commande DÉJÀ envoyée en cuisine. |
| `reopen_held_order` | v1 | Réouverture sur le terminal. |
| `discard_held_order` | v1 | Rejet ; couvre aussi les commandes caisse non payées (`created_via = 'pos'`). |
| `transfer_order_table` | v1 | Changement de table, audité `order.table_transfer`. Call-site `useTransferOrderTable`. |
| `close_cancelled_tablet_order` | v1 | ADR-010 — **constate** une annulation tablette (refuse en P0014 hors du cas prévu). Sa migration `20260731000003` DROP `cancel_tablet_order`. |
| `mark_item_served` | (sans version) | KDS/tablette — marque l'item servi. Call-site `useMarkItemServed`. |

**Familles MORTES — ne jamais les ressusciter :**

| Famille disparue | Acte de décès |
|------------------|---------------|
| `hold_order` · `restore_held_order` | ADR-022 décision 4 — `20260810000004_adr022_d4_drop_cart_hold_path.sql`. La voie brouillon serveur (`HELD-<uuid>`, `is_held` sur un `draft` jamais envoyé) est supprimée : un panier non confirmé n'a pas à exister côté serveur. Le geste « mettre en attente » passe désormais par l'envoi en cuisine puis `hold_fired_order`. |
| `cancel_tablet_order` | ADR-010 — `20260731000003`, remplacée par `close_cancelled_tablet_order`. |

> `held_order_idempotency_keys` survit sans écrivain (résidu assumé par la migration de drop,
> ADR-021 déc. 2). Sa présence n'est pas une preuve que la voie brouillon existe encore.

### Lecture — liste, compteurs, recherche

**`get_orders_list`** — état 2026-08-31 : **v4**
(`20260813000008_bump_get_orders_list_v4_sort.sql`, call-site `useOrdersList`).

- Gate `orders.read`.
- Signature : `(p_start text, p_end text, p_filters jsonb, p_limit int, p_sort text, p_dir text, p_cursor_val text, p_cursor_id uuid)`.
- **Le curseur `TIMESTAMPTZ` de la v3 est droppé** : le keyset est désormais générique
  (valeur de tri transportée en TEXTE + `id` de départage). Un call-site qui passe encore un
  `p_cursor` timestamptz appelle une signature qui n'existe plus.
- `p_sort` / `p_dir` sont **blanc-listés** (mapping fermé injecté par `format()`, hors liste =
  rejet `22023`). Aucune entrée utilisateur ne touche le SQL.
- `p_limit` clampé (borne haute fixée dans le corps — la relever est un changement de contrat).
- Grammaire de filtres JSONB (héritée de la v2, intacte en v4) : `status`, `order_type`,
  `customer_id`, `served_by`, `total_min`, `total_max`, `customer_type`, `payment_method`,
  `terminal_id`, `hour` (0-23 `Asia/Makassar`), `refund_status` (`none|partial|full`).
  Une clé inconnue est **ignorée silencieusement** — un filtre mal orthographié ne lève rien.
- `terminal_id` passe par un JOIN `pos_sessions` → n'atteint que les commandes avec `session_id`.
- Sortie : `lines` + `next_cursor_val` + `next_cursor_id`. Champs calculés par ligne :
  `refund_status`, `has_modifiers`, `payment_method_primary` (ou `'mixed'`), `items_count`,
  `customer_name`, `customer_type`, `served_by_name`, `terminal_id`.

**`get_orders_counters`** — état 2026-08-31 : **v2** (ADR-025, call-site `useOrdersCounters`).
Agrège sur **la même grammaire de filtres** que la liste : tout filtre ajouté d'un côté doit
l'être de l'autre, sinon les compteurs mentent sur la liste affichée.

**`search_orders`** — état 2026-08-31 : **v1**
(`20260813000002_uxui_lot4_search_orders_v1.sql`, call-site `usePaletteSearch`).
Recherche d'entité pour la palette de commandes ; `(p_query, p_limit)`.

### Edit-items — seulement sur `draft` | `pending_payment`

| Famille | État 2026-08-31 | Signature relevée | Notes |
|---------|-----------------|-------------------|-------|
| `add_order_item` | v5 | `(p_order_id, p_product_id, p_qty, p_modifiers, p_idempotency_key)` | ADR-022 déc. 1 : garde de vendabilité complète (`_assert_product_sellable`) ; refuse les combos. |
| `update_order_item_qty` | v5 | `(p_order_item_id, p_qty, p_idempotency_key, p_auth_id?, p_waste_qty?, p_waste_reason?)` | ADR-010 : les 3 derniers arguments ne servent QUE la ligne verrouillée. `p_qty > 0` (sinon `remove`). |
| `remove_order_item` | v3 | `(p_order_item_id, p_idempotency_key)` | DELETE + recalc ; refus sur ligne verrouillée. |

- Gate commun : `orders.edit_open`. Statut hors `('draft','pending_payment')` → `P0002`.
- **Le prix se résout SERVEUR** (ADR-013 D15/M2 + ADR-020) : `add_order_item` appelle
  `_resolve_line_price` — le même résolveur que le money-path — pour `unit_price`,
  `modifiers_total` et `line_subtotal`. Le `price_adjustment` client est **ignoré**. Ne pas
  réintroduire une lecture directe de `products.retail_price` dans ces RPCs.
- Ligne verrouillée (`order_items.is_locked`, ADR-010) : `update_order_item_qty` exige un
  `p_auth_id` — un nonce `discount_authorizations` de scope `order_item_edit`, TTL court,
  consommé atomiquement, **un nonce par appel de RPC**. Il est minté par l'EF
  `verify-manager-pin` (call-site `mintEditAuthorization`), qui reçoit le PIN en en-tête.
- Les 3 appellent `_recalc_order_totals(order_id)` (helper interne, non callable directement).
- Idempotence via la table dédiée `order_edit_idempotency_keys` (`key UUID PK`, `action TEXT`,
  `order_id UUID`, `result JSONB`). Actions : `'add'`, `'update_qty'`, `'remove'`. La lecture
  de replay est faite **deux fois** dans `add` — avant et après le `SELECT … FOR UPDATE` sur
  la commande : c'est la garde de course, ne pas la « simplifier ».
- Orchestrateur BO `useEditOrderItems` : séquence `removes → updates → adds` pour éviter les
  conflits de totaux ; un UUID d'idempotence **par appel**, jamais partagé.

### Permissions

Codes existants dans le catalogue `permissions` (vérifié 2026-08-31) :

```
orders.read             — 20260616000010_seed_orders_read_perm.sql
orders.edit_open        — 20260618000021_seed_orders_edit_open_perm.sql
orders.void             — 20260618000021_seed_orders_edit_open_perm.sql
orders.refund           — 20260813000004_seed_orders_refund_reprint_perms.sql
orders.reprint_receipt  — 20260813000004_seed_orders_refund_reprint_perms.sql
```

> **Ne PAS graver « MANAGER / ADMIN / SUPER_ADMIN » comme la vérité des droits.** Depuis
> l'**ADR-031** (2026-08-25, `docs/adr/031-rbac-editable-super-admin.md`), la matrice
> `role_permissions` est **de la donnée éditable** depuis le back-office par un SUPER_ADMIN :
> les rôles cités dans les migrations de seed sont l'état **initial**, pas l'état courant.
> Pour savoir qui détient une permission aujourd'hui, on lit `role_permissions` (plus les
> `user_permission_overrides`), on ne cite pas un fichier de seed. Deux conséquences gravées
> par l'ADR : la ligne SUPER_ADMIN est immuable, et les permissions d'un utilisateur sont
> **figées au login** — un changement de matrice ne prend effet qu'à la session suivante.

---

## Critical patterns (ordres-spécifiques)

1. **Jamais d'INSERT direct dans `orders`** — toujours via RPC. Les RPCs gèrent atomiquement :
   JE triggers, loyalty, promotions, déduction de stock, `table_state`.
2. **Le POS n'appelle pas le money-path en direct** — il poste l'EF `process-payment`, qui
   appelle `complete_order_with_payment` côté serveur. Idem `refund-order`, `void-order`,
   `cancel-item`.
3. **Status guard sur edit-items** — `('draft', 'pending_payment')` uniquement, `P0002` sinon.
   Ne pas ajouter `'open'` (valeur inexistante dans l'enum).
4. **Prix de ligne = domaine/serveur, jamais recomposé** — côté SQL, `_resolve_line_price` ;
   côté TS, `lineTotalOf`/`lineUnitEach` de `packages/domain`. Recomposer
   `unit_price + price_adjustment` est le bug de sous-facturation des combos, ressuscité trois
   fois avant que la garde CI `line-total-formula` ne l'interdise.
5. **Idempotency keys propres par RPC** — ne pas partager une même `p_idempotency_key` entre
   deux appels distincts dans `useEditOrderItems`. Générer un UUID par call.
6. **Transport du PIN — deux véhicules, aucun n'est un défaut.** Vers une **Edge Function**,
   le PIN voyage en en-tête `x-manager-pin`, jamais dans le body JSON (les bodies sont loggés).
   Vers une **RPC Postgres**, un PIN se transporte en **argument** `p_manager_pin` : c'est le
   seul véhicule qu'une RPC peut valider, une fonction SQL ne lit pas d'en-tête HTTP. Dans le
   domaine ordres, aucune RPC live ne reçoit le PIN : les EF `refund-order`, `void-order`,
   `cancel-item` et `verify-manager-pin` le vérifient en amont et passent une **identité
   d'autorisation** (`p_authorized_by` / `p_acting_auth_user_id`) ou un **nonce**
   (`discount_authorizations`).
7. **Realtime StrictMode-safe** — `useOrdersRealtime` nomme son channel avec `useId()` ; jamais
   de nom statique (collisions silencieuses au double-mount).
8. **Déduction de stock de vente = `_record_sale_stock`, helper unique.** Pour un produit
   `is_display_item`, il décrémente `display_stock.quantity` **et** `products.current_stock`,
   et écrit dans `display_movements`. Pour un non-display suivi, `current_stock` seulement.
   La rupture de vitrine lève `P0002` (mappé `insufficient_stock` 409 par `process-payment`).
   Ne pas réécrire cette logique dans une RPC appelante.
9. **`orders.session_id` nullable — trois exemptions**, cf. la section schéma. Ne jamais
   resserrer à NOT NULL global.

---

## Audit checklist

- [ ] **Status transition valide** — seuls les états de l'enum réel sont utilisés. Grep `'open'` dans les nouvelles migrations ordres.
- [ ] **`order_type` vs `created_via`** — un filtre ou un guard « tablette » interroge `created_via`, jamais `order_type`.
- [ ] **Edit-items guard** — les 3 RPCs vérifient `status IN ('draft', 'pending_payment')`.
- [ ] **Prix serveur** — aucun nouveau chemin d'écriture d'`order_items` ne calcule un prix hors `_resolve_line_price` (SQL) / `lineTotalOf` (TS).
- [ ] **Totals cohérents** — après chaque edit-item, les totaux viennent de `_recalc_order_totals`, jamais d'un calcul dupliqué au call-site.
- [ ] **Idempotency replay** — même `p_idempotency_key` + même `action` retourne le `result` JSONB stocké sans mutation ; la double lecture autour du `FOR UPDATE` est préservée.
- [ ] **`order_edit_idempotency_keys` isolé** — aucune écriture hors des RPCs SECURITY DEFINER.
- [ ] **Refund integrity** — `SUM(refunds.total) <= orders.total` pour un même `order_id` ; le `refund_status` calculé par `get_orders_list` en découle.
- [ ] **Liste et compteurs d'accord** — un filtre ajouté à `get_orders_list` l'est aussi à `get_orders_counters`, sinon l'en-tête ment sur le tableau.
- [ ] **REVOKE pair complet** — chaque nouvelle RPC ordres a les 3 lignes (PUBLIC + anon + `ALTER DEFAULT PRIVILEGES`). Modèle : le bloc ACL de `20260810000002_adr022_d1_add_order_item_v5.sql`.
- [ ] **Types regen** — toute migration ordres touchant une signature déclenche `generate_typescript_types` → `packages/supabase/src/types.generated.ts`.

---

## Sources de vérité (pointeurs)

```
Migrations (jalons historiques — le vivant se relève par le numéro le plus haut)
  supabase/migrations/20260503000000_init_extensions_enums.sql          — enums order_status / order_type
  supabase/migrations/20260507000001_extend_orders_tablet.sql           — created_via ('pos'|'tablet')
  supabase/migrations/20260601000005_extend_order_type_enum_b2b.sql     — 'b2b' ajouté à order_type
  supabase/migrations/20260618000023_fix_edit_items_rpc_status_enum.sql — corrective 'open' → 'pending_payment'
  supabase/migrations/20260620000015_relax_orders_session_id_for_held.sql — 3ᵉ exemption session_id
  supabase/migrations/20260731000003_adr010_drop_cancel_tablet_order_add_close_cancelled_tablet_order_v1.sql
  supabase/migrations/20260810000004_adr022_d4_drop_cart_hold_path.sql  — drop de la voie brouillon
  supabase/migrations/20260813000002_uxui_lot4_search_orders_v1.sql     — recherche de commandes
  supabase/migrations/20260813000004_seed_orders_refund_reprint_perms.sql
  supabase/migrations/20260813000008_bump_get_orders_list_v4_sort.sql   — tri serveur + keyset générique

Tests pgTAP (vérité comportementale)
  supabase/tests/orders_read_perm.test.sql            — gate orders.read
  supabase/tests/orders_list_v4.test.sql              — filtres serveur
  supabase/tests/orders_list_v4_sort.test.sql         — tri blanc-listé
  supabase/tests/orders_list_v4_envelope.test.sql     — enveloppe + pagination keyset
  supabase/tests/orders_counters_v2.test.sql          — parité compteurs / liste
  supabase/tests/order_edit_items.test.sql            — édition d'items
  supabase/tests/order_item_lock_adr010.test.sql      — verrou cuisine + perte
  supabase/tests/held_orders.test.sql                 — famille held
  supabase/tests/hold_fired_order_v1.test.sql
  supabase/tests/reopen_held_order_v1.test.sql · reopen_held_order_v1_behavior.test.sql
  supabase/tests/adr010_close_cancelled_tablet_order.test.sql
  supabase/tests/complete_order_v27_table_guard.test.sql   — table obligatoire en dine-in
  supabase/tests/create_tablet_order_v8_waiter_identity.test.sql
  supabase/tests/search_orders_v1.test.sql
  supabase/tests/recalc_order_totals_mode_aware.test.sql · recalc_order_totals_pb1_inclusive.test.sql
  supabase/tests/realtime_publication_orders.test.sql

Intention & décisions
  docs/objectifs/ORDERS.md   — l'intention métier du module (ce qui est VOULU)
  docs/adr/009-cycle-de-vie-ordres.md
  docs/adr/010-verrou-items-envoyes-cuisine.md
  docs/adr/013-comptabilite-integrite-void-refund-remise.md
  docs/adr/022-portes-de-vente-pos-vendabilite-hold-envoi-cuisine.md
  docs/adr/025-liste-commandes-compteurs-et-bande-annonce.md
  docs/adr/031-rbac-editable-super-admin.md
```

---

## Verification before claiming complete

```bash
# Type & lint (cheap, run first)
pnpm typecheck

# pgTAP : via MCP execute_sql, enveloppe BEGIN … ROLLBACK (pas de runner local).
# Fichiers pertinents : cf. la liste « Tests pgTAP » ci-dessus.

# BO smoke — attention, les filtres vitest matchent le NOM DE FICHIER,
# pas le describe : localiser les fichiers par glob avant de filtrer.
pnpm --filter @breakery/app-backoffice test orders

# POS smoke
pnpm --filter @breakery/app-pos test order
```

Une part des échecs BO en local est **env-gated** (`VITE_SUPABASE_URL Required`) et n'est pas
une régression (`DEV-S25-2.A-02`). Le compte exact se relève en lançant la suite ; il ne se
grave pas ici, il changerait à chaque fichier de test ajouté.

---

## When to escalate

- Ajouter une valeur à `order_status` ou `order_type` → confirmer l'intention métier, `ADD VALUE` dans sa propre TX, puis re-vérifier **tous** les guards `status IN (…)` existants. Rappel : « tablette » n'est pas un `order_type`.
- Modifier la signature de `complete_order_with_payment` (ou de toute RPC money-path) → bump obligatoire depuis le **corps live** (`pg_get_functiondef`, jamais le fichier d'origine), `DROP` de l'ancienne version dans la même migration, **redéploiement de l'EF** qui l'appelle, puis vérification de tous les callers POS/BO.
- Relaxer ou resserrer `orders_session_id_required_for_pos` → les trois exemptions doivent être reportées ; en oublier une casse B2B, tablette ou held.
- Nouveau filtre de liste → l'ajouter **aussi** à `get_orders_counters`, et profiler si le filtre implique un JOIN sur une table sans index.
- Nouvelle valeur de `p_sort` → elle doit entrer dans la liste blanche **et** recevoir un cast de curseur cohérent, sinon la pagination keyset dérive.
- Changement du mécanisme PIN ou d'un scope de nonce → coordonner avec le skill `security-auth` (mécanique) ou `security-fraud-guard` (traçabilité / abus).
- Réintroduire une mise en attente de panier non envoyé → **contredit l'ADR-022 décision 4** : on le signale à Mamat, on ne l'implémente pas.
