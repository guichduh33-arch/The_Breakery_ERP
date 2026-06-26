# Session 47 — Configurable Combos (choice groups)

- **Date:** 2026-06-19
- **Branch:** `swarm/session-47-combos` (base `master`)
- **Status:** Design approved (brainstorming) — pending implementation plan
- **Source:** Owner screenshots `Screenshot 2026-06-19 1415{53,19,37,03}.jpg` (Combo Management list + Edit Combo builder)

## 1. Goal

Replace the current **fixed-bundle** combo model with **configurable combos** built from
**choice groups**, matching the screenshots. A combo carries named groups (e.g. Drinks,
Viennoiserie, Butter/Jam); each group is single- or multi-choice, required or optional, and
lists product options each with a per-option **surcharge** and an optional **default**. The
combo sells at `base_price + Σ chosen surcharges`.

Full scope: **back-office editor AND POS consumption**.

## 2. Decisions (locked during brainstorming)

1. **Scope** = BO editor + POS consumption (multi-wave).
2. **Model** = *replace* the fixed `combo_items` model with the choice-group model; **migrate
   the 4 existing combos** so they stay valid (COMBO-001 etc. depended on by seed/pgTAP).
3. **Sold combo** = **one order line** at combo price (base + chosen surcharges); each chosen
   component deducts its own stock/recipe behind the scenes.
4. **Group types** = **Single Choice + Multi Choice** (multi bounded by min/max per group),
   plus Required/Optional, per-option default, per-option surcharge.

## 3. Data model

A combo remains a `products` row with `product_type='combo'` (keeps it in the catalog, POS
grid, KDS routing, refund/void paths). The virtual combo product has no stock of its own.

### 3.1 New combo metadata columns on `products` (nullable, combo-only)
- `combo_base_price NUMERIC(12,2)` — base price before surcharges.
- `combo_available_from TIME NULL`, `combo_available_to TIME NULL` — daypart window
  (NULL/NULL = all-day).
- `combo_show_in_pos BOOLEAN NOT NULL DEFAULT true` — distinct from `is_active`.

Existing columns reused: `name`, `description`, `image_url`, `display_order` (or equivalent
sort column — verify actual name during plan), `is_active`, `deleted_at`.

### 3.2 New tables

```
combo_groups
  id                  UUID PK
  combo_product_id    UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE
  name                TEXT NOT NULL
  group_type          TEXT NOT NULL CHECK (group_type IN ('single','multi'))
  is_required         BOOLEAN NOT NULL DEFAULT false
  min_select          INT NOT NULL DEFAULT 0  CHECK (min_select >= 0)
  max_select          INT NOT NULL DEFAULT 1  CHECK (max_select >= 1)
  sort_order          INT NOT NULL DEFAULT 0
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
  CHECK (min_select <= max_select)
  -- single  ⇒ enforced max_select = 1 (and min_select ∈ {0,1})
  -- required ⇒ min_select >= 1

combo_group_options
  id                    UUID PK
  group_id              UUID NOT NULL REFERENCES combo_groups(id) ON DELETE CASCADE
  component_product_id  UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT
  surcharge             NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (surcharge >= 0)
  is_default            BOOLEAN NOT NULL DEFAULT false
  sort_order            INT NOT NULL DEFAULT 0
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
  UNIQUE (group_id, component_product_id)
```

### 3.3 Guards (triggers / RPC validations)
- Parent-type guard: a group's `combo_product_id` must be a `product_type='combo'` product.
- Anti-nesting: a `component_product_id` cannot itself be a combo (no nested combos), mirroring
  the existing `enforce_combo_parent_type` trigger on `combo_items`.
- `single` group ⇒ `max_select = 1`.
- `is_required` ⇒ `min_select >= 1` (single-required ⇒ exactly 1).
- A `single`-required group SHOULD have exactly one `is_default` option (validated at write).

### 3.4 RLS / grants
- Both tables: `ENABLE ROW LEVEL SECURITY`, `auth_read` SELECT policy (`is_authenticated()`),
  no direct write policy — all writes via SECURITY DEFINER RPC. Anon defense-in-depth per the
  project-wide `REVOKE ALL FROM anon` + `ALTER DEFAULT PRIVILEGES` convention.

### 3.5 Drop `combo_items`
After the migration backfills groups/options, `combo_items` and its trigger are dropped in the
same migration block. POS `useComboItems` and BO `useCombos` are rewritten to the new shape.

## 4. Pricing

- **Configured price** = `combo_base_price + Σ surcharge(chosen options)`.
- **Min price preview** = `base + Σ_groups (min surcharge the group can contribute)`:
  - required single ⇒ min surcharge among options (default's surcharge in practice);
  - optional single / any multi ⇒ 0 (can pick none / cheapest).
- **Max price preview** = `base + Σ_groups (max allowable surcharge)`:
  - single ⇒ most expensive option;
  - multi ⇒ sum of the `max_select` most expensive options.
- **Value Price** (struck-through anchor on the card) = `Σ component.retail_price` of the
  default selection. Savings % = `(value − base) / value` when positive; hidden otherwise.
- All money rounded via the existing `round_idr` helper on the server.

## 5. Write path (back-office)

### 5.1 `upsert_combo_v1(p_combo jsonb, p_idempotency_key uuid)` — SECURITY DEFINER
- Gate: new permission `products.combos.write` (seed MANAGER/ADMIN/SUPER_ADMIN).
- One transaction: upsert the combo `products` row (allowlisted columns: name, description,
  image_url, sort/display order, combo_base_price, combo_available_from/to, combo_show_in_pos,
  is_active; `product_type` forced to `'combo'`; SKU generated/validated), then **REPLACE**
  semantics for groups + options (delete-then-insert within the tx, like `set_product_units_v1`).
- Validates §3.3 guards and §4 invariants; raises P0001 with explicit messages.
- Audit `combo.upserted`. Canonical REVOKE-from-PUBLIC/anon pair. Idempotency: dedicated
  keys table (flavor 2) OR replay-on-product (decide in plan; prefer dedicated table).

### 5.2 `delete_combo_v1(p_combo_product_id uuid)` — soft delete
- Gate `products.combos.write`. Sets `is_active=false` + `deleted_at=now()` (mirrors
  `delete_product_v1` S45 semantics). Idempotent replay. Audit `combo.deleted`.

## 6. POS consumption + order persistence

### 6.1 ComboConfigModal (POS)
- Opens when a `product_type='combo'` product is tapped (replaces the current direct-add /
  "Modifiers not supported on combos" path in `ProductTapHandler`).
- One section per group, ordered by `sort_order`: single = radio list, multi = checkboxes
  bounded by `min_select`/`max_select`. Pre-selects `is_default` options. Live price summary
  (`base + Σ surcharge`). Confirm disabled until every required/min constraint is satisfied.
- On confirm, the combo becomes **one cart line** carrying the chosen options.

### 6.2 Cart line shape
The configured combo line stores, alongside the existing cart fields, the chosen options as a
`modifiers` snapshot **and** a `combo_components` list (component product_ids + qty) for stock
deduction. `unit_price` = `combo_base_price`; surcharges ride as `modifiers[].price_adjustment`
so the existing `line_total` math (`(unit_price + Σ price_adjustment) * qty`) already yields the
combo price.

### 6.3 Sale RPC bump `complete_order_with_payment_v12 → v13` (and `pay_existing_order` / `fire_counter_order` as needed)
Approach **A** (approved): reuse the `modifiers` JSONB; add combo-aware stock handling.
- For a `product_type='combo'` line:
  - **Skip** the stock check + `current_stock`/display-stock deduction on the (virtual) combo
    product itself.
  - **Instead**, for each chosen component (from the item payload's `combo_components`), do the
    stock check + `stock_movements 'sale' -qty` + `current_stock` decrement (display-stock
    aware), exactly as the per-product path does today.
  - `unit_price` is **not** reconciled via `get_customer_product_price` for combos (the combo
    has its own base price); server re-derives `combo_base_price` from the combo product and
    validates the client's surcharges against `combo_group_options` (anti-tamper, mirroring the
    S37 SEC-02 price reconciliation philosophy).
  - `order_items` row: `product_id` = combo, `name_snapshot` = combo name, `modifiers` = chosen
    options snapshot, plus a new snapshot column (e.g. `combo_components JSONB`) recording the
    deducted components for audit/refund symmetry.
- DROP the prior version in the same migration (monotonic versioning). Regen types + bump the
  `process-payment` EF / POS `useCheckout` payload to forward `combo_components`.
- Refund/void (`refund_order_rpc`, `void_order_rpc`, `cancel_order_item_rpc`) must restore the
  **component** stock for combo lines — verify and bump as needed (Wave A scope).

> Alternative B (expand to component order_items) was rejected: it splits the combo price across
> lines and complicates the "one line at combo price" receipt + refunds + KDS.

## 7. Migration of the 4 existing combos

For each existing combo product, convert its `combo_items` rows into the new model:
- Create one **single, required** `combo_group` per existing component (name = component
  category or product name), each with one option = that component, `surcharge=0`,
  `is_default=true`. (Quantity > 1 components: keep as a default option with a `quantity`
  note — verify the 4 combos' actual data in the plan; the seed combos are simple.)
- Seed `combo_base_price` from the combo product's current `retail_price`.
- Result: COMBO-001 et al. remain `product_type='combo'` products with valid groups, so
  recipe/pgTAP fixtures referencing those SKUs keep working.

## 8. Back-office UI (mirrors screenshots)

### 8.1 Combo Management list (`/backoffice/products/combos`)
- Existing `CombosPage` rewired: header "Create New Combo" → navigates to the builder; 3 KPI
  tiles (Total / Active / Inactive); searchable card grid. Cards show groups by **name** with
  option pills + `+N more`, struck-through Value Price, bundle **min→max** price range, Save %
  badge. (The current read-only card already approximates this; update to the new shape.)

### 8.2 Combo builder (Create/Edit) — new route `/backoffice/products/combos/new` + `/:comboId/edit`
- **General Information**: Combo Name*, Description, Base Price (IDR)*, Display Order, Image URL,
  Available From/To, Active toggle, Show in POS toggle.
- **Price Preview**: live Minimum / Maximum price (§4).
- **Choice Groups**: "Add Group"; each group card has Name, Type (Single/Multi `<select>`),
  Required toggle, min/max (multi), and a Products list — "Add Product" picker (raw product
  search), per-row Surcharge input + Set Default / Default badge + remove. Group delete.
- Footer: Cancel / Save (Create) | Update Combo. Wired to `upsert_combo_v1`.
- `@breakery/ui` has no `Select`/`RadioGroup` exports — use native `<select>` / button-group
  fallbacks per the project UI-kit conventions.

## 9. Permissions
- New `products.combos.write` (MANAGER/ADMIN/SUPER_ADMIN). Read uses existing catalog read /
  `auth_read`. Add code to the `PermissionCode` union; regen types.

## 10. Testing
- **pgTAP**: `combo_crud` (upsert/delete RPC happy + gate + guard/invariant violations +
  REVOKE), `combo_sale` (v13: combo line deducts components not the combo, surcharge tamper
  reject, display-stock aware), migration backfill assertions, refund/void component restore.
- **BO smoke**: builder create/edit/remove-group/set-default, list KPIs, price preview math.
- **POS smoke**: ComboConfigModal min/max enforcement + default preselect + price summary;
  cart payload carries `combo_components`.
- **Domain unit**: pure price-preview (min/max/value/savings) + validation helpers (IO-free).
- Regen types after every schema change; typecheck 6/6.

## 11. Rollout (waves)
- **Wave A — DB**: schema + guards + migration/backfill + `upsert_combo_v1` + `delete_combo_v1`
  + sale RPC v13 (+ refund/void/fire/pay-existing as needed) + drop `combo_items` + pgTAP +
  types regen.
- **Wave B — BO**: list rewire + builder page + hooks + smokes.
- **Wave C — POS**: ComboConfigModal + cart/payload wiring + checkout EF/hook bump + smokes.
- **Wave D — tests/closeout**: domain helpers, full sweeps, INDEX + CLAUDE.md bump.

## 12. Out of scope (defer)
- Quantity-per-option in groups (e.g. "2× croissant" as one option) — single/multi only.
- Nested combos.
- Combo-level promotions / loyalty multiplier overrides (combo total flows through existing
  promo/loyalty paths unchanged).
- Drag-reorder of combos on the list (grip handle stays decorative for now).
- Tablet-ordering combo configuration (POS only this session).
```
