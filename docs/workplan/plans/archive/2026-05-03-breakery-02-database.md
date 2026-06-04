# Phase 2 — Database (Supabase migrations + RPC + seed)

> **Trace historique** : ce fichier documente une session de travail datée. Le contenu de fond reste l'enregistrement de cette date. Seules les références de chemin ont été alignées sur la nouvelle structure documentaire (voir [`docs/README.md`](../../README.md)).
> **Last refreshed** : 2026-05-13

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Initialiser Supabase en local, créer les 9 migrations SQL, le RPC central `complete_order_with_payment`, et le seed démo. À la fin, `supabase db reset` doit appliquer tout sans erreur et créer un état utilisable par les apps.

**Spec source:** `docs/workplan/specs/2026-05-03-breakery-split-2apps-design.md` sections 6, 7.

**Dépend de :** Phase 1.

**À la fin :**
- `supabase start` démarre la stack locale
- `supabase db reset` applique 9 migrations + seed
- 14 tables créées avec RLS activée
- 8 produits / 4 catégories / 2 utilisateurs (admin PIN 1234, cashier PIN 5678) seedés
- RPC `complete_order_with_payment` fonctionnel et testé manuellement

---

## Task 2.1 — Init Supabase CLI

- [ ] **Step 1: Vérifier Supabase CLI installé**

```bash
supabase --version
```

Expected: ≥ 2.0.0. Sinon installer via https://supabase.com/docs/guides/cli/getting-started.

- [ ] **Step 2: Init Supabase dans le repo**

```bash
supabase init
```

Expected: crée `supabase/config.toml`, `supabase/.gitignore`, `supabase/seed.sql` (vide).

- [ ] **Step 3: Ajuster `supabase/config.toml`**

Ouvrir le fichier, vérifier :
- `[db]` `port = 54322`
- `[api]` `port = 54321`
- `[studio]` `port = 54323`
- `[auth]` `enable_signup = false` (on n'utilise pas signup public, tout passe par PIN)

- [ ] **Step 4: Démarrer Supabase**

```bash
supabase start
```

Expected: Docker pull les images, démarre Postgres + Auth + Storage + Studio. Termine en ~30s avec un récap des URLs et clés. **Noter** `anon key` et `service_role key`.

- [ ] **Step 5: Mettre à jour `.env`**

Copier les clés du step 4 dans `.env` (créer si pas existe à partir de `.env.example`) :

```bash
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=<anon_key_from_step_4>
SUPABASE_SERVICE_ROLE_KEY=<service_role_key_from_step_4>
SUPABASE_JWT_SECRET=<jwt_secret_from_step_4>
```

- [ ] **Step 6: Commit config Supabase (pas le seed encore)**

```bash
git add supabase/config.toml supabase/.gitignore
git commit -m "chore(db): init supabase CLI"
```

---

## Task 2.2 — Migration 1 : extensions + enums

**Files:**
- Create: `supabase/migrations/20260503000000_init_extensions_enums.sql`

- [ ] **Step 1: Créer le fichier de migration**

```sql
-- 20260503000000_init_extensions_enums.sql
-- Phase 2 / migration 1 : extensions + types enum
-- Spec: docs/workplan/specs/2026-05-03-breakery-split-2apps-design.md#6-schéma-db

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;       -- pour EXCLUDE constraint sur pos_sessions

-- Timezone DB Asia/Makassar (WITA, UTC+8)
ALTER DATABASE postgres SET timezone TO 'Asia/Makassar';

-- ENUMS
CREATE TYPE shift_status   AS ENUM ('open', 'closed');
CREATE TYPE order_type     AS ENUM ('dine_in', 'take_out', 'delivery');
CREATE TYPE order_status   AS ENUM ('draft', 'paid', 'voided');
CREATE TYPE payment_method AS ENUM ('cash', 'card', 'qris', 'edc', 'transfer', 'store_credit');
CREATE TYPE movement_type  AS ENUM ('sale', 'sale_void', 'production', 'purchase', 'waste', 'adjustment');

COMMENT ON TYPE shift_status   IS 'Statut d''une session de caisse';
COMMENT ON TYPE order_type     IS 'Type de commande POS';
COMMENT ON TYPE order_status   IS 'Statut d''une commande';
COMMENT ON TYPE payment_method IS 'Méthode de paiement (CASH, CARD, etc.)';
COMMENT ON TYPE movement_type  IS 'Type de mouvement de stock';
```

- [ ] **Step 2: Appliquer**

```bash
supabase db reset
```

Expected: la migration s'applique. Vérifier dans Studio (http://127.0.0.1:54323) > Database > Types : les 5 enums sont listés.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260503000000_init_extensions_enums.sql
git commit -m "feat(db): add init_extensions_enums migration"
```

---

## Task 2.3 — Migration 2 : auth (roles, permissions, user_profiles, user_sessions)

**Files:**
- Create: `supabase/migrations/20260503000001_init_auth.sql`

- [ ] **Step 1: Créer le fichier**

```sql
-- 20260503000001_init_auth.sql
-- Phase 2 / migration 2 : tables auth & users

-- ROLES (catalogue)
CREATE TABLE roles (
  code        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  is_system   BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- PERMISSIONS (catalogue)
CREATE TABLE permissions (
  code        TEXT PRIMARY KEY,
  module      TEXT NOT NULL,
  action      TEXT NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- USER PROFILES (identité applicative)
CREATE TABLE user_profiles (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id           UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  employee_code          TEXT UNIQUE NOT NULL,
  full_name              TEXT NOT NULL,
  pin_hash               TEXT NOT NULL,
  role_code              TEXT NOT NULL REFERENCES roles(code),
  is_active              BOOLEAN NOT NULL DEFAULT true,
  failed_login_attempts  INTEGER NOT NULL DEFAULT 0,
  locked_until           TIMESTAMPTZ,
  last_login_at          TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at             TIMESTAMPTZ
);

CREATE INDEX idx_user_profiles_auth_user ON user_profiles(auth_user_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_user_profiles_active ON user_profiles(is_active, deleted_at);

-- USER SESSIONS (custom session token, hashé par trigger)
CREATE TABLE user_sessions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES user_profiles(id),
  session_token_hash   TEXT NOT NULL UNIQUE,
  device_type          TEXT NOT NULL,
  ip_address           INET,
  user_agent           TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_activity_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at             TIMESTAMPTZ,
  end_reason           TEXT
);

CREATE INDEX idx_user_sessions_active ON user_sessions(session_token_hash) WHERE ended_at IS NULL;
CREATE INDEX idx_user_sessions_user ON user_sessions(user_id, ended_at);

-- updated_at trigger
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE TRIGGER user_profiles_set_updated_at
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE roles          IS 'Catalogue des rôles (SUPER_ADMIN, ADMIN, MANAGER, CASHIER)';
COMMENT ON TABLE permissions    IS 'Catalogue des permissions (module.action)';
COMMENT ON TABLE user_profiles  IS 'Identité applicative + PIN bcrypt';
COMMENT ON TABLE user_sessions  IS 'Sessions actives (token SHA-256)';
```

- [ ] **Step 2: Appliquer**

```bash
supabase db reset
```

Expected: applique 2 migrations sans erreur.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260503000001_init_auth.sql
git commit -m "feat(db): add init_auth migration (roles, permissions, user_profiles, user_sessions)"
```

---

## Task 2.4 — Migration 3 : catalog (categories, products)

**Files:**
- Create: `supabase/migrations/20260503000002_init_catalog.sql`

- [ ] **Step 1: Créer le fichier**

```sql
-- 20260503000002_init_catalog.sql
-- Phase 2 / migration 3 : catalog produits

CREATE TABLE categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  slug        TEXT UNIQUE NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);

CREATE INDEX idx_categories_active_sort ON categories(is_active, sort_order) WHERE deleted_at IS NULL;

CREATE TABLE products (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku             TEXT UNIQUE NOT NULL,
  name            TEXT NOT NULL,
  category_id     UUID NOT NULL REFERENCES categories(id),
  retail_price    DECIMAL(12,2) NOT NULL CHECK (retail_price >= 0),
  tax_inclusive   BOOLEAN NOT NULL DEFAULT true,
  image_url       TEXT,
  current_stock   DECIMAL(10,3) NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  is_favorite     BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);

CREATE INDEX idx_products_category ON products(category_id, is_active) WHERE deleted_at IS NULL;
CREATE INDEX idx_products_favorite ON products(is_favorite) WHERE is_favorite = true AND deleted_at IS NULL;

CREATE TRIGGER categories_set_updated_at
  BEFORE UPDATE ON categories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER products_set_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE categories IS 'Catégories produits (Beverage, Bread, Pastry, ...)';
COMMENT ON TABLE products   IS 'Catalogue produits avec stock cache';
```

- [ ] **Step 2: Appliquer + commit**

```bash
supabase db reset
git add supabase/migrations/20260503000002_init_catalog.sql
git commit -m "feat(db): add init_catalog migration (categories, products)"
```

---

## Task 2.5 — Migration 4 : POS (pos_sessions, orders, order_items, order_payments)

**Files:**
- Create: `supabase/migrations/20260503000003_init_pos.sql`

- [ ] **Step 1: Créer le fichier**

```sql
-- 20260503000003_init_pos.sql
-- Phase 2 / migration 4 : tables POS

-- POS SESSIONS (shift)
CREATE TABLE pos_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opened_by       UUID NOT NULL REFERENCES user_profiles(id),
  opened_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  opening_cash    DECIMAL(12,2) NOT NULL CHECK (opening_cash >= 0),
  opening_notes   TEXT,
  closed_at       TIMESTAMPTZ,
  closed_by       UUID REFERENCES user_profiles(id),
  closing_cash    DECIMAL(12,2) CHECK (closing_cash IS NULL OR closing_cash >= 0),
  expected_cash   DECIMAL(12,2),
  status          shift_status NOT NULL DEFAULT 'open',
  CONSTRAINT one_open_session_per_user EXCLUDE USING gist (
    opened_by WITH =
  ) WHERE (status = 'open')
);

CREATE INDEX idx_pos_sessions_open ON pos_sessions(opened_by) WHERE status = 'open';

-- ORDERS
CREATE TABLE orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number    TEXT UNIQUE NOT NULL,
  session_id      UUID NOT NULL REFERENCES pos_sessions(id),
  served_by       UUID NOT NULL REFERENCES user_profiles(id),
  order_type      order_type NOT NULL DEFAULT 'dine_in',
  status          order_status NOT NULL DEFAULT 'draft',
  subtotal        DECIMAL(12,2) NOT NULL,
  tax_amount      DECIMAL(12,2) NOT NULL,
  total           DECIMAL(12,2) NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at         TIMESTAMPTZ
);

CREATE INDEX idx_orders_session ON orders(session_id, created_at DESC);
CREATE INDEX idx_orders_paid_at ON orders(paid_at DESC) WHERE status = 'paid';

CREATE TRIGGER orders_set_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ORDER ITEMS
CREATE TABLE order_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id      UUID NOT NULL REFERENCES products(id),
  name_snapshot   TEXT NOT NULL,
  unit_price      DECIMAL(12,2) NOT NULL,
  quantity        DECIMAL(10,3) NOT NULL CHECK (quantity > 0),
  line_total      DECIMAL(12,2) NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_order_items_product ON order_items(product_id);

-- ORDER PAYMENTS
CREATE TABLE order_payments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  method          payment_method NOT NULL,
  amount          DECIMAL(12,2) NOT NULL CHECK (amount > 0),
  cash_received   DECIMAL(12,2),
  change_given    DECIMAL(12,2),
  paid_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_order_payments_order ON order_payments(order_id);
CREATE INDEX idx_order_payments_method ON order_payments(method, paid_at DESC);

COMMENT ON TABLE pos_sessions   IS 'Sessions de caisse (shift) — 1 active max par user';
COMMENT ON TABLE orders         IS 'Header de commande POS';
COMMENT ON TABLE order_items    IS 'Lignes produits de la commande (immutable)';
COMMENT ON TABLE order_payments IS 'Lignes de paiement (immutable, support split)';
```

- [ ] **Step 2: Appliquer + commit**

```bash
supabase db reset
git add supabase/migrations/20260503000003_init_pos.sql
git commit -m "feat(db): add init_pos migration (pos_sessions, orders, order_items, order_payments)"
```

---

## Task 2.6 — Migration 5 : inventory (stock_movements)

**Files:**
- Create: `supabase/migrations/20260503000004_init_inventory.sql`

- [ ] **Step 1: Créer le fichier**

```sql
-- 20260503000004_init_inventory.sql
-- Phase 2 / migration 5 : ledger stock

CREATE TABLE stock_movements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id      UUID NOT NULL REFERENCES products(id),
  movement_type   movement_type NOT NULL,
  quantity        DECIMAL(10,3) NOT NULL,
  reference_type  TEXT NOT NULL,
  reference_id    UUID NOT NULL,
  created_by      UUID NOT NULL REFERENCES user_profiles(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_stock_movements_product ON stock_movements(product_id, created_at DESC);
CREATE INDEX idx_stock_movements_ref ON stock_movements(reference_type, reference_id);

COMMENT ON TABLE stock_movements IS
  'Ledger append-only des mouvements de stock. Quantity signée: négatif pour sale/waste, positif pour purchase/production.';
```

- [ ] **Step 2: Appliquer + commit**

```bash
supabase db reset
git add supabase/migrations/20260503000004_init_inventory.sql
git commit -m "feat(db): add init_inventory migration (stock_movements ledger)"
```

---

## Task 2.7 — Migration 6 : settings (business_config, order_sequences, audit_logs)

**Files:**
- Create: `supabase/migrations/20260503000005_init_settings.sql`

- [ ] **Step 1: Créer le fichier**

```sql
-- 20260503000005_init_settings.sql
-- Phase 2 / migration 6 : settings + sequences + audit

CREATE TABLE business_config (
  id              SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),  -- singleton
  name            TEXT NOT NULL DEFAULT 'The Breakery',
  currency        TEXT NOT NULL DEFAULT 'IDR',
  tax_rate        DECIMAL(5,4) NOT NULL DEFAULT 0.1000,           -- PB1 10%
  tax_inclusive   BOOLEAN NOT NULL DEFAULT true,
  fiscal_address  TEXT,
  timezone        TEXT NOT NULL DEFAULT 'Asia/Makassar',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER business_config_set_updated_at
  BEFORE UPDATE ON business_config
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE order_sequences (
  date            DATE PRIMARY KEY,
  last_number     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE audit_logs (
  id              BIGSERIAL PRIMARY KEY,
  actor_id        UUID REFERENCES user_profiles(id),
  action          TEXT NOT NULL,
  entity_type     TEXT NOT NULL,
  entity_id       UUID,
  metadata        JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_logs_actor ON audit_logs(actor_id, created_at DESC);
CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_type, entity_id, created_at DESC);
CREATE INDEX idx_audit_logs_action ON audit_logs(action, created_at DESC);

COMMENT ON TABLE business_config  IS 'Singleton config business (PB1, devise, timezone)';
COMMENT ON TABLE order_sequences  IS 'Compteur quotidien pour order_number (#0001 reset chaque jour)';
COMMENT ON TABLE audit_logs       IS 'Append-only audit trail';
```

- [ ] **Step 2: Appliquer + commit**

```bash
supabase db reset
git add supabase/migrations/20260503000005_init_settings.sql
git commit -m "feat(db): add init_settings migration (business_config, order_sequences, audit_logs)"
```

---

## Task 2.8 — Migration 7 : helpers (round_idr, is_authenticated, has_permission, hash_pin, verify_user_pin)

**Files:**
- Create: `supabase/migrations/20260503000006_init_helpers.sql`

- [ ] **Step 1: Créer le fichier**

```sql
-- 20260503000006_init_helpers.sql
-- Phase 2 / migration 7 : helper functions (RLS, idr, pin)

-- Round IDR à la centaine la plus proche
CREATE OR REPLACE FUNCTION round_idr(amount DECIMAL)
RETURNS DECIMAL
LANGUAGE sql IMMUTABLE
AS $$ SELECT ROUND(amount / 100) * 100 $$;

-- is_authenticated cached helper (V2 pattern)
CREATE OR REPLACE FUNCTION is_authenticated()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT auth.uid() IS NOT NULL $$;

-- Hash PIN bcrypt (cost 10)
CREATE OR REPLACE FUNCTION hash_pin(p_pin TEXT)
RETURNS TEXT
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, extensions
AS $$
  SELECT crypt(p_pin, gen_salt('bf', 10))
$$;

-- Verify PIN
CREATE OR REPLACE FUNCTION verify_user_pin(p_user_id UUID, p_pin TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_hash TEXT;
BEGIN
  SELECT pin_hash INTO v_hash FROM user_profiles WHERE id = p_user_id AND deleted_at IS NULL;
  IF v_hash IS NULL THEN
    RETURN false;
  END IF;
  RETURN v_hash = crypt(p_pin, v_hash);
END $$;

-- has_permission v1 (mapping role → perm hardcodé)
-- Session 2+ : remplacer par jointure user_roles -> role_permissions -> permissions + overrides
CREATE OR REPLACE FUNCTION has_permission(p_uid UUID, p_perm TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_role TEXT;
BEGIN
  SELECT role_code INTO v_role FROM user_profiles WHERE auth_user_id = p_uid AND deleted_at IS NULL;
  IF v_role IS NULL THEN
    RETURN false;
  END IF;

  RETURN CASE
    WHEN v_role IN ('SUPER_ADMIN', 'ADMIN') THEN true
    WHEN v_role = 'MANAGER' THEN p_perm IN (
      'pos.session.open','pos.session.close_own','pos.session.close_other',
      'pos.session.view_all','pos.sale.create','pos.sale.void','pos.sale.update',
      'products.read','products.create','products.update'
    )
    WHEN v_role = 'CASHIER' THEN p_perm IN (
      'pos.session.open','pos.session.close_own','pos.sale.create','products.read'
    )
    ELSE false
  END;
END $$;

-- Trigger : hash session token et clear plaintext
CREATE OR REPLACE FUNCTION hash_session_token_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.session_token_hash IS NOT NULL AND length(NEW.session_token_hash) = 36 THEN
    -- Si on insère le UUID v4 brut (36 chars), on le hash en SHA-256 (64 hex chars)
    NEW.session_token_hash := encode(digest(NEW.session_token_hash, 'sha256'), 'hex');
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER user_sessions_hash_token
  BEFORE INSERT ON user_sessions
  FOR EACH ROW EXECUTE FUNCTION hash_session_token_trigger();

COMMENT ON FUNCTION round_idr        IS 'Arrondi IDR à la centaine la plus proche';
COMMENT ON FUNCTION is_authenticated IS 'STABLE helper pour RLS (cached per-tx)';
COMMENT ON FUNCTION hash_pin         IS 'bcrypt cost 10';
COMMENT ON FUNCTION verify_user_pin  IS 'Comparison bcrypt PIN';
COMMENT ON FUNCTION has_permission   IS 'v1 hardcoded mapping role → permissions. Remplacé en session 2.';
```

- [ ] **Step 2: Appliquer + commit**

```bash
supabase db reset
git add supabase/migrations/20260503000006_init_helpers.sql
git commit -m "feat(db): add init_helpers migration (round_idr, is_authenticated, hash_pin, verify_user_pin, has_permission)"
```

---

## Task 2.9 — Migration 8 : RLS policies sur toutes les tables

**Files:**
- Create: `supabase/migrations/20260503000007_init_rls.sql`

- [ ] **Step 1: Créer le fichier**

```sql
-- 20260503000007_init_rls.sql
-- Phase 2 / migration 8 : RLS sur toutes les tables public.*

-- ============================================================
-- ROLES + PERMISSIONS — lecture libre auth, écriture super-admin
-- ============================================================
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read" ON roles FOR SELECT USING (is_authenticated());
CREATE POLICY "super_admin_write" ON roles FOR ALL USING (
  EXISTS (SELECT 1 FROM user_profiles WHERE auth_user_id = auth.uid() AND role_code = 'SUPER_ADMIN')
);

ALTER TABLE permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read" ON permissions FOR SELECT USING (is_authenticated());
CREATE POLICY "super_admin_write" ON permissions FOR ALL USING (
  EXISTS (SELECT 1 FROM user_profiles WHERE auth_user_id = auth.uid() AND role_code = 'SUPER_ADMIN')
);

-- ============================================================
-- USER PROFILES — lecture auth, écriture self ou users.update
-- ============================================================
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read" ON user_profiles FOR SELECT USING (is_authenticated());
CREATE POLICY "perm_create" ON user_profiles FOR INSERT
  WITH CHECK (has_permission(auth.uid(), 'users.create'));
CREATE POLICY "perm_update" ON user_profiles FOR UPDATE USING (
  auth_user_id = auth.uid()                        -- self
  OR has_permission(auth.uid(), 'users.update')
);

-- ============================================================
-- USER SESSIONS — own sessions only (Edge Functions bypassent via service_role)
-- ============================================================
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_sessions_read" ON user_sessions FOR SELECT USING (
  user_id IN (SELECT id FROM user_profiles WHERE auth_user_id = auth.uid())
);
-- Pas de policy INSERT/UPDATE/DELETE → seul service_role peut écrire

-- ============================================================
-- CATEGORIES — lecture auth, écriture products.create/update
-- ============================================================
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read" ON categories FOR SELECT USING (is_authenticated());
CREATE POLICY "perm_create" ON categories FOR INSERT
  WITH CHECK (has_permission(auth.uid(), 'products.create'));
CREATE POLICY "perm_update" ON categories FOR UPDATE
  USING (has_permission(auth.uid(), 'products.update'));

-- ============================================================
-- PRODUCTS — lecture auth, écriture products.create/update
-- ============================================================
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read" ON products FOR SELECT USING (is_authenticated());
CREATE POLICY "perm_create" ON products FOR INSERT
  WITH CHECK (has_permission(auth.uid(), 'products.create'));
CREATE POLICY "perm_update" ON products FOR UPDATE
  USING (has_permission(auth.uid(), 'products.update'));

-- ============================================================
-- POS SESSIONS — lecture auth, INSERT pos.session.open, UPDATE own ou close_other
-- ============================================================
ALTER TABLE pos_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read" ON pos_sessions FOR SELECT USING (is_authenticated());
CREATE POLICY "perm_create" ON pos_sessions FOR INSERT
  WITH CHECK (
    has_permission(auth.uid(), 'pos.session.open')
    AND opened_by IN (SELECT id FROM user_profiles WHERE auth_user_id = auth.uid())
  );
CREATE POLICY "perm_update" ON pos_sessions FOR UPDATE USING (
  (opened_by IN (SELECT id FROM user_profiles WHERE auth_user_id = auth.uid())
    AND has_permission(auth.uid(), 'pos.session.close_own'))
  OR has_permission(auth.uid(), 'pos.session.close_other')
);

-- ============================================================
-- ORDERS, ORDER_ITEMS, ORDER_PAYMENTS — lecture auth, INSERT seulement via RPC SECURITY DEFINER
-- ============================================================
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read" ON orders FOR SELECT USING (is_authenticated());
-- Pas de policy INSERT → seul le RPC complete_order_with_payment (SECURITY DEFINER) peut écrire
CREATE POLICY "perm_update" ON orders FOR UPDATE
  USING (has_permission(auth.uid(), 'pos.sale.update'));

ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read" ON order_items FOR SELECT USING (is_authenticated());

ALTER TABLE order_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read" ON order_payments FOR SELECT USING (is_authenticated());

-- ============================================================
-- STOCK MOVEMENTS — lecture auth, INSERT seulement via RPC, jamais UPDATE
-- ============================================================
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read" ON stock_movements FOR SELECT USING (is_authenticated());
-- Append-only via RPC

-- ============================================================
-- BUSINESS_CONFIG — lecture auth, écriture super-admin
-- ============================================================
ALTER TABLE business_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read" ON business_config FOR SELECT USING (is_authenticated());
CREATE POLICY "super_admin_write" ON business_config FOR ALL USING (
  EXISTS (SELECT 1 FROM user_profiles WHERE auth_user_id = auth.uid() AND role_code = 'SUPER_ADMIN')
);

-- ============================================================
-- ORDER_SEQUENCES — lecture auth, écriture via RPC seulement
-- ============================================================
ALTER TABLE order_sequences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read" ON order_sequences FOR SELECT USING (is_authenticated());

-- ============================================================
-- AUDIT_LOGS — lecture admin/super-admin, INSERT via RPC
-- ============================================================
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_read" ON audit_logs FOR SELECT USING (
  EXISTS (SELECT 1 FROM user_profiles WHERE auth_user_id = auth.uid() AND role_code IN ('SUPER_ADMIN', 'ADMIN'))
);
```

- [ ] **Step 2: Appliquer + commit**

```bash
supabase db reset
git add supabase/migrations/20260503000007_init_rls.sql
git commit -m "feat(db): add init_rls migration (policies on all 14 tables)"
```

---

## Task 2.10 — Migration 9 : RPC complete_order_with_payment

**Files:**
- Create: `supabase/migrations/20260503000008_init_complete_order_rpc.sql`

- [ ] **Step 1: Créer le fichier**

```sql
-- 20260503000008_init_complete_order_rpc.sql
-- Phase 2 / migration 9 : RPC central transactionnel

CREATE OR REPLACE FUNCTION complete_order_with_payment(
  p_session_id UUID,
  p_order_type order_type,
  p_items      JSONB,        -- [{product_id: uuid, quantity: number, unit_price: number}]
  p_payment    JSONB         -- {method, amount, cash_received?, change_given?}
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id        UUID;
  v_profile_id     UUID;
  v_order_id       UUID;
  v_order_number   TEXT;
  v_seq_number     INTEGER;
  v_subtotal       DECIMAL(12,2) := 0;
  v_tax_amount     DECIMAL(12,2) := 0;
  v_tax_rate       DECIMAL(5,4);
  v_item           JSONB;
  v_product        RECORD;
  v_payment_method payment_method;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_profile_id FROM user_profiles
    WHERE auth_user_id = v_user_id AND deleted_at IS NULL;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'User profile not found' USING ERRCODE = 'P0001';
  END IF;

  IF NOT has_permission(v_user_id, 'pos.sale.create') THEN
    RAISE EXCEPTION 'Permission denied: pos.sale.create' USING ERRCODE = 'P0003';
  END IF;

  -- 1. Verify session ouverte appartient au caller
  IF NOT EXISTS (
    SELECT 1 FROM pos_sessions
      WHERE id = p_session_id
        AND opened_by = v_profile_id
        AND status = 'open'
  ) THEN
    RAISE EXCEPTION 'No open session for this user' USING ERRCODE = 'P0001';
  END IF;

  -- 2. Lock products + check stock
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_product FROM products
      WHERE id = (v_item->>'product_id')::UUID
      FOR UPDATE;

    IF v_product.id IS NULL THEN
      RAISE EXCEPTION 'Product not found: %', v_item->>'product_id' USING ERRCODE = 'P0002';
    END IF;

    IF v_product.current_stock < (v_item->>'quantity')::DECIMAL THEN
      RAISE EXCEPTION 'Insufficient stock for product % (have %, need %)',
        v_product.name, v_product.current_stock, (v_item->>'quantity')::DECIMAL
        USING ERRCODE = 'P0002';
    END IF;
  END LOOP;

  -- 3. Compute totals (PB1 incluse extraite)
  SELECT tax_rate INTO v_tax_rate FROM business_config WHERE id = 1;

  SELECT COALESCE(SUM(round_idr((value->>'unit_price')::DECIMAL * (value->>'quantity')::DECIMAL)), 0)
    INTO v_subtotal
    FROM jsonb_array_elements(p_items);

  v_tax_amount := round_idr(v_subtotal * v_tax_rate / (1 + v_tax_rate));

  -- 4. Génère order_number (séquence quotidienne)
  INSERT INTO order_sequences (date, last_number)
    VALUES (CURRENT_DATE, 1)
    ON CONFLICT (date) DO UPDATE
      SET last_number = order_sequences.last_number + 1
    RETURNING last_number INTO v_seq_number;

  v_order_number := '#' || LPAD(v_seq_number::TEXT, 4, '0');

  -- 5. INSERT order
  INSERT INTO orders (
    order_number, session_id, served_by, order_type, status,
    subtotal, tax_amount, total, paid_at
  ) VALUES (
    v_order_number, p_session_id, v_profile_id, p_order_type, 'paid',
    v_subtotal, v_tax_amount, v_subtotal, now()
  ) RETURNING id INTO v_order_id;

  -- 6. INSERT order_items + stock_movements + decrement
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    INSERT INTO order_items (
      order_id, product_id, name_snapshot, unit_price, quantity, line_total
    )
    SELECT
      v_order_id,
      p.id,
      p.name,
      (v_item->>'unit_price')::DECIMAL,
      (v_item->>'quantity')::DECIMAL,
      round_idr((v_item->>'unit_price')::DECIMAL * (v_item->>'quantity')::DECIMAL)
    FROM products p WHERE p.id = (v_item->>'product_id')::UUID;

    INSERT INTO stock_movements (
      product_id, movement_type, quantity, reference_type, reference_id, created_by
    ) VALUES (
      (v_item->>'product_id')::UUID,
      'sale',
      -(v_item->>'quantity')::DECIMAL,
      'orders',
      v_order_id,
      v_profile_id
    );

    UPDATE products
      SET current_stock = current_stock - (v_item->>'quantity')::DECIMAL,
          updated_at = now()
      WHERE id = (v_item->>'product_id')::UUID;
  END LOOP;

  -- 7. INSERT payment
  v_payment_method := (p_payment->>'method')::payment_method;
  INSERT INTO order_payments (
    order_id, method, amount, cash_received, change_given
  ) VALUES (
    v_order_id,
    v_payment_method,
    (p_payment->>'amount')::DECIMAL,
    NULLIF((p_payment->>'cash_received'), '')::DECIMAL,
    NULLIF((p_payment->>'change_given'), '')::DECIMAL
  );

  -- 8. Audit log
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
    VALUES (v_profile_id, 'order.complete', 'orders', v_order_id, jsonb_build_object(
      'order_number', v_order_number,
      'total', v_subtotal,
      'payment_method', p_payment->>'method'
    ));

  -- 9. Return
  RETURN jsonb_build_object(
    'order_id',     v_order_id,
    'order_number', v_order_number,
    'subtotal',     v_subtotal,
    'tax_amount',   v_tax_amount,
    'total',        v_subtotal,
    'change_given', NULLIF((p_payment->>'change_given'), '')::DECIMAL
  );
END $$;

-- Permission GRANT pour authenticated role
GRANT EXECUTE ON FUNCTION complete_order_with_payment TO authenticated;

COMMENT ON FUNCTION complete_order_with_payment IS
  'RPC central transactionnel : lock + check stock, génère order_number, insert order + items + payment + stock_movements + audit. SECURITY DEFINER bypass les RLS INSERT.';
```

- [ ] **Step 2: Appliquer**

```bash
supabase db reset
```

Expected: les 9 migrations s'appliquent sans erreur.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260503000008_init_complete_order_rpc.sql
git commit -m "feat(db): add complete_order_with_payment RPC (atomic order + stock + audit)"
```

---

## Task 2.11 — Seed démo (`supabase/seed.sql`)

**Files:**
- Modify: `supabase/seed.sql`

- [ ] **Step 1: Créer un script Node pour générer les bcrypt hash des PINs**

Lancer dans un terminal Node :

```bash
node -e "const c=require('bcryptjs'); console.log('1234:', c.hashSync('1234', 10)); console.log('5678:', c.hashSync('5678', 10));"
```

Si bcryptjs n'est pas installé : `pnpm dlx bcryptjs` ne marche pas. Faire :

```bash
pnpm add -Dw bcryptjs
node -e "const c=require('bcryptjs'); console.log('1234:', c.hashSync('1234', 10)); console.log('5678:', c.hashSync('5678', 10));"
pnpm remove -Dw bcryptjs
```

Noter les 2 hashes (commencent par `$2b$10$...`).

- [ ] **Step 2: Créer un user dans `auth.users` via psql**

Le seed.sql doit créer 2 utilisateurs `auth.users` avec emails fictifs `cashier-EMP000@thebreakery.local` et `cashier-EMP001@thebreakery.local`. On utilise une fonction Supabase pour ça :

Le contenu du seed devra créer auth.users avec un INSERT direct (Supabase local autorise) puis insérer user_profiles liés.

- [ ] **Step 3: Écrire `supabase/seed.sql`**

```sql
-- supabase/seed.sql
-- Seed initial : 4 rôles, 13 permissions, 2 users (admin + cashier),
-- 4 catégories, 8 produits.

-- ============================================================
-- ROLES
-- ============================================================
INSERT INTO roles (code, name, description, is_system) VALUES
  ('SUPER_ADMIN', 'Super Admin',  'Accès complet système',                         true),
  ('ADMIN',       'Admin',        'Administration métier',                         true),
  ('MANAGER',     'Manager',      'Gestion opérationnelle (POS + produits)',       true),
  ('CASHIER',     'Cashier',      'Caissier — POS sale + open shift',              true)
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- PERMISSIONS
-- ============================================================
INSERT INTO permissions (code, module, action, description) VALUES
  ('pos.session.open',        'pos',      'session.open',  'Ouvrir une session de caisse'),
  ('pos.session.close_own',   'pos',      'session.close', 'Clôturer sa propre session'),
  ('pos.session.close_other', 'pos',      'session.close', 'Clôturer la session d''un autre'),
  ('pos.session.view_all',    'pos',      'session.view',  'Voir toutes les sessions'),
  ('pos.sale.create',         'pos',      'sale.create',   'Encaisser une vente'),
  ('pos.sale.void',           'pos',      'sale.void',     'Annuler une vente'),
  ('pos.sale.update',         'pos',      'sale.update',   'Modifier une vente'),
  ('products.read',           'products', 'read',          'Voir le catalogue'),
  ('products.create',         'products', 'create',        'Créer un produit'),
  ('products.update',         'products', 'update',        'Modifier un produit'),
  ('users.create',            'users',    'create',        'Créer un utilisateur'),
  ('users.update',            'users',    'update',        'Modifier un utilisateur'),
  ('users.view_audit',        'users',    'view_audit',    'Voir les logs d''audit')
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- BUSINESS CONFIG (singleton)
-- ============================================================
INSERT INTO business_config (id, name, currency, tax_rate, tax_inclusive, fiscal_address, timezone)
VALUES (1, 'The Breakery', 'IDR', 0.10, true, 'Lombok, Indonesia', 'Asia/Makassar')
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- AUTH USERS + USER PROFILES
-- ============================================================
-- 2 auth.users, identifiés par email synthétique. Pas de signin par email
-- attendu : les Edge Functions mintent les sessions via PIN.
DO $$
DECLARE
  v_admin_uid    UUID := '00000000-0000-0000-0000-000000000001';
  v_cashier_uid  UUID := '00000000-0000-0000-0000-000000000002';
BEGIN
  -- ADMIN
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_user_meta_data, created_at, updated_at
  ) VALUES (
    v_admin_uid, '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'cashier-EMP000@thebreakery.local',
    crypt('disabled-password-' || gen_random_uuid(), gen_salt('bf')),
    now(), '{"provider":"pin"}'::jsonb, now(), now()
  ) ON CONFLICT (id) DO NOTHING;

  -- CASHIER
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_user_meta_data, created_at, updated_at
  ) VALUES (
    v_cashier_uid, '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'cashier-EMP001@thebreakery.local',
    crypt('disabled-password-' || gen_random_uuid(), gen_salt('bf')),
    now(), '{"provider":"pin"}'::jsonb, now(), now()
  ) ON CONFLICT (id) DO NOTHING;

  -- USER PROFILES (PIN hashés via hash_pin())
  INSERT INTO user_profiles (
    auth_user_id, employee_code, full_name, pin_hash, role_code, is_active
  ) VALUES (
    v_admin_uid, 'EMP000', 'Mamat (Owner)', hash_pin('1234'), 'SUPER_ADMIN', true
  ) ON CONFLICT (employee_code) DO NOTHING;

  INSERT INTO user_profiles (
    auth_user_id, employee_code, full_name, pin_hash, role_code, is_active
  ) VALUES (
    v_cashier_uid, 'EMP001', 'Test Cashier', hash_pin('5678'), 'CASHIER', true
  ) ON CONFLICT (employee_code) DO NOTHING;
END $$;

-- ============================================================
-- CATEGORIES
-- ============================================================
INSERT INTO categories (id, name, slug, sort_order) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Beverage',  'beverage',  1),
  ('22222222-2222-2222-2222-222222222222', 'Bread',     'bread',     2),
  ('33333333-3333-3333-3333-333333333333', 'Pastry',    'pastry',    3),
  ('44444444-4444-4444-4444-444444444444', 'Sandwiches','sandwiches',4)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- PRODUCTS (8 items, stock 50 chacun)
-- Images: placeholder via.placeholder.com (remplacer plus tard par Cloudinary)
-- ============================================================
INSERT INTO products (sku, name, category_id, retail_price, image_url, current_stock, is_favorite) VALUES
  ('BEV-AMER',  'Americano',       '11111111-1111-1111-1111-111111111111', 35000,  'https://via.placeholder.com/400x400.png?text=Americano',  50, true),
  ('BEV-FLAT',  'Flat White',      '11111111-1111-1111-1111-111111111111', 45000,  'https://via.placeholder.com/400x400.png?text=Flat+White', 50, true),
  ('BEV-CAPP',  'Capuccino',       '11111111-1111-1111-1111-111111111111', 35000,  'https://via.placeholder.com/400x400.png?text=Capuccino',  50, false),
  ('BRD-SOUR',  'Sourdough Loaf',  '22222222-2222-2222-2222-222222222222', 75000,  'https://via.placeholder.com/400x400.png?text=Sourdough',  50, false),
  ('PAS-CROI',  'Croissant',       '33333333-3333-3333-3333-333333333333', 25000,  'https://via.placeholder.com/400x400.png?text=Croissant',  50, true),
  ('PAS-PAIN',  'Pain au Chocolat','33333333-3333-3333-3333-333333333333', 28000,  'https://via.placeholder.com/400x400.png?text=Pain',       50, false),
  ('SND-AMER',  'American Bagel',  '44444444-4444-4444-4444-444444444444', 70000,  'https://via.placeholder.com/400x400.png?text=Bagel',      50, false),
  ('SND-CHEE',  'Cheesy Brie',     '44444444-4444-4444-4444-444444444444', 70000,  'https://via.placeholder.com/400x400.png?text=Cheesy',     50, false)
ON CONFLICT (sku) DO NOTHING;
```

- [ ] **Step 4: Appliquer**

```bash
supabase db reset
```

Expected: 9 migrations + seed appliqués. Pas d'erreur.

- [ ] **Step 5: Vérifier dans Studio (http://127.0.0.1:54323)**

- Table Editor → `roles` : 4 rangs
- Table Editor → `permissions` : 13 rangs
- Table Editor → `user_profiles` : 2 rangs
- Table Editor → `categories` : 4 rangs
- Table Editor → `products` : 8 rangs avec `current_stock = 50`
- Authentication → Users : 2 utilisateurs

- [ ] **Step 6: Commit**

```bash
git add supabase/seed.sql
git commit -m "feat(db): add seed (roles, permissions, business_config, 2 users, 4 cats, 8 products)"
```

---

## Task 2.12 — Test manuel du RPC `complete_order_with_payment`

Vérifier que le RPC fonctionne avant de coder les Edge Functions et apps qui en dépendent.

- [ ] **Step 1: Créer une session via SQL (impersonate admin)**

Dans Studio → SQL Editor :

```sql
-- Impersonate admin (récupérer son auth_user_id)
SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';

-- Créer une session via INSERT direct (RLS le permet car opened_by matche)
INSERT INTO pos_sessions (opened_by, opening_cash)
SELECT id, 100000 FROM user_profiles WHERE employee_code = 'EMP000'
RETURNING *;
```

Expected: 1 row inserted.

- [ ] **Step 2: Appeler le RPC**

```sql
SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';

SELECT complete_order_with_payment(
  (SELECT id FROM pos_sessions WHERE opened_by = (SELECT id FROM user_profiles WHERE employee_code = 'EMP000') AND status = 'open'),
  'dine_in'::order_type,
  jsonb_build_array(
    jsonb_build_object(
      'product_id', (SELECT id FROM products WHERE sku = 'BEV-AMER'),
      'quantity', 1,
      'unit_price', 35000
    ),
    jsonb_build_object(
      'product_id', (SELECT id FROM products WHERE sku = 'BEV-FLAT'),
      'quantity', 1,
      'unit_price', 45000
    )
  ),
  jsonb_build_object('method', 'cash', 'amount', 80000, 'cash_received', 100000, 'change_given', 20000)
);
```

Expected: retourne JSON `{"order_id": ..., "order_number": "#0001", "subtotal": 80000, "tax_amount": 7273, "total": 80000, "change_given": 20000}`.

- [ ] **Step 3: Vérifier les effets**

```sql
SELECT * FROM orders;          -- 1 row, order_number #0001, status paid
SELECT * FROM order_items;     -- 2 rows
SELECT * FROM order_payments;  -- 1 row, method cash, change_given 20000
SELECT * FROM stock_movements; -- 2 rows, quantity négative
SELECT sku, name, current_stock FROM products WHERE sku IN ('BEV-AMER', 'BEV-FLAT');
-- Expected: current_stock = 49 pour les 2
SELECT * FROM audit_logs;      -- 1 row action='order.complete'
```

- [ ] **Step 4: Test cas erreur (insufficient stock)**

```sql
SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';

SELECT complete_order_with_payment(
  (SELECT id FROM pos_sessions WHERE opened_by = (SELECT id FROM user_profiles WHERE employee_code = 'EMP000') AND status = 'open'),
  'dine_in'::order_type,
  jsonb_build_array(jsonb_build_object('product_id', (SELECT id FROM products WHERE sku = 'BEV-AMER'), 'quantity', 9999, 'unit_price', 35000)),
  jsonb_build_object('method', 'cash', 'amount', 999, 'cash_received', 1000)
);
```

Expected: erreur `Insufficient stock for product Americano (have 49, need 9999)`.

- [ ] **Step 5: Reset state pour ne pas polluer**

```bash
supabase db reset
```

- [ ] **Step 6: Commit notes test**

Pas de fichier à commit ici, juste validation manuelle. Optionnel : créer `supabase/tests/rpc/manual-checks.md` documentant ces queries pour reproductibilité.

---

## Phase 2 — Done criteria

- [ ] `supabase start` démarre Postgres + Auth + Studio
- [ ] `supabase db reset` applique 9 migrations + seed sans erreur
- [ ] 14 tables créées (`\dt` dans psql ou Studio Table Editor)
- [ ] Toutes les tables ont RLS activée (`\d+ <table>` mentionne "Row Security: enabled")
- [ ] 2 users seedés avec PIN bcrypt (vérif `select pin_hash from user_profiles` commence par `$2b$10$`)
- [ ] 8 produits / 4 catégories visibles
- [ ] RPC `complete_order_with_payment` testé manuellement → crée order + items + payment + stock_movement + audit_log + decrement stock
- [ ] Helpers `round_idr`, `is_authenticated`, `has_permission`, `verify_user_pin`, `hash_pin` existent

**Next:** Phase 3 — Edge Functions (`2026-05-03-breakery-03-edge-functions.md`).
