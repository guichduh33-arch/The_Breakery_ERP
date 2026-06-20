# Central Units Registry + Recipe Unit Picker Fix + Modifier Cost Display

Date: 2026-06-20
Status: approved (owner delegated execution through PR)
Branch: `feat/units-registry-and-modifier-cost`

## Problem

Three linked issues surfaced while wiring per-modifier product costing:

1. **Recipe costs computed ×1000 / 0** — `convert_quantity(qty, from, to)` only does an
   **exact pair** lookup in `unit_conversions` and does **not** chain. Migration `_018`
   added `gr↔kg` but not `g↔kg`, so a recipe line in `g` against a material based in `kg`
   (e.g. Capuccino: 18 g coffee, coffee based in kg) raises `unit_conversion_missing`.
   `_calculate_recipe_cost_walk` swallows the error and falls back to the **raw quantity**
   → cost 1000× too high → flagged implausible → `products.cost_price` left at 0.

2. **Recipe ingredient unit picker offers the wrong units** — `RecipeEditor` uses a
   hardcoded `UNIT_OPTIONS = ['g','kg','mg','mL','L','pcs']`, which (a) contains
   non-canonical tokens (`g`, `mL`, `L` instead of the project's `gr`, `ml`, `lt`) and
   (b) ignores the selected material's actually-registered units. Users pick `g` on a
   `kg`-based material → issue #1.

3. **Product cost with modifiers** — the COGS of a drink varies with the chosen modifier
   (Oat vs Fresh milk), but nothing valued the modifier ingredients. (Implemented this
   session: `modifierOptionMaterialCost` domain helper + `ModifierCostBreakdown` in the
   Costing tab + per-option cost in the modifiers editor.)

## Root model (owner-confirmed)

- **Dimensional units** with *constant universal* conversions: mass (`mg`/`g`/`gr`/`kg`),
  volume (`ml`/`lt`/`l`). `g` and `gr` are the same gram. → belong in a **central registry**.
- **Supplier containers** (`bag` 25 kg, `can` 800 gr, `can` 2.5 kg, `pack`, `roll`, `set`,
  `plate`, `cup`/`Cup`) whose base factor **depends on the product** (can 800 gr ≠ can 2.5 kg).
  → stay **per-product** in `product_unit_alternatives` + `product_unit_contexts.purchase_unit`
  (already handled by the S46 PO form). The registry only lists their names/dimension.
- Recipes never use containers (owner: only eggs are cross-dimension; finished goods sold in
  cup/piece are not converted). So all recipe conversions are purely dimensional.

## Design

### DB

1. **`units` registry table** (single source of truth for dimensional conversion):
   - `code TEXT PRIMARY KEY` (canonical spelling, e.g. `gr`, `kg`, `ml`, `lt`, `pcs`),
   - `label TEXT NOT NULL`,
   - `dimension TEXT NOT NULL CHECK (dimension IN ('mass','volume','count','container'))`,
   - `factor_to_canonical NUMERIC(20,10)` — to the dimension's canonical base
     (mass → **gram**, volume → **ml**); `NULL` for `count`/`container` (no global factor),
   - `is_active BOOLEAN NOT NULL DEFAULT true`, `sort_order INT NOT NULL DEFAULT 0`.
   - RLS-read for authenticated; writes via service/migration only.
   - Seed every code currently in use (mass: mg/g/gr/kg; volume: ml/mL/l/lt/L; count: pcs/piece;
     container: bag/Bag/can/pack/PACK/roll/ROLL/set/plate/cup/Cup). `g`,`gr` → factor 1 (gram);
     `kg` → 1000; `mg` → 0.001. `ml`,`mL`,`l` → 1; `lt`,`L` → 1000.

2. **Rewrite `convert_quantity(qty, from, to)`** (keep signature, `STABLE`):
   1. `from = to` → `qty`.
   2. **legacy exact pair** in `unit_conversions` → `qty × factor` (preserves every currently
      working conversion → zero regression).
   3. else if both codes are in `units`, same `dimension`, both have `factor_to_canonical`
      → `qty × (factor_from / factor_to)`. (Fixes g↔kg, g↔gr, ml↔lt, … universally.)
   4. else `RAISE unit_conversion_missing` (unchanged contract).

3. **`list_units_v1()`** read RPC → active units (code, label, dimension, factor_to_canonical),
   ordered. Canonical S25 REVOKE pair.

4. **Recompute** recipe costs (`recompute_all_recipe_costs_v1()`) so g-based recipes resolve.

### Frontend

5. **`useUnits()`** hook (reads `list_units_v1`).
6. **`RecipeEditor`** Unit dropdown: replace `UNIT_OPTIONS` with the units whose `dimension`
   matches the selected material's base-unit dimension (from the registry), defaulting to the
   material's base unit. Removes the wrong `g`/`mL`/`L` tokens.

### Modifier cost display (done this session)

- `packages/domain/src/modifiers/cost.ts`: `modifierIngredientLineCost`,
  `modifierOptionMaterialCost` (mirror `_resolve_modifier_ingredients_v1`: qty × factor × cost).
- `OptionIngredientPicker`: per-line + per-option material cost.
- `CostingPanel` → `ModifierCostBreakdown`: total cost per option = base `cost_price` +
  option material cost. Hidden when no cost-variable modifier group exists.
- All price displays show whole rupiah (no decimals).

## Out of scope / follow-ups

- PO form already lists per-product container units (S46) — unchanged.
- Catalog-import unit validation against the registry; product `UnitsPanel` sourcing from the
  registry; a per-product container-factor editor UI.
- Refactoring `_resolve_modifier_ingredients_v1` / `receive_purchase_order_v2` to read the
  registry — they correctly use per-product factors today.
- Money-path margin (selling price − cost) per modifier.

## Tests

- pgTAP: `units` seeded; `convert_quantity` g→kg/gr→kg/g→gr/ml→lt correct; legacy pair preserved;
  same-dimension derivation; cross-dimension raises; `list_units_v1` shape + REVOKE.
- Domain: `cost.test.ts` (done, 8/8).
- Smoke: `ModifierCostBreakdown`, `OptionIngredientPicker` cost, RecipeEditor unit dropdown.
