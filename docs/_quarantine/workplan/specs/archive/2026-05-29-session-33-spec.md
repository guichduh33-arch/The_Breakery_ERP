# Session 33 — Orders v2 : server-side filters + realtime + void + edit-items (Spec)

> **Date** : 2026-05-29
> **Branche cible** : `swarm/session-33`
> **Base** : `master` @ `4aa61df` (post-merge S32 PR #40 + S32-docs PR #42 + S27c follow-up menu reorg PR #41)
> **Effort estimé** : ~3-4 jours wall-time (L)
> **Status** : draft pour ratification user (avant Wave 0 spec commit)
> **Predecessor** : [`./2026-05-26-session-32-spec.md`](./2026-05-26-session-32-spec.md) — S33 ferme les 4 trous post-S32 sur la page `/backoffice/orders` : filtres server-side (`refund_status`, `hour`, `terminal_id`), realtime updates, void actions, edit items (open orders only).

---

## 1. Contexte

S32 a livré la page `/backoffice/orders` audit-grade avec 10 axes de filtres dont 2 post-fetch client-side (`refund_status`, `hour`) + 1 axe droppé (`terminal_id` — DEV-S32-1.A-01 : col absente schema). La page est aussi read-only — pas d'actions admin, pas de realtime.

Le user a clarifié l'intention métier (2026-05-29) :

> « le module Order du backoffice ne sert qu'à observer et contrôler live les Order du POS »

Donc S33 ferme la boucle UX **observe → filter → control** :
1. **Observer** : realtime updates (orders apparaissent au fil de l'eau dès qu'un POS les crée)
2. **Filtrer** : 3 nouveaux filtres serveur-side (refund_status, hour, terminal_id) — promus de post-fetch V1 → server-side V2
3. **Contrôler** : 2 actions admin par row — Void (any status) + Edit items (open status seulement)

Le bouton "+ New Order" mentionné en backlog S32 INDEX §12 #8 est **explicitement out-of-scope** — les créations d'orders depuis BO appartiennent au module B2B (déjà livré S24). Le module Orders BO reste read-only en termes de création.

**Hors scope S33** (renvoyé S34+ ou backlog) :
- Edit customer / notes / table assignment sur open orders (V1 items uniquement)
- Edit sur completed orders (utiliser refund + new order pattern)
- Refund actions depuis BO (RPC existe S25 — UI wiring trivial, peut être bundle S34)
- Mobile responsive OrdersListPage
- Backfill `pos_sessions.terminal_id` historique
- Promotion `pos_sessions.terminal_id` → NOT NULL
- Concurrent edit conflict detection (row version)
- Realtime merge in-place (au lieu d'invalidate refetch)
- CF account drill (DEV-S32-1.D-01 — toujours déféré)
- UnifiedReportFilters extra dims
- Compare toggle S30 reports
- Hub mini-KPI + favorites
- 6 Soon cards restantes

---

## 2. Architecture (choix structurants)

**Choix 1 — Bump RPC `get_orders_list_v1 → v2`** (DROP v1 + CREATE v2 même migration, pas additive). Le filter `terminal_id` requiert un JOIN `pos_sessions` dans la WHERE clause → sémantique change. CLAUDE.md "RPC versioning monotonic" appliqué.

**Choix 2 — `pos_sessions.terminal_id UUID NULL REFERENCES lan_devices(id)`** (col ajoutée, NULL pour historique). Backfill : laissé NULL (pas de "terminal par défaut" rétroactif). Hook POS `useOpenPosSession` bumpé v1→v2 pour accepter `terminalId?: string` au moment du shift open. Form POS `OpenShiftForm` étend avec un selector terminal (combobox `lan_devices` filter device_type='pos'). Capturé au open session = inhérent à la nature "1 cashier sur 1 shift sur 1 terminal physique".

**Choix 3 — Realtime via Supabase `postgres_changes` channel** sur `public.orders` (events INSERT + UPDATE). Channel name unique par mount `orders-list-${useId()}` (StrictMode-safe per CLAUDE.md critical pattern). Sur event reçu → `queryClient.invalidateQueries(['orders', 'list'])` (re-fetch). Pas de merge in-place V1 (simple, OK pour <500 orders/jour ; à promouvoir merge S34+ si scaling).

**Choix 4 — Void from BO** réutilise EF `void-order` (S25 hardened — body→header PIN) + RPC `void_order_rpc`. Pas de nouvelle RPC ni EF. Hook `useVoidOrder` créé ou déplacé depuis POS si existant.

**Choix 5 — Edit items via 3 RPCs atomiques** (au lieu d'1 batch RPC complexe) :
- `add_order_item_v1(p_order_id, p_product_id, p_qty, p_modifiers JSONB, p_idempotency_key UUID)`
- `update_order_item_qty_v1(p_order_item_id, p_qty INT, p_idempotency_key UUID)`
- `remove_order_item_v1(p_order_item_id, p_idempotency_key UUID)`

Chacune : SECURITY DEFINER + `SET search_path = public, pg_temp` + gate `orders.edit_open` (nouvelle perm) + status check `WHERE o.status IN ('draft','open')` + recalc `orders.{subtotal,tax_amount,total}` via helper interne `_recalc_order_totals(p_order_id)` + idempotency RPC arg (flavor 2 S25, table dédiée `order_edit_idempotency_keys`) + audit_log + REVOKE pair canonique S25.

**Choix 6 — Pas d'orchestration "batch edit" SQL**. Le modal BO accumule les changements en local state `OrderEditDiff`, puis "Apply" appelle les RPCs séquentiellement (removes → updates → adds) avec progress bar. Plus chatty mais plus auditable et chaque ligne audit_log = 1 action unitaire. Erreur partielle : abort, toast, garde les changes restants. Pas de rollback cross-RPC (chaque RPC est atomique DB-side).

**Choix 7 — Permission `orders.edit_open` nouvelle** (seedée MANAGER+/ADMIN+/SUPER_ADMIN). Distincte de `orders.read` (S31) car mutation. Distincte de `orders.void` (couverte par RPC void). Si `orders.void` perm n'existe pas, on l'ajoute aussi dans la même migration seed.

**Choix 8 — Edit modal layout 2-colonnes** (60/40) : ProductPicker à gauche (search + grid) + cart preview live à droite (lines existants en qty stepper + lines nouveaux badge "new"). Bouton "Apply changes" en bas, disabled si diff empty. Reuse `ProductPicker` BO si existe, sinon Combobox simple.

**Choix 9 — Tax rate live pour open orders** : `_recalc_order_totals` utilise `current_pb1_rate()` (S26 helper). C'est OK car le snapshot tax_rate ne se fait qu'à `complete_order_v9` (pattern existant). NON-PKP confirmé S26 ADR-003 → `current_pb1_rate()` retourne 0 et `tax_amount=0` toujours. Acceptable.

---

## 3. DB changes (Wave 1)

### 3.1 — Schema bump

| # | Migration | Action |
|---|---|---|
| `_010` | `add_terminal_id_to_pos_sessions` | `ALTER TABLE pos_sessions ADD COLUMN terminal_id UUID NULL REFERENCES lan_devices(id)` + `CREATE INDEX idx_pos_sessions_terminal_open ON pos_sessions(terminal_id) WHERE status='open'` |

### 3.2 — RPC bumps

| # | Migration | Object |
|---|---|---|
| `_011` | `bump_open_pos_session_v2_capture_terminal` | DROP v1 + CREATE v2 avec `p_terminal_id UUID DEFAULT NULL`. Backward-compat default NULL. |
| `_012` | `revoke_anon_open_pos_session_v2` | REVOKE pair S25 |
| `_013` | `bump_get_orders_list_v2_server_filters` | DROP v1 + CREATE v2 avec JOIN `pos_sessions` ; `p_filters` JSONB nouveau clés : `terminal_id` (UUID), `refund_status` (`none\|partial\|full`), `hour` (INT 0-23, `EXTRACT(HOUR FROM o.created_at AT TIME ZONE 'Asia/Makassar') = (p_filters->>'hour')::int`). |
| `_014` | `revoke_anon_get_orders_list_v2` | REVOKE pair S25 |

### 3.3 — Edit items RPCs + helper

| # | Migration | Object |
|---|---|---|
| `_015` | `create_recalc_order_totals_helper` | `_recalc_order_totals(p_order_id UUID)` LANGUAGE plpgsql SECURITY DEFINER. Computes `subtotal = SUM(order_items.line_total)`, `tax_amount = subtotal * current_pb1_rate()`, `total = subtotal + tax_amount`. UPDATE orders SET ces 3 + `updated_at=now()`. REVOKE EXECUTE FROM authenticated + anon + PUBLIC (helper interne, S28 pattern). |
| `_016` | `create_order_edit_idempotency_keys_table` | `CREATE TABLE order_edit_idempotency_keys (key UUID PRIMARY KEY, action TEXT NOT NULL, order_id UUID NOT NULL, result JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())` + RLS REVOKE all from anon/authenticated + GRANT SELECT to authenticated. |
| `_017` | `create_add_order_item_v1_rpc` | SECURITY DEFINER + gate `orders.edit_open` + status check + INSERT order_items + appel `_recalc_order_totals` + audit_log + idempotency replay via `order_edit_idempotency_keys` |
| `_018` | `revoke_anon_add_order_item_v1` | REVOKE pair S25 |
| `_019` | `create_update_order_item_qty_v1_rpc` | SECURITY DEFINER + gate + status check (sur l'order parent) + UPDATE order_items + recalc + audit_log + idempotency |
| `_020` | `revoke_anon_update_order_item_qty_v1` | REVOKE pair S25 |
| `_021` | `create_remove_order_item_v1_rpc` | SECURITY DEFINER + gate + status check + DELETE order_items + recalc + audit_log + idempotency |
| `_022` | `revoke_anon_remove_order_item_v1` | REVOKE pair S25 |

### 3.4 — Permission seed

| # | Migration | Action |
|---|---|---|
| `_023` | `seed_orders_edit_open_perm` | INSERT permissions `'orders.edit_open'` + INSERT role_permissions pour MANAGER, ADMIN, SUPER_ADMIN. Si `'orders.void'` n'existe pas, l'ajouter dans la même migration. |

### 3.5 — Realtime publication (conditionnel)

Check Wave 1.A : `SELECT * FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='orders'`. **Si déjà publié** : pas de migration `_024`. **Sinon** : `_024` `ALTER PUBLICATION supabase_realtime ADD TABLE public.orders`.

### Block total estimé : **14-15 migrations** (14 obligatoires `_010..023` + 1 conditionnelle realtime `_024` + correctives possibles).

### 3.6 — Types regen

Post-Wave 1 via MCP `generate_typescript_types` → écrit `packages/supabase/src/types.generated.ts`. Touche :
- `Database['public']['Tables']['pos_sessions']['Row']` ajoute `terminal_id: string | null`
- `Database['public']['Tables']['order_edit_idempotency_keys']` nouvelle
- `Database['public']['Functions']['get_orders_list_v2']`, `open_pos_session_v2`, `add_order_item_v1`, `update_order_item_qty_v1`, `remove_order_item_v1`

---

## 4. BO hooks + Types (Wave 2)

### 4.1 — Hooks BO créés / bumpés

| Hook | Type | Path | Notes |
|---|---|---|---|
| `useOrdersList` | **bump v1→v2** | `apps/backoffice/src/features/orders/hooks/useOrdersList.ts` | RPC body `_v1` → `_v2`. `OrdersListFilters` étendu avec `refund_status?`, `hour?`, `terminal_id?`. |
| `useOrdersRealtime` | **NEW** | `apps/backoffice/src/features/orders/hooks/useOrdersRealtime.ts` | Channel name `orders-list-${useId()}`. INSERT+UPDATE events. Cleanup on unmount. Returns `{isConnected}`. |
| `useVoidOrder` | **NEW BO** | `apps/backoffice/src/features/orders/hooks/useVoidOrder.ts` | EF `void-order` POST. Headers `x-manager-pin`, `x-idempotency-key`. Body `{order_id, reason}`. |
| `useAddOrderItem` | **NEW** | `apps/backoffice/src/features/orders/hooks/useAddOrderItem.ts` | RPC call. Idempotency key own `useRef`. |
| `useUpdateOrderItemQty` | **NEW** | idem | |
| `useRemoveOrderItem` | **NEW** | idem | |
| `useEditOrderItems` | **NEW orchestrateur** | `apps/backoffice/src/features/orders/hooks/useEditOrderItems.ts` | Compose les 3 above. Export `mutateApplyDiff(diff: OrderEditDiff)` séquence removes→updates→adds. |
| `useLanDevices` | **NEW** | `apps/backoffice/src/features/devices/hooks/useLanDevices.ts` | SELECT lan_devices WHERE device_type='pos' AND is_active=true AND deleted_at IS NULL. 24h cache. |

### 4.2 — Hooks POS bumpés

| Hook | Type | Path | Notes |
|---|---|---|---|
| `useOpenPosSession` | **bump v1→v2** | `apps/pos/src/features/shifts/hooks/useOpenPosSession.ts` | Accepts `terminalId?: string`. Default NULL. |

### 4.3 — TS interfaces

`apps/backoffice/src/features/orders/types.ts` (étendu) :

```ts
export interface OrdersListFilters {
  // existing S32 V1
  status?: string;
  order_type?: string;
  customer_id?: string;
  served_by?: string;
  total_min?: number;
  total_max?: number;
  customer_type?: 'retail' | 'b2b';
  payment_method?: string;
  // NEW S33 V2
  refund_status?: 'none' | 'partial' | 'full';
  hour?: number;             // 0-23
  terminal_id?: string;      // UUID lan_devices.id
}

export interface OrderEditDiff {
  removes: string[];                                          // order_item_ids
  updates: Array<{ order_item_id: string; qty: number }>;
  adds:    Array<{ product_id: string; qty: number; modifiers?: unknown }>;
}
```

### 4.4 — Permission codes

`packages/domain/src/auth/permissions.ts` (ou équivalent) : ajouter `'orders.edit_open'` au union `PermissionCode`. Si `'orders.void'` absent, l'ajouter aussi.

---

## 5. UI changes (Wave 3)

### 5.1 — OrdersListPage extensions

**Filters bar** (Row 2 ou Row 3 advanced) — 3 nouveaux champs :

| Filter | Composant | Source |
|---|---|---|
| Refund status | `<Select>` `[Any \| None \| Partial \| Full]` | static |
| Hour | `<Select>` `[Any \| 00:00..23:00]` | static |
| Terminal | `<Combobox>` filtrable | `useLanDevices()` |

URL state : `?refund_status=`, `?hour=`, `?terminal_id=`. ActiveFilterChips affiche les 3 avec labels lisibles.

**Row actions column** (NEW, colonne 11 "Actions" à droite) :
- Icon `Edit3` → ouvre `<EditOrderItemsModal>` (visible si `status IN ('draft','open')` AND `orders.edit_open`)
- Icon `XCircle` → ouvre `<VoidOrderModal>` (visible si `status IN ('open','completed')` AND `orders.void`)

**Realtime indicator** : `<Badge>` "● Live" (green) ou "○ Offline" si channel déco. En haut à droite de la page.

### 5.2 — `<VoidOrderModal>` (NEW)

`apps/backoffice/src/features/orders/components/VoidOrderModal.tsx`

```
┌─ Title "Void order #ORD-12345"
├─ Warning banner "This action cannot be undone. Inventory will be restored."
├─ Textarea (required, min 10 chars) "Reason for voiding"
├─ PIN input (6 digits, NumpadPin) "Manager PIN"
└─ Footer  [Cancel]   [Void order]
```

Hook : `useVoidOrder().mutate({orderId, reason, pin})`. Idempotency key own `useRef(crypto.randomUUID())` reset à dismiss.

### 5.3 — `<EditOrderItemsModal>` (NEW)

`apps/backoffice/src/features/orders/components/EditOrderItemsModal.tsx`

```
┌─ Title "Edit order #ORD-12345" + status badge "Open"
├─ 2-cols (60/40)
│   Left: ProductPicker (search + grid + cat filter)
│   Right: Cart preview live (lines + qty steppers + remove + totals box)
└─ Footer "X changes pending"  [Cancel]  [Apply changes]
```

UX flow :
1. Edit visuel accumule `diff: OrderEditDiff` local state.
2. "Apply" → `useEditOrderItems().mutateApplyDiff(diff)` séquence removes→updates→adds avec progress bar.
3. Erreur partielle : abort, toast, conserve changes restants.

### 5.4 — Realtime channel souscription

OrdersListPage mount → `useOrdersRealtime()` retourne `{isConnected}`. Sur event → `queryClient.invalidateQueries(['orders','list'])`. UI : indicator visible.

### 5.5 — POS OpenShiftForm bump

`apps/pos/src/features/shifts/components/OpenShiftForm.tsx` :
- Nouveau champ "Terminal (optional)" en haut
- `<Combobox>` rendu par `useLanDevices()`
- Default "(no terminal selected)" → POS hook v2 envoie `terminalId: null`
- Pre-select via `localStorage` key `pos:last_terminal_id` au prochain open

### 5.6 — Permission gates

- `<PermissionGate required="orders.edit_open">` autour de l'icon Edit
- `<PermissionGate required="orders.void">` autour de l'icon Void

---

## 6. Test plan (Wave 4)

### 6.1 — Count target

| Suite | Compte | Path |
|---|---|---|
| pgTAP `orders_list_v2` (cloud MCP) | ~10 | `supabase/tests/orders_list_v2.test.sql` |
| pgTAP `order_edit_items` (add 5 + update 4 + remove 3) | ~12 | `supabase/tests/order_edit_items.test.sql` |
| pgTAP `pos_session_terminal_v2` | ~3 | `supabase/tests/pos_session_terminal.test.sql` |
| BO unit `useOrdersList` v2 wiring | ~3 | existing extended |
| BO unit `useEditOrderItems` diff orchestration | ~3 | NEW |
| BO unit `useOrdersRealtime` channel sub | ~2 | NEW |
| BO smoke `OrdersListPage` 3 filters URL→state | ~3 | existing extended |
| BO smoke `OrdersListPage` row actions perm gate | ~2 | NEW |
| BO smoke `VoidOrderModal` reason+PIN | ~3 | NEW |
| BO smoke `EditOrderItemsModal` apply sequence | ~4 | NEW |
| BO smoke realtime indicator | ~2 | NEW |
| POS smoke `OpenShiftForm` terminal selector | ~2 | NEW |
| Non-regression S31/S32 (drilldown + filter) | ~6 | existing |
| `pnpm typecheck` (6 packages) | 6/6 | turbo |
| **Total** | **~57 tests** | |

### 6.2 — pgTAP cases détaillés

**`get_orders_list_v2`** (T1-T10) :
- T1 perm gate CASHIER → 42501
- T2 filter `refund_status='partial'` server-side → only partial
- T3 filter `refund_status='full'` → only full
- T4 filter `hour=14` (Asia/Makassar) → only created_at hour=14
- T5 filter `terminal_id=<uuid>` → JOIN pos_sessions WHERE ps.terminal_id=
- T6 combo filters refund_status + hour + payment_method
- T7 cursor pagination préservée
- T8 terminal_id NULL filter → seuls les orders avec session.terminal_id IS NULL
- T9 output shape inchangée vs V1 (no new computed cols required)
- T10 filter inconnu silently ignored

**`order_edit_items`** (T1-T12) :
- T1-T5 `add_order_item_v1` : happy path / perm CASHIER 42501 / status=completed P0002 / idempotency replay / recalc totals
- T6-T9 `update_order_item_qty_v1` : happy / qty=0 P0002 (use remove) / status=voided P0002 / recalc
- T10-T12 `remove_order_item_v1` : happy / not found P0002 / recalc

**`pos_session_terminal_v2`** (T1-T3) :
- T1 open session with terminal_id → pos_sessions row has terminal_id set
- T2 open session without → NULL
- T3 unknown terminal_id (not in lan_devices) → 23503 FK violation

---

## 7. Permissions

| Permission | Action | Roles |
|---|---|---|
| `orders.edit_open` | NEW seeded `_023` | MANAGER, ADMIN, SUPER_ADMIN |
| `orders.void` | NEW seeded `_023` si absent (vérifier S25/S13) | MANAGER, ADMIN, SUPER_ADMIN |
| `orders.read` | reuse (S31) | reuse |

---

## 8. Migrations applied

Block `20260618000010..024` (14-15 migrations, dont 1 conditionnelle) :

| # | Object | Type |
|---|---|---|
| `_010` | `pos_sessions` | ALTER ADD terminal_id |
| `_011` | `open_pos_session_v2` | bump RPC (DROP v1 + CREATE v2) |
| `_012` | REVOKE pair `_v2` | S25 canonical |
| `_013` | `get_orders_list_v2` | bump RPC (DROP v1 + CREATE v2 + JOIN pos_sessions) |
| `_014` | REVOKE pair `_v2` | S25 canonical |
| `_015` | `_recalc_order_totals` | helper interne |
| `_016` | `order_edit_idempotency_keys` | CREATE table |
| `_017` | `add_order_item_v1` | CREATE RPC |
| `_018` | REVOKE pair | |
| `_019` | `update_order_item_qty_v1` | CREATE RPC |
| `_020` | REVOKE pair | |
| `_021` | `remove_order_item_v1` | CREATE RPC |
| `_022` | REVOKE pair | |
| `_023` | seed perms `orders.edit_open` (+`orders.void` si absent) | |
| `_024` (cond.) | `ALTER PUBLICATION supabase_realtime ADD TABLE orders` | si pas déjà publié |

---

## 9. Risks & deviations to anticipate

| ID | Risk | Mitigation |
|---|---|---|
| R-S33-1 | `lan_devices` peut être vide de rows `device_type='pos'` | Wave 0 : seed 2-3 rows demo si table vide. Sinon doc « configurer via BO `/settings/lan-devices` ». |
| R-S33-2 | `orders` publication realtime peut être absente | `_024` conditionnel après check SQL |
| R-S33-3 | `useOpenPosSession` v1→v2 : POS code existant doit absorber `terminalId?` optional | Default NULL, backward-compatible |
| R-S33-4 | Edit modal recalc client preview peut diverger DB | Toujours "Preview" + trust DB recalc post-apply (refetch order) |
| R-S33-5 | Sequence removes→updates→adds échec partiel | Toast + garde changes restants. Pas de rollback cross-RPC |
| R-S33-6 | `current_pb1_rate()` = 0 (NON-PKP S26) → tax_amount toujours 0 | Acceptable per ADR-003 |
| R-S33-7 | Concurrent edit BO + POS sur même open order | Last-write-wins V1. Risque faible. Surveiller S34+ |
| R-S33-8 | Realtime events cumul under load | Re-fetch invalidate OK pour <500/jour. Merge in-place S34+ |
| R-S33-9 | `orders.void` permission peut déjà exister depuis S13/S25 | Vérifier avant seed `_023` |

---

## 10. Acceptance criteria

- [ ] **Wave 1** : 14-15 migrations apply OK cloud V3 dev + types regen committée
- [ ] pgTAP `orders_list_v2` 10/10 PASS via cloud MCP
- [ ] pgTAP `order_edit_items` 12/12 PASS
- [ ] pgTAP `pos_session_terminal_v2` 3/3 PASS
- [ ] **Wave 2** : 8 hooks BO + 1 hook POS bumpés/créés + `OrderEditDiff` interface + `'orders.edit_open'` ajouté à `PermissionCode`
- [ ] BO unit 8/8 PASS (useOrdersList v2 + useEditOrderItems + useOrdersRealtime)
- [ ] **Wave 3** : OrdersListPage filters bar étendu + 2 modals créés + realtime indicator + POS OpenShiftForm bumped
- [ ] BO smoke 14/14 PASS
- [ ] POS smoke 2/2 PASS
- [ ] Non-régression S31/S32 smoke sweep ~6/6 PASS
- [ ] `pnpm typecheck` 6/6 PASS
- [ ] INDEX `2026-05-29-session-33-INDEX.md` créé + CLAUDE.md Active Workplan bumpé

---

## 11. Out of scope (S34+ candidates)

1. Edit customer / notes / table assignment sur open orders (V1 items uniquement)
2. Edit sur completed orders (refund + new order pattern)
3. Refund actions depuis BO (RPC existe S25, UI wiring trivial → bundle S34 possible)
4. Mobile responsive OrdersListPage
5. Backfill `pos_sessions.terminal_id` historique
6. Promotion `pos_sessions.terminal_id` → NOT NULL
7. Concurrent edit conflict detection (row version)
8. Realtime merge in-place (au lieu d'invalidate refetch)
9. CF account drill (DEV-S32-1.D-01 — toujours déféré)
10. UnifiedReportFilters extra dims (toujours déféré)
11. Compare toggle S30 reports (toujours déféré)
12. Hub mini-KPI + favorites (toujours déféré)
13. 6 Soon cards restantes (toujours déféré)

---

## 12. Files touched (preview)

### DB + tests (NEW)
- `supabase/migrations/20260618000010_add_terminal_id_to_pos_sessions.sql`
- `supabase/migrations/20260618000011_bump_open_pos_session_v2_capture_terminal.sql`
- `supabase/migrations/20260618000012_revoke_anon_open_pos_session_v2.sql`
- `supabase/migrations/20260618000013_bump_get_orders_list_v2_server_filters.sql`
- `supabase/migrations/20260618000014_revoke_anon_get_orders_list_v2.sql`
- `supabase/migrations/20260618000015_create_recalc_order_totals_helper.sql`
- `supabase/migrations/20260618000016_create_order_edit_idempotency_keys_table.sql`
- `supabase/migrations/20260618000017_create_add_order_item_v1_rpc.sql`
- `supabase/migrations/20260618000018_revoke_anon_add_order_item_v1.sql`
- `supabase/migrations/20260618000019_create_update_order_item_qty_v1_rpc.sql`
- `supabase/migrations/20260618000020_revoke_anon_update_order_item_qty_v1.sql`
- `supabase/migrations/20260618000021_create_remove_order_item_v1_rpc.sql`
- `supabase/migrations/20260618000022_revoke_anon_remove_order_item_v1.sql`
- `supabase/migrations/20260618000023_seed_orders_edit_open_perm.sql`
- `supabase/migrations/20260618000024_alter_publication_supabase_realtime_orders.sql` (conditionnel)
- `supabase/tests/orders_list_v2.test.sql`
- `supabase/tests/order_edit_items.test.sql`
- `supabase/tests/pos_session_terminal.test.sql`

### BO hooks (NEW + bumps)
- `apps/backoffice/src/features/orders/hooks/useOrdersList.ts` (bump v2)
- `apps/backoffice/src/features/orders/hooks/useOrdersRealtime.ts` (NEW)
- `apps/backoffice/src/features/orders/hooks/useVoidOrder.ts` (NEW)
- `apps/backoffice/src/features/orders/hooks/useAddOrderItem.ts` (NEW)
- `apps/backoffice/src/features/orders/hooks/useUpdateOrderItemQty.ts` (NEW)
- `apps/backoffice/src/features/orders/hooks/useRemoveOrderItem.ts` (NEW)
- `apps/backoffice/src/features/orders/hooks/useEditOrderItems.ts` (NEW orchestrator)
- `apps/backoffice/src/features/devices/hooks/useLanDevices.ts` (NEW)
- `apps/backoffice/src/features/orders/types.ts` (extended interfaces)

### BO UI (NEW + extends)
- `apps/backoffice/src/features/orders/components/VoidOrderModal.tsx` (NEW)
- `apps/backoffice/src/features/orders/components/EditOrderItemsModal.tsx` (NEW)
- `apps/backoffice/src/features/orders/components/OrdersFiltersBar.tsx` (extended)
- `apps/backoffice/src/features/orders/components/ActiveFilterChips.tsx` (extended)
- `apps/backoffice/src/features/orders/components/OrdersTable.tsx` (extended row actions col)
- `apps/backoffice/src/pages/orders/OrdersListPage.tsx` (extended realtime + modals mount)

### POS UI (bumps)
- `apps/pos/src/features/shifts/hooks/useOpenPosSession.ts` (bump v2)
- `apps/pos/src/features/shifts/components/OpenShiftForm.tsx` (extended terminal selector)

### Types + permissions
- `packages/supabase/src/types.generated.ts` (regen post Wave 1)
- `packages/domain/src/auth/permissions.ts` (extends PermissionCode union)

### Workplan
- `docs/workplan/specs/2026-05-29-session-33-spec.md` (this file)
- `docs/workplan/plans/2026-05-29-session-33-plan.md` (next step via writing-plans skill)
- `docs/workplan/plans/2026-05-29-session-33-INDEX.md` (created at session close)
