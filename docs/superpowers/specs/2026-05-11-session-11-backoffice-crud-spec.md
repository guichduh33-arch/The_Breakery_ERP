# The Breakery — Session 11 Spec : Backoffice CRUD étendu + tablet split-pay v5

> **Date** : 2026-05-11
> **Auteur** : guichduh33@gmail.com (suite session 10)
> **Statut** : Approuvé pour implémentation autonome
> **Cible** : 8 admin CRUD pages dans `apps/backoffice` couvrant les entités catalogue / RH / pricing, plus 2 nouvelles tables (`suppliers`, `discount_templates`) et l'extension `pay_existing_order` v5 pour le split-payment côté tablette.

---

## 0. Contexte

Sessions 1–10 ont livré le pipeline POS complet (auth, shift, cart, modifiers, customers, loyalty, tables, tablet, discounts, customer-categories, combos, perf-debt, promotions, split-pay + void/refund). La seule UI admin existante est `/backoffice/products` (read-only) + `/backoffice/promotions` (full CRUD livré session 9).

Cette session ferme la boucle "admin" pour rendre le SaaS gérable sans accès direct DB :

- Products : CRUD complet (création produit, édition prix/stock, soft-delete, toggle is_active/is_favorite)
- Categories : CRUD (slug, color, dispatch_station, sort order)
- Customers : CRUD (nom, phone, email, customer_type, loyalty seed)
- Customer categories : CRUD (price_modifier_type, discount_percentage, points_multiplier, is_default)
- Restaurant tables : CRUD (table_number, capacity, status)
- Combos : CRUD (combo header en `products` + lignes `combo_items`)
- Discount templates : CRUD (NEW table — presets pour les discounts session 6)
- Suppliers : CRUD (NEW table — préliminaire pour session 12 inventory)

Le split-pay tablette (`pay_existing_order` v5) ferme le gap noté en session 10 § Roadmap.

Cette session **ne touche pas** :
- Inventory module (`stock_movements` admin / receiving, supplier orders) — session 12
- Reports (sales / promo effectiveness / employee perf) — session 14
- Auth user CRUD (créer un caissier) — session 14 ou 15
- Product images upload (Storage bucket) — défère
- Combo modifiers (composer cumulant des modifiers) — défère
- Hub-printing — session 15

---

## 1. Décisions actées

| # | Décision | Choix |
|---|---|---|
| **C1** | Page list pattern | `<EntityName>Page` dans `apps/backoffice/src/pages/`, suit le template `Promotions.tsx` (filters bar + table + create/edit modal + delete confirm) |
| **C2** | Feature folder | `apps/backoffice/src/features/{entity}/{components,hooks}/` — 1 hook par mutation (create/update/delete), 1 list hook, 3 components (FormModal, ListRow, DeleteConfirm) |
| **C3** | Form lib | React state + Zod inline (no react-hook-form) — cohérent avec session 9 PromotionForm |
| **C4** | RBAC | Lecture par `module.read`, écriture par `module.create/update/delete` (codes selon module). Seedés sur MANAGER+ADMIN+SUPER_ADMIN (delete réservé ADMIN+ pour entités sensibles : customers, suppliers, discount_templates) |
| **C5** | Soft delete | `deleted_at TIMESTAMPTZ` colonne (déjà présente sur la plupart des entités). UPDATE-set au delete plutôt que DELETE physique |
| **C6** | Sidebar | `BackofficeLayout` ajoute 8 nouvelles entrées de menu groupées : "Catalog" (products, categories, combos, discount templates), "Customers" (customers, customer categories), "Operations" (tables, suppliers) |
| **C7** | List filters | Selon entité : status (active/inactive), search box (nom/SKU/phone selon contexte), date range pour created_at |
| **C8** | New tables | `suppliers` : id, name, code (UNIQUE), contact_phone, contact_email, address, payment_terms_days, is_active, deleted_at, audit. `discount_templates` : id, name, type (percentage/fixed_amount), value DECIMAL, requires_pin BOOL, threshold_pct, is_active, deleted_at |
| **C9** | RPC v5 split-pay tablette | `pay_existing_order` v4 → v5 : ajoute `p_payments JSONB` array (mêmes règles que `complete_order_with_payment` v8). p_payment legacy reste accepté → iso v4 si seul. Tablet UI utilise `payments[]` quand le cashier ajoute >1 tender |
| **C10** | Sessions 5-7 RLS audit | Vérifier que les policies UPDATE sur products/categories/customers/etc. acceptent les perms `*.update`. Si non : ajouter via une migration RLS-extend |

---

## 2. Stack additions

| Addition | Raison |
|---|---|
| Aucun nouveau package | Tout via Supabase JS + react-query + Zod existants |
| 8 nouvelles routes `/backoffice/*` | Inscrites dans `apps/backoffice/src/routes/index.tsx` avec `PermissionGate` |
| 24+ hooks (list + 3 mutations × 8 entités) | TanStack Query mutations standardisées |
| 24+ composants (Form/Row/DeleteConfirm × 8) | Mêmes patterns visuels que `Promotions*` |

---

## 3. Schéma DB — additions

### 3.1 Migrations à créer

```
20260513000001_init_suppliers.sql                          # NEW table + RLS + perms
20260513000002_init_discount_templates.sql                 # NEW table + RLS + perms
20260513000003_extend_pay_existing_order_rpc_v5.sql        # Split-pay support (mirror v8)
20260513000004_seed_backoffice_crud_perms.sql              # seed ALL new module perms (catalog, customers, tables, etc.) + has_permission v5
20260513000005_extend_rls_for_module_perms.sql             # ensure UPDATE policies on all entities accept the new perms
```

### 3.2 suppliers

```sql
CREATE TABLE suppliers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code            TEXT NOT NULL UNIQUE,                     -- e.g. 'SUP-001'
  name            TEXT NOT NULL,
  contact_phone   TEXT,
  contact_email   TEXT,
  address         TEXT,
  payment_terms_days INTEGER NOT NULL DEFAULT 30 CHECK (payment_terms_days >= 0),
  notes           TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);

CREATE INDEX idx_suppliers_active ON suppliers(name) WHERE is_active = true AND deleted_at IS NULL;
CREATE TRIGGER suppliers_set_updated_at BEFORE UPDATE ON suppliers FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read"   ON suppliers FOR SELECT USING (is_authenticated() AND deleted_at IS NULL);
CREATE POLICY "perm_create" ON suppliers FOR INSERT WITH CHECK (has_permission(auth.uid(), 'suppliers.create'));
CREATE POLICY "perm_update" ON suppliers FOR UPDATE USING (has_permission(auth.uid(), 'suppliers.update'));
```

### 3.3 discount_templates

```sql
CREATE TYPE discount_template_type AS ENUM ('percentage', 'fixed_amount');

CREATE TABLE discount_templates (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                   TEXT NOT NULL,
  type                   discount_template_type NOT NULL,
  value                  DECIMAL(14,2) NOT NULL CHECK (value > 0),
  /** When true, applying this preset always requires manager PIN regardless of threshold. */
  requires_pin           BOOLEAN NOT NULL DEFAULT false,
  /** Cashier-only threshold (e.g. 5%) above which PIN is required. NULL means use requires_pin. */
  cashier_max_percentage DECIMAL(5,2) CHECK (cashier_max_percentage IS NULL OR (cashier_max_percentage >= 0 AND cashier_max_percentage <= 100)),
  is_active              BOOLEAN NOT NULL DEFAULT true,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at             TIMESTAMPTZ,
  CONSTRAINT chk_value_consistency CHECK (
    (type = 'percentage' AND value > 0 AND value <= 100)
    OR (type = 'fixed_amount' AND value > 0)
  )
);

CREATE INDEX idx_discount_templates_active ON discount_templates(name) WHERE is_active = true AND deleted_at IS NULL;
CREATE TRIGGER discount_templates_set_updated_at BEFORE UPDATE ON discount_templates FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE discount_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read"   ON discount_templates FOR SELECT USING (is_authenticated() AND deleted_at IS NULL);
CREATE POLICY "perm_create" ON discount_templates FOR INSERT WITH CHECK (has_permission(auth.uid(), 'discount_templates.create'));
CREATE POLICY "perm_update" ON discount_templates FOR UPDATE USING (has_permission(auth.uid(), 'discount_templates.update'));
```

### 3.4 Permissions à seeder (has_permission v5)

| Module | Perms (read/create/update/delete) | Roles |
|---|---|---|
| products | products.{read,create,update,delete} | MANAGER+ADMIN+SUPER_ADMIN — delete ADMIN+ |
| categories | categories.{read,create,update,delete} | idem |
| customers | customers.{read,create,update,delete} | MANAGER+ for read+create+update ; ADMIN+ for delete |
| customer_categories | customer_categories.{read,create,update,delete} | ADMIN+ (sensitive — affects pricing) |
| restaurant_tables | tables.{read,create,update,delete} | MANAGER+ |
| combos | combos.{read,create,update,delete} | MANAGER+ |
| discount_templates | discount_templates.{read,create,update,delete} | ADMIN+ for write (sensitive) |
| suppliers | suppliers.{read,create,update,delete} | MANAGER+ for read+create+update ; ADMIN+ for delete |

`products.read` already exists (session 1). Others new. Ship via single seed migration + has_permission v5 update.

### 3.5 RLS extend pour les UPDATE/INSERT

Audit toutes les tables touchées par les CRUDs (products, categories, customers, customer_categories, restaurant_tables, products [combo flag], combo_items). Pour chacune, vérifier qu'il existe des policies `INSERT`/`UPDATE` qui acceptent les perms ci-dessus. Si manquant :

```sql
DROP POLICY IF EXISTS "perm_create" ON {table};
CREATE POLICY "perm_create" ON {table} FOR INSERT WITH CHECK (has_permission(auth.uid(), '{module}.create'));
DROP POLICY IF EXISTS "perm_update" ON {table};
CREATE POLICY "perm_update" ON {table} FOR UPDATE USING (has_permission(auth.uid(), '{module}.update'));
```

### 3.6 RPC v5 pay_existing_order

Mêmes règles que `complete_order_with_payment` v8 (session 10 §3.5) :
- Param `p_payments JSONB DEFAULT NULL` ajouté
- Validation : 1..5 tenders, sum(amounts) = order.total, last-cash-only-overpay
- Insert N rows in `order_payments` au lieu d'1
- Iso v4 quand seul `p_payment` fourni

---

## 4. Frontend — additions

### 4.1 Routes (`apps/backoffice/src/routes/index.tsx`)

Remplacer les 8 `ComingSoonPage` du group "Catalog/Customers/Operations" par les vraies pages :

```tsx
<Route path="categories"           element={<PermissionGate required="categories.read"><CategoriesPage /></PermissionGate>} />
<Route path="combos"               element={<PermissionGate required="combos.read"><CombosPage /></PermissionGate>} />
<Route path="discount-templates"   element={<PermissionGate required="discount_templates.read"><DiscountTemplatesPage /></PermissionGate>} />
<Route path="customers"            element={<PermissionGate required="customers.read"><CustomersPage /></PermissionGate>} />
<Route path="customer-categories"  element={<PermissionGate required="customer_categories.read"><CustomerCategoriesPage /></PermissionGate>} />
<Route path="tables"               element={<PermissionGate required="tables.read"><TablesPage /></PermissionGate>} />
<Route path="suppliers"            element={<PermissionGate required="suppliers.read"><SuppliersPage /></PermissionGate>} />
```

Et étendre `Products` page avec `<PermissionGate required="products.read">` + écriture conditionnelle sur `products.create/update/delete`.

### 4.2 Sidebar (`apps/backoffice/src/layouts/BackofficeLayout.tsx`)

Ajouter section "Catalog" (4 items), "Customers" (2 items), "Operations" (2 items). Conserver l'icône Lucide pour chaque (Tag, Boxes, Tag, Users, Layers, Coffee, Truck, etc.).

### 4.3 Pattern feature folder

Pour chaque entité X :

```
apps/backoffice/src/features/{x}/
├── components/
│   ├── {X}FormModal.tsx          # Create/edit form in a FullScreenModal
│   ├── {X}ListRow.tsx            # Single table row
│   └── {X}DeleteConfirm.tsx      # Soft-delete confirmation modal
├── hooks/
│   ├── use{X}List.ts             # Filtered list query
│   ├── useCreate{X}.ts
│   ├── useUpdate{X}.ts
│   └── useDelete{X}.ts           # Soft-delete (UPDATE deleted_at)
```

apps/backoffice/src/pages/{X}.tsx — uses the above.

### 4.4 Tablet split-pay

`apps/pos/src/features/payment/hooks/useCheckout.ts` — quand `pickedUpOrderId` est set ET `payment` est un array de longueur > 1 :
- AVANT (session 10) : throws `split_pay_not_supported_on_tablet_pickup_v1`
- APRÈS (session 11) : passe `p_payments` à RPC v5

L'UI tablet (PaymentTerminal) déjà adaptée session 10 pour split-pay accepte les pickups via la même flow, donc juste retirer le throw + passer p_payments dans args.

---

## 5. Tests

| Layer | Cas |
|---|---|
| pgTAP | suppliers RLS : cashier read denied ; manager INSERT/UPDATE OK ; SUPER_ADMIN soft-delete OK |
| pgTAP | discount_templates RLS : analoge ; CHECK constraint type=percentage value≤100 |
| pgTAP | pay_existing_order v5 iso-v4 quand p_payments NULL ; multi-tender insert N rows ; cap check identique v4 |
| Vitest backoffice | Chaque page : list query render + filter changes + form modal create + edit + delete |
| Vitest backoffice smoke `products-crud.smoke.test.tsx` | Login MANAGER → /backoffice/products → create new product → edit → soft-delete → list reflects |
| Vitest backoffice smoke `customer-crud.smoke.test.tsx` | idem avec attach customer category |
| Vitest backoffice smoke `combo-crud.smoke.test.tsx` | Create combo header + add 3 components → save → DB inserts both products + combo_items rows |
| Vitest pos smoke `tablet-split-pay.smoke.test.tsx` | Pickup order → terminal → 2 tenders → checkout → DB has 2 order_payments rows |

---

## 6. Critères d'acceptation session 11

- [ ] Migrations 20260513000001-5 passent (`supabase db reset` clean)
- [ ] `pnpm lint` 0 warning, `pnpm typecheck` 0 erreur
- [ ] `pnpm test` ≥ 620 tests pass (≥ 30 nouveaux session 11)
- [ ] **Backoffice — 8 pages en ligne** : products (CRUD complet), categories, customers, customer-categories, restaurant-tables, combos, discount-templates, suppliers — chaque page : list + create + edit + soft-delete fonctionnels via UI
- [ ] **Backoffice RBAC** : login CASHIER → tente d'accéder /backoffice/customers → redirect /backoffice (sans menu visible). Login MANAGER → menu visible + accès. Login SUPER_ADMIN → boutons delete visibles
- [ ] **Backoffice products create** : crée nouveau produit (SKU, name, price, category, type) → apparaît dans `/backoffice/products` ET dans `/pos` après reload
- [ ] **Backoffice combo create** : create combo header (product_type='combo') + add 3 components → DB `products` row + 3 `combo_items` rows → POS displays combo correctly
- [ ] **Tablet split-pay** : pickup order → PaymentTerminal → 60k cash + 40k card → Process → DB `order_payments` 2 rows summing to 100k ; orders.status='paid' ; receipt OK
- [ ] **Discount template seed** : crée template "Senior 10%" (type=percentage, value=10, requires_pin=false) → POS DiscountModal peut sélectionner ce preset (out of scope v1 — défère wire-up to UI)

> Note: wire-up de discount templates dans la POS DiscountModal (preset picker) est OUT OF SCOPE session 11. La page admin existe et stocke les templates ; la consommation côté POS est session 11b ou plus tard.

---

## 7. Risques et garde-fous

| Risque | Mitigation |
|---|---|
| **Permissions matrix divergent EF vs DB** : session 8 §10.1 a déjà flagué le risque. Les nouveaux perms doivent être ajoutés dans 2 endroits : `supabase/functions/_shared/permissions.ts` (EF auth) ET `has_permission()` PL/pgSQL (DB RLS) | Ship has_permission v5 + permissions.ts v3 dans la même session. Ajouter un test smoke `permissions-consistency.smoke.test.ts` |
| **Combo CRUD nested write** : create combo nécessite INSERT products header puis INSERT N combo_items en transaction | Pas de RPC dédiée v1 — utiliser 2 mutations chainées (côté hook), ou un RPC `create_combo_with_items(p_header JSONB, p_items JSONB[])`. Décision : RPC pour atomicité |
| **Soft-delete en cascade** : delete category référencée par produits → policy nous laisse mais les products référent dangling | UI : disable delete button + tooltip si SELECT count(products WHERE category_id = X) > 0. Server : pas de FK CASCADE, donc safe (RESTRICT par défaut côté schema) |
| **Permission gate flicker** : `useAuthStore.hasPermission` peut renvoyer false avant chargement → redirect avant l'auth complete | Acceptable — rare. Auth flow se résout en <500ms |
| **Tablet split-pay régression** : ajouter le multi-tender path à `pay_existing_order` ne doit pas casser le single-tender path existant | RPC v5 garde `p_payment` legacy ; smoke test single-tender (existant `pay-existing.smoke.test.tsx`) doit passer sans modif |

---

## 8. Roadmap session 12+ (mise à jour)

| Session | Module | Statut |
|---|---|---|
| 12 | Customer display (deuxième écran) + QR scan loyalty + recipes/BOM tracking + Inventory module (suppliers wired in receiving) | Inchangé |
| 13 | B2B customers + credit + invoicing | Inchangé |
| 14 | Reports v1 (sales by day/week, void/refund analytics, top products, employee performance) + auth user CRUD | Inchangé |
| 15 | Settings (business_config CRUD, tax rate, hours, holidays) + idle PIN re-prompt + hub-printing (incl refund receipt + discount template wiring in POS DiscountModal) | Inchangé |
| 16+ | Coupons / promo codes nominatifs, multi-tier promotions, A/B tests, cross-shift admin refund override | Inchangé |
