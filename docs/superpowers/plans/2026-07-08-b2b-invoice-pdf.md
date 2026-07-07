# Facture PDF B2B — Implementation Plan (S68)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Donner au B2B une facture PDF téléchargeable portant un numéro de série dédié annuel continu (`INV/2026/00001`), attribué à la création de la commande.

**Architecture:** Numérotation en DB (`invoice_sequences`, colonne `orders.invoice_number`, helper `_next_b2b_invoice_number_v1`), attribuée dans la transaction de `create_b2b_order_v4` (bump additif). Un RPC de lecture pure `get_b2b_invoice_v1` fournit le JSONB rendu par un nouveau template `b2b_invoice` de l'EF générique `generate-pdf`. Le BO télécharge via le hook `useGeneratePdf` existant + un bouton par ligne dans `B2bInvoicesTab`.

**Tech Stack:** Postgres/plpgsql SECURITY DEFINER (Supabase cloud V3 dev `ikcyvlovptebroadgtvd` via MCP `mcp__claude_ai_Supabase__*`), Deno EF + pdf-lib, React + TanStack Query + `@breakery/ui`, pgTAP + Vitest.

## Global Constraints

- **DB cloud uniquement** : migrations via `mcp__claude_ai_Supabase__apply_migration`, SQL/pgTAP via `execute_sql` (envelope `BEGIN … ROLLBACK`), types via `generate_typescript_types`. **Ne jamais** `supabase start` / `db reset` / `run_pgtap.sh` (Docker retraité). **Vérifier que le connecteur `mcp__claude_ai_Supabase__*` est actif avant la 1ʳᵉ migration.**
- **Numérotation migrations monotone** : vérifier le plus haut NAME-block dans `supabase/migrations/` AVANT de choisir le suivant (S67 a pris `20260710000125..128` → présumer `129` comme départ, mais **re-vérifier**).
- **Jamais de `BEGIN;`/`COMMIT;` dans le corps d'une migration** (MCP wrappe déjà).
- **RPC versioning monotone** : `create_b2b_order_v3 → v4` avec `DROP FUNCTION create_b2b_order_v3(...)` **dans la même migration**. Corps repris du **LIVE** (`pg_get_functiondef`), jamais du fichier `_075` (drift cloud↔git — leçon DEV-S57-02).
- **Trio REVOKE anon defense-in-depth** sur toute fonction : `REVOKE ALL … FROM PUBLIC` + `REVOKE ALL … FROM anon` + `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`. `create_b2b_order_v4` et `get_b2b_invoice_v1` : **`GRANT EXECUTE TO authenticated`** (appelées par le BO en JWT user). Le helper `_next_b2b_invoice_number_v1` : **pas** de grant `authenticated` (interne).
- **Regen types obligatoire** après tout changement de schéma → `packages/supabase/src/types.generated.ts`, committé (cause #1 de CI cassée sur ce repo).
- **Format numéro** : `INV/YYYY/NNNNN` (préfixe `INV`, année 4 chiffres, compteur padé sur 5, séparateur `/`). Continu, remis à zéro par année.
- **Aucune ligne PB1/taxe** sur la facture — jamais. `orders` B2B ont `tax_amount = 0`.
- **Branche** : `swarm/session-68`. Commits conventionnels, co-author Claude.
- **Money-path** : `create_b2b_order` est money-path — re-passer les ancres `b2b_settlement`, `b2b_display_aware_stock`, `s44_money_gates` en closeout.

---

## File Structure

**Migrations (créées, numéros à confirmer, départ présumé `129`) :**
- `supabase/migrations/20260710000129_invoice_sequences_and_number.sql` — table `invoice_sequences`, colonne `orders.invoice_number` + index unique partiel, helper `_next_b2b_invoice_number_v1()`.
- `supabase/migrations/20260710000130_create_b2b_order_v4.sql` — bump v4 (corps live + attribution numéro) + DROP v3.
- `supabase/migrations/20260710000131_backfill_b2b_invoice_numbers.sql` — backfill DML idempotent.
- `supabase/migrations/20260710000132_get_b2b_invoice_v1.sql` — RPC de lecture.
- `supabase/migrations/20260710000133_view_b2b_invoices_invoice_number.sql` — vue + `invoice_number`.

**EF (créé/modifié) :**
- `supabase/functions/_shared/pdf-templates/b2b_invoice.ts` — nouveau template.
- `supabase/functions/_shared/pdf-templates/index.ts` — enregistrer `b2b_invoice` (permission `b2b.read`).

**BO (modifiés/créés) :**
- `apps/backoffice/src/features/reports/hooks/useGeneratePdf.ts` — +`'b2b_invoice'` dans l'union `PdfTemplate`.
- `apps/backoffice/src/features/btob/hooks/useDownloadB2bInvoice.ts` — **nouveau** hook d'action.
- `apps/backoffice/src/features/btob/hooks/useB2bInvoices.ts` — +`invoice_number` (type + select).
- `apps/backoffice/src/features/btob/components/B2bInvoicesTab.tsx` — afficher `invoice_number` + bouton « Invoice PDF ».
- `apps/backoffice/src/features/btob/hooks/useCreateB2bOrder.ts` — repoint `create_b2b_order_v4` + `invoice_number` au result.

**Tests :**
- `supabase/tests/b2b_invoice.test.sql` — pgTAP (numérotation, backfill, get_b2b_invoice_v1).
- `apps/backoffice/src/features/btob/__tests__/B2bInvoicesTab.smoke.test.tsx` — smoke bouton.

**Types :** `packages/supabase/src/types.generated.ts` — regen après les migrations DB.

---

## Task 1 : Schéma numérotation (table + colonne + helper)

**Files:**
- Create: `supabase/migrations/20260710000129_invoice_sequences_and_number.sql`
- Test: `supabase/tests/b2b_invoice.test.sql` (créé ici, étendu ensuite)

**Interfaces:**
- Produces: table `public.invoice_sequences(year int PK, last_number int)`; colonne `public.orders.invoice_number text`; fonction `public._next_b2b_invoice_number_v1() RETURNS text` (interne, SECURITY DEFINER) → `'INV/YYYY/NNNNN'`.

- [ ] **Step 1 : Vérifier le connecteur MCP et le plus haut NAME-block**

Run (MCP): `mcp__claude_ai_Supabase__execute_sql` avec `SELECT 1;` (project_id `ikcyvlovptebroadgtvd`) → doit renvoyer une ligne. Puis vérifier localement le plus haut fichier de `supabase/migrations/` (Glob `supabase/migrations/2026071000012*.sql`). Attendu : `…128` le plus haut → utiliser `129`. Sinon adapter tous les numéros de ce plan.

- [ ] **Step 2 : Écrire le test pgTAP du helper (échoue tant que la fonction n'existe pas)**

Créer `supabase/tests/b2b_invoice.test.sql` :

```sql
BEGIN;
SELECT plan(6);

-- Helper existe
SELECT has_function('public', '_next_b2b_invoice_number_v1', ARRAY[]::text[]);

-- Format + continuité (année courante, séquence vierge dans la transaction de test)
DELETE FROM public.invoice_sequences WHERE year = EXTRACT(YEAR FROM CURRENT_DATE)::int;
SELECT matches(
  public._next_b2b_invoice_number_v1(),
  '^INV/[0-9]{4}/00001$',
  'premier numéro = INV/YYYY/00001'
);
SELECT matches(
  public._next_b2b_invoice_number_v1(),
  '^INV/[0-9]{4}/00002$',
  'deuxième numéro = INV/YYYY/00002'
);

-- Colonne + index + table
SELECT has_column('public', 'orders', 'invoice_number', 'orders.invoice_number existe');
SELECT has_column('public', 'invoice_sequences', 'last_number', 'invoice_sequences.last_number existe');
SELECT hasnt_column('public', 'orders', 'invoice_pdf_url', 'pas de colonne parasite');

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 3 : Lancer le test → doit échouer**

Run (MCP `execute_sql`) : coller le contenu de `b2b_invoice.test.sql`.
Expected : erreur (fonction/colonne inexistante) — `_next_b2b_invoice_number_v1 does not exist`.

- [ ] **Step 4 : Écrire la migration `_129`**

```sql
-- 20260710000129_invoice_sequences_and_number.sql
-- S68 — Facture PDF B2B : série de numérotation dédiée annuelle continue.

CREATE TABLE IF NOT EXISTS public.invoice_sequences (
  year        INTEGER PRIMARY KEY,
  last_number INTEGER NOT NULL DEFAULT 0
);
-- Écrite uniquement par RPC SECURITY DEFINER ; aucun grant direct (miroir order_sequences).
REVOKE ALL ON TABLE public.invoice_sequences FROM PUBLIC;
REVOKE ALL ON TABLE public.invoice_sequences FROM anon;

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS invoice_number TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS orders_invoice_number_key
  ON public.orders (invoice_number) WHERE invoice_number IS NOT NULL;

CREATE OR REPLACE FUNCTION public._next_b2b_invoice_number_v1()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_year INTEGER := EXTRACT(YEAR FROM CURRENT_DATE)::int;
  v_n    INTEGER;
BEGIN
  INSERT INTO invoice_sequences (year, last_number)
    VALUES (v_year, 1)
    ON CONFLICT (year) DO UPDATE
      SET last_number = invoice_sequences.last_number + 1
    RETURNING last_number INTO v_n;
  RETURN 'INV/' || v_year::text || '/' || LPAD(v_n::text, 5, '0');
END $function$;

REVOKE ALL ON FUNCTION public._next_b2b_invoice_number_v1() FROM PUBLIC;
REVOKE ALL ON FUNCTION public._next_b2b_invoice_number_v1() FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
```

Appliquer via `mcp__claude_ai_Supabase__apply_migration` (name `invoice_sequences_and_number`, body = SQL ci-dessus).

- [ ] **Step 5 : Lancer le test → doit passer (6/6)**

Run (MCP `execute_sql`) : re-coller `b2b_invoice.test.sql`. Expected : `ok 1..6`, `finish` sans échec.

- [ ] **Step 6 : Commit**

```bash
git add supabase/migrations/20260710000129_invoice_sequences_and_number.sql supabase/tests/b2b_invoice.test.sql
git commit -m "feat(b2b): invoice_sequences + orders.invoice_number + numbering helper (S68)"
```

---

## Task 2 : `create_b2b_order_v3 → v4` (attribution à la création)

**Files:**
- Create: `supabase/migrations/20260710000130_create_b2b_order_v4.sql`
- Test: `supabase/tests/b2b_invoice.test.sql` (étendu)

**Interfaces:**
- Consumes: `_next_b2b_invoice_number_v1()` (Task 1).
- Produces: `create_b2b_order_v4(uuid, jsonb, text, date, uuid) RETURNS jsonb` — envelope `{ order_id, order_number, invoice_number, total, credit_after, je_id, idempotent_replay }`.

- [ ] **Step 1 : Récupérer le corps LIVE de v3**

Run (MCP `execute_sql`) :
```sql
SELECT pg_get_functiondef('public.create_b2b_order_v3(uuid,jsonb,text,date,uuid)'::regprocedure);
```
Copier le corps exact — c'est la base du v4 (NE PAS partir de `_075`).

- [ ] **Step 2 : Écrire le test pgTAP d'attribution (échoue tant que v4 n'existe pas)**

Ajouter à `supabase/tests/b2b_invoice.test.sql` un second bloc `BEGIN; SELECT plan(4); … ROLLBACK;` (ou augmenter le plan). Utiliser une fixture B2B minimale. Squelette :

```sql
BEGIN;
SELECT plan(4);

SELECT has_function('public', 'create_b2b_order_v4',
  ARRAY['uuid','jsonb','text','date','uuid'], 'v4 existe');
SELECT hasnt_function('public', 'create_b2b_order_v3',
  ARRAY['uuid','jsonb','text','date','uuid'], 'v3 droppée');

-- Fixture : un user manager authentifié + un client B2B + un produit non suivi.
-- (Réutiliser les helpers de fixture des suites b2b existantes — cf. b2b_settlement.test.sql
--  pour le pattern set_config('request.jwt.claims', …) et l'insertion customers/products.)
-- Après appel v4 :
--   SELECT (res->>'invoice_number') ~ '^INV/[0-9]{4}/[0-9]{5}$'  → true
--   SELECT invoice_number IS NOT NULL FROM orders WHERE id = (res->>'order_id')::uuid → true
SELECT ok(
  (SELECT o.invoice_number FROM orders o
    WHERE o.id = ( /* order_id renvoyé par l'appel v4 de la fixture */ NULL )::uuid) IS NULL
    OR TRUE,
  'placeholder — remplacer par l’assert réel sur la fixture (voir b2b_settlement.test.sql)'
);
SELECT pass('fixture wiring — see b2b_settlement.test.sql pattern');

SELECT * FROM finish();
ROLLBACK;
```

> **Note d'implémentation (obligatoire, pas un placeholder de livraison)** : reprendre EXACTEMENT le pattern de fixture de `supabase/tests/b2b_settlement.test.sql` (setup JWT claims + `INSERT customers (customer_type='b2b', b2b_credit_limit, …)` + produit `track_inventory=false`), appeler `create_b2b_order_v4(p_customer_id, jsonb_build_array(jsonb_build_object('product_id',…,'quantity',1,'unit_price',10000)), NULL, NULL, gen_random_uuid())`, capturer le retour, et asserter : (a) `invoice_number` matche `^INV/[0-9]{4}/[0-9]{5}$`, (b) la 2ᵉ commande incrémente le compteur, (c) `orders.invoice_number` persistée. Remplacer le squelette ci-dessus par ces asserts avant de considérer l'étape faite.

- [ ] **Step 3 : Lancer le test → échoue**

Run (MCP `execute_sql`). Expected : `create_b2b_order_v4 does not exist`.

- [ ] **Step 4 : Écrire la migration `_130`**

Partir du corps LIVE (Step 1), renommer en `create_b2b_order_v4`, et **insérer l'attribution du numéro juste avant l'`INSERT INTO orders`** :

```sql
-- après le credit-check réussi, avant INSERT INTO orders :
v_invoice_number := _next_b2b_invoice_number_v1();
```
Déclarer `v_invoice_number TEXT;`. Ajouter `invoice_number` à la liste de colonnes + valeurs de l'`INSERT INTO orders` (valeur `v_invoice_number`). Ajouter `'invoice_number', v_invoice_number` aux DEUX envelopes de retour (replay idempotent : lire `o.invoice_number` dans le SELECT de replay). Fin de migration :

```sql
DROP FUNCTION IF EXISTS public.create_b2b_order_v3(uuid, jsonb, text, date, uuid);

REVOKE ALL ON FUNCTION public.create_b2b_order_v4(uuid, jsonb, text, date, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_b2b_order_v4(uuid, jsonb, text, date, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_b2b_order_v4(uuid, jsonb, text, date, uuid) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
```

Appliquer via `apply_migration` (name `create_b2b_order_v4`).

- [ ] **Step 5 : Lancer le test → passe**

Run (MCP `execute_sql`) : re-coller la suite. Expected : tous les asserts verts, incluant l'incrément de séquence.

- [ ] **Step 6 : Vérifier la non-régression money-path (ancre)**

Run (MCP `execute_sql`) : coller `supabase/tests/b2b_display_aware_stock.test.sql`. Expected : inchangé (le v4 dérive du v3, comportement stock identique). Si la suite référence `create_b2b_order_v3` en dur → la repointer vers v4 dans le même commit.

- [ ] **Step 7 : Commit**

```bash
git add supabase/migrations/20260710000130_create_b2b_order_v4.sql supabase/tests/b2b_invoice.test.sql
git commit -m "feat(b2b): create_b2b_order_v4 assigns invoice_number at creation (S68)"
```

---

## Task 3 : Backfill des commandes B2B existantes

**Files:**
- Create: `supabase/migrations/20260710000131_backfill_b2b_invoice_numbers.sql`
- Test: `supabase/tests/b2b_invoice.test.sql` (étendu)

**Interfaces:**
- Consumes: `orders.invoice_number`, `invoice_sequences` (Task 1).
- Produces: toutes les commandes `order_type='b2b'` ont un `invoice_number` non NULL ; `invoice_sequences.last_number` seedé par année.

- [ ] **Step 1 : Test pgTAP du backfill (échoue avant backfill)**

Ajouter un bloc à la suite : insérer 2 commandes B2B `invoice_number IS NULL` (années différentes ou même année, ordre `created_at`), exécuter le backfill DML inline (copié de la migration), puis asserter : aucune commande B2B ne reste à `invoice_number IS NULL`, les numéros suivent l'ordre `created_at`, et `invoice_sequences.last_number` ≥ nombre attribué pour l'année. Fournir les asserts réels (pattern `results_eq`/`is`).

- [ ] **Step 2 : Écrire la migration `_131`**

```sql
-- 20260710000131_backfill_b2b_invoice_numbers.sql
-- S68 — Backfill idempotent : attribue un invoice_number à toutes les commandes
-- B2B existantes sans numéro (voided inclus, série complète), par année de created_at,
-- ordre (created_at, id), et seede invoice_sequences.
DO $$
DECLARE
  r        RECORD;
  v_year   INTEGER;
  v_n      INTEGER;
BEGIN
  FOR r IN
    SELECT id, EXTRACT(YEAR FROM created_at)::int AS yr
      FROM orders
     WHERE order_type = 'b2b' AND invoice_number IS NULL
     ORDER BY created_at, id
  LOOP
    INSERT INTO invoice_sequences (year, last_number)
      VALUES (r.yr, 1)
      ON CONFLICT (year) DO UPDATE
        SET last_number = invoice_sequences.last_number + 1
      RETURNING last_number INTO v_n;
    UPDATE orders
       SET invoice_number = 'INV/' || r.yr::text || '/' || LPAD(v_n::text, 5, '0')
     WHERE id = r.id;
  END LOOP;
END $$;
```

Appliquer via `apply_migration` (name `backfill_b2b_invoice_numbers`).

- [ ] **Step 3 : Vérifier le backfill live**

Run (MCP `execute_sql`) :
```sql
SELECT count(*) AS remaining FROM orders WHERE order_type='b2b' AND invoice_number IS NULL;
SELECT year, last_number FROM invoice_sequences ORDER BY year;
```
Expected : `remaining = 0` ; `invoice_sequences` cohérent avec le volume de commandes B2B par année.

- [ ] **Step 4 : Commit**

```bash
git add supabase/migrations/20260710000131_backfill_b2b_invoice_numbers.sql supabase/tests/b2b_invoice.test.sql
git commit -m "feat(b2b): backfill invoice_number on existing B2B orders (S68)"
```

---

## Task 4 : `get_b2b_invoice_v1` (RPC de lecture pure)

**Files:**
- Create: `supabase/migrations/20260710000132_get_b2b_invoice_v1.sql`
- Test: `supabase/tests/b2b_invoice.test.sql` (étendu)

**Interfaces:**
- Consumes: `orders`, `customers`, `order_items`, `view_b2b_invoices` (header/paiement).
- Produces: `get_b2b_invoice_v1(p_order_id uuid) RETURNS jsonb` — clés `invoice`, `customer`, `lines`, `payment`.

- [ ] **Step 1 : Vérifier les colonnes d'adresse `customers` (live)**

Run (MCP `execute_sql`) :
```sql
SELECT column_name FROM information_schema.columns
 WHERE table_schema='public' AND table_name='customers'
   AND column_name IN ('address','phone','email');
```
Utiliser dans le RPC uniquement les colonnes qui existent ; omettre proprement les autres (clés absentes du JSONB).

- [ ] **Step 2 : Test pgTAP shape + gate (échoue)**

Ajouter à la suite : appeler `get_b2b_invoice_v1(<order_id fixture>)` en tant que manager gaté `b2b.read` → asserter présence des clés `invoice`/`customer`/`lines`/`payment`, `invoice->>'invoice_number'` non NULL, `invoice->>'tax_amount' = '0'`, `jsonb_array_length(lines) >= 1`. Puis, en tant qu'utilisateur SANS `b2b.read` → `throws_ok(..., 'P0003')`. Puis passer un `order_id` non-B2B → `throws_ok(..., 'P0002')` (`invoice_not_found`).

- [ ] **Step 3 : Écrire la migration `_132`**

```sql
-- 20260710000132_get_b2b_invoice_v1.sql
-- S68 — Lecture pure pour le template PDF b2b_invoice. Gate b2b.read.
CREATE OR REPLACE FUNCTION public.get_b2b_invoice_v1(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   UUID := auth.uid();
  v_o     RECORD;
  v_cust  RECORD;
  v_terms INTEGER;
  v_paid  NUMERIC(14,2);
  v_lines JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;
  IF NOT has_permission(v_uid, 'b2b.read') THEN
    RAISE EXCEPTION 'permission_denied: b2b.read' USING ERRCODE = 'P0003';
  END IF;

  SELECT id, order_number, invoice_number, created_at, status, subtotal, tax_amount, total, notes, customer_id, order_type
    INTO v_o
    FROM orders WHERE id = p_order_id;
  IF v_o.id IS NULL OR v_o.order_type <> 'b2b' THEN
    RAISE EXCEPTION 'invoice_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT name, b2b_company_name, b2b_tax_id, COALESCE(b2b_payment_terms_days, 0) AS terms
    INTO v_cust
    FROM customers WHERE id = v_o.customer_id;
  v_terms := COALESCE(v_cust.terms, 0);

  -- Paiement : dérivé de la vue canonique (voided → absent → 0).
  SELECT COALESCE(amount_paid, 0) INTO v_paid
    FROM view_b2b_invoices WHERE invoice_id = p_order_id;
  v_paid := COALESCE(v_paid, 0);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'name',       oi.name_snapshot,
           'quantity',   oi.quantity,
           'unit_price', oi.unit_price,
           'line_total', oi.line_total
         ) ORDER BY oi.id), '[]'::jsonb)
    INTO v_lines
    FROM order_items oi WHERE oi.order_id = p_order_id;

  RETURN jsonb_build_object(
    'invoice', jsonb_build_object(
      'invoice_number', v_o.invoice_number,
      'order_number',   v_o.order_number,
      'invoice_date',   v_o.created_at::date,
      'due_date',       (v_o.created_at::date + (v_terms || ' days')::interval)::date,
      'status',         v_o.status,
      'subtotal',       v_o.subtotal,
      'tax_amount',     v_o.tax_amount,
      'total',          v_o.total,
      'notes',          v_o.notes
    ),
    'customer', jsonb_build_object(
      'company_name',       v_cust.b2b_company_name,
      'tax_id',             v_cust.b2b_tax_id,
      'name',               v_cust.name,
      'payment_terms_days', v_terms
    ),
    'lines',   v_lines,
    'payment', jsonb_build_object(
      'amount_paid', v_paid,
      'outstanding', GREATEST(v_o.total - v_paid, 0)
    )
  );
END $function$;

REVOKE ALL ON FUNCTION public.get_b2b_invoice_v1(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_b2b_invoice_v1(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_b2b_invoice_v1(uuid) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
```

> Si Step 1 a montré que `customers.address`/`phone` existent, ajouter `'address', v_cust.address` / `'phone', v_cust.phone` au bloc `customer` (et au SELECT). Sinon les omettre (comme ci-dessus).

Appliquer via `apply_migration` (name `get_b2b_invoice_v1`).

- [ ] **Step 4 : Lancer le test → passe**

Run (MCP `execute_sql`). Expected : shape + gate + perm-denied + non-b2b tous verts.

- [ ] **Step 5 : Commit**

```bash
git add supabase/migrations/20260710000132_get_b2b_invoice_v1.sql supabase/tests/b2b_invoice.test.sql
git commit -m "feat(b2b): get_b2b_invoice_v1 read RPC for PDF (S68)"
```

---

## Task 5 : `view_b2b_invoices` + `invoice_number` + regen types

**Files:**
- Create: `supabase/migrations/20260710000133_view_b2b_invoices_invoice_number.sql`
- Modify: `packages/supabase/src/types.generated.ts` (regen)

**Interfaces:**
- Produces: colonne `invoice_number` exposée par `view_b2b_invoices`.

- [ ] **Step 1 : Récupérer la définition LIVE de la vue**

Run (MCP `execute_sql`) :
```sql
SELECT pg_get_viewdef('public.view_b2b_invoices'::regclass, true);
```
La vue joint déjà `orders` (elle expose `order_number`, `order_status`, `invoice_date`). Repérer l'alias de `orders` (probablement `o`).

- [ ] **Step 2 : Écrire la migration `_133`**

`CREATE OR REPLACE VIEW public.view_b2b_invoices AS …` — coller la définition du Step 1 **à l'identique**, en ajoutant `o.invoice_number` (alias `orders`) à la liste des colonnes du SELECT. Ne rien changer d'autre (mêmes JOIN, WHERE, exclusion `voided`). Appliquer via `apply_migration` (name `view_b2b_invoices_invoice_number`).

- [ ] **Step 3 : Vérifier la colonne exposée**

Run (MCP `execute_sql`) :
```sql
SELECT invoice_id, order_number, invoice_number FROM view_b2b_invoices LIMIT 3;
```
Expected : `invoice_number` non NULL (grâce au backfill).

- [ ] **Step 4 : Regen types + commit**

Run (MCP `generate_typescript_types`, project `ikcyvlovptebroadgtvd`) → écrire le résultat dans `packages/supabase/src/types.generated.ts`.

```bash
pnpm typecheck
git add supabase/migrations/20260710000133_view_b2b_invoices_invoice_number.sql packages/supabase/src/types.generated.ts
git commit -m "feat(b2b): expose invoice_number on view_b2b_invoices + regen types (S68)"
```
Expected : `pnpm typecheck` exit 0.

---

## Task 6 : Template EF `b2b_invoice`

**Files:**
- Create: `supabase/functions/_shared/pdf-templates/b2b_invoice.ts`
- Modify: `supabase/functions/_shared/pdf-templates/index.ts`

**Interfaces:**
- Consumes: le JSONB de `get_b2b_invoice_v1` (Task 4) comme `data`.
- Produces: template `'b2b_invoice'` enregistré dans `TEMPLATES` (permission `b2b.read`).

- [ ] **Step 1 : Écrire le template**

Créer `supabase/functions/_shared/pdf-templates/b2b_invoice.ts` :

```ts
// supabase/functions/_shared/pdf-templates/b2b_invoice.ts
// S68 — B2B commercial invoice (NON-PKP : AUCUNE ligne PB1/taxe).
import { rgb } from 'https://esm.sh/pdf-lib@1.17.1';
import { drawFooter, drawHeader, formatIDR, type LayoutContext } from '../pdf-layout.ts';

export interface B2bInvoiceData {
  invoice: {
    invoice_number: string | null;
    order_number:   string;
    invoice_date:   string;
    due_date:       string;
    status:         string;
    subtotal:       number;
    tax_amount:     number;
    total:          number;
    notes:          string | null;
  };
  customer: {
    company_name:       string | null;
    tax_id:             string | null;
    name:               string | null;
    address?:           string | null;
    phone?:             string | null;
    payment_terms_days: number;
  };
  lines:   Array<{ name: string; quantity: number; unit_price: number; line_total: number }>;
  payment: { amount_paid: number; outstanding: number };
}

export async function render(
  ctx:     LayoutContext,
  data:    B2bInvoiceData,
  _period: { start: string; end: string } | null,
): Promise<void> {
  const page = ctx.doc.addPage([595, 842]);
  const title = data.invoice.invoice_number ?? data.invoice.order_number;
  let y = drawHeader(page, ctx, `INVOICE ${title}`);

  // Business address sous l'en-tête (drawHeader ne rend que nom + NPWP)
  if (ctx.business.address) {
    page.drawText(String(ctx.business.address).slice(0, 90), {
      x: 40, y, size: 8, font: ctx.font, color: rgb(0.4, 0.4, 0.4),
    });
    y -= 16;
  }

  // ── Métadonnées facture (droite) + Bill To (gauche) ──
  const metaX = 360;
  const meta: Array<[string, string]> = [
    ['Invoice no', data.invoice.invoice_number ?? '—'],
    ['Order no',   data.invoice.order_number],
    ['Date',       String(data.invoice.invoice_date).slice(0, 10)],
    ['Due date',   String(data.invoice.due_date).slice(0, 10)],
    ['Status',     data.invoice.status],
  ];
  let my = y;
  for (const [l, v] of meta) {
    page.drawText(l, { x: metaX, y: my, size: 9, font: ctx.fontBold, color: rgb(0.3, 0.3, 0.3) });
    page.drawText(v, { x: 555 - ctx.font.widthOfTextAtSize(v, 9), y: my, size: 9, font: ctx.font, color: rgb(0.1, 0.1, 0.1) });
    my -= 13;
  }

  page.drawText('Bill To', { x: 40, y, size: 11, font: ctx.fontBold, color: rgb(0.1, 0.1, 0.1) });
  let by = y - 16;
  const billLines = [
    data.customer.company_name ?? data.customer.name ?? '—',
    data.customer.tax_id ? `NPWP: ${data.customer.tax_id}` : null,
    data.customer.address ?? null,
    data.customer.phone ?? null,
  ].filter((s): s is string => s !== null && s !== '');
  for (const l of billLines) {
    page.drawText(l.slice(0, 60), { x: 52, y: by, size: 9, font: ctx.font, color: rgb(0.2, 0.2, 0.2) });
    by -= 13;
  }

  y = Math.min(by, my) - 14;

  // ── Tableau des lignes ──
  page.drawText('Item',  { x: 52,  y, size: 9, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
  page.drawText('Qty',   { x: 320, y, size: 9, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
  page.drawText('Unit',  { x: 400, y, size: 9, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
  page.drawText('Total', { x: 500, y, size: 9, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
  y -= 4;
  page.drawLine({ start: { x: 40, y }, end: { x: 555, y }, thickness: 0.3, color: rgb(0.7, 0.7, 0.7) });
  y -= 12;

  for (const it of data.lines) {
    page.drawText(String(it.name).slice(0, 40), { x: 52, y, size: 9, font: ctx.font, color: rgb(0.1, 0.1, 0.1) });
    const q = String(it.quantity);
    page.drawText(q, { x: 360 - ctx.font.widthOfTextAtSize(q, 9), y, size: 9, font: ctx.font, color: rgb(0.1, 0.1, 0.1) });
    const u = formatIDR(it.unit_price);
    page.drawText(u, { x: 460 - ctx.font.widthOfTextAtSize(u, 9), y, size: 9, font: ctx.font, color: rgb(0.1, 0.1, 0.1) });
    const t = formatIDR(it.line_total);
    page.drawText(t, { x: 555 - ctx.font.widthOfTextAtSize(t, 9), y, size: 9, font: ctx.font, color: rgb(0.1, 0.1, 0.1) });
    y -= 13;
  }

  // ── Totaux (AUCUNE ligne taxe/PB1) ──
  y -= 6;
  page.drawLine({ start: { x: 320, y }, end: { x: 555, y }, thickness: 0.3, color: rgb(0.7, 0.7, 0.7) });
  y -= 14;
  const totals: Array<[string, string]> = [
    ['Subtotal',    formatIDR(data.invoice.subtotal)],
    ['Total',       formatIDR(data.invoice.total)],
    ['Paid',        formatIDR(data.payment.amount_paid)],
    ['Amount due',  formatIDR(data.payment.outstanding)],
  ];
  for (const [l, v] of totals) {
    const bold = l === 'Total' || l === 'Amount due';
    page.drawText(l, { x: 400, y, size: 9, font: bold ? ctx.fontBold : ctx.font, color: rgb(0.2, 0.2, 0.2) });
    page.drawText(v, { x: 555 - (bold ? ctx.fontBold : ctx.font).widthOfTextAtSize(v, 9), y, size: 9, font: bold ? ctx.fontBold : ctx.font, color: rgb(0.1, 0.1, 0.1) });
    y -= 13;
  }

  if (data.invoice.notes) {
    y -= 12;
    page.drawText('Notes', { x: 40, y, size: 9, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
    y -= 13;
    page.drawText(String(data.invoice.notes).slice(0, 100), { x: 52, y, size: 8, font: ctx.font, color: rgb(0.3, 0.3, 0.3) });
  }

  drawFooter(page, ctx, 1, 1);
}
```

- [ ] **Step 2 : Enregistrer dans le registry**

Modifier `supabase/functions/_shared/pdf-templates/index.ts` : ajouter l'import `import { render as b2bInvoice } from './b2b_invoice.ts';` (suivre le style exact du fichier) et l'entrée `b2b_invoice: { render: b2bInvoice, permission: 'b2b.read' }` dans le record `TEMPLATES`, + `'b2b_invoice'` dans le type `TemplateName` si le type est une union manuelle.

- [ ] **Step 3 : Vérifier que le registry compile (Deno check si dispo, sinon revue)**

Run : `deno check supabase/functions/_shared/pdf-templates/index.ts` si Deno est installé ; sinon relire l'import + l'entrée pour cohérence de nommage. Expected : pas d'erreur de type.

- [ ] **Step 4 : Commit**

```bash
git add supabase/functions/_shared/pdf-templates/b2b_invoice.ts supabase/functions/_shared/pdf-templates/index.ts
git commit -m "feat(b2b): b2b_invoice PDF template (no PB1) + registry (S68)"
```

---

## Task 7 : Câblage BO (bouton « Invoice PDF » + repoint v4)

**Files:**
- Modify: `apps/backoffice/src/features/reports/hooks/useGeneratePdf.ts`
- Create: `apps/backoffice/src/features/btob/hooks/useDownloadB2bInvoice.ts`
- Modify: `apps/backoffice/src/features/btob/hooks/useB2bInvoices.ts`
- Modify: `apps/backoffice/src/features/btob/components/B2bInvoicesTab.tsx`
- Modify: `apps/backoffice/src/features/btob/hooks/useCreateB2bOrder.ts`
- Test: `apps/backoffice/src/features/btob/__tests__/B2bInvoicesTab.smoke.test.tsx`

**Interfaces:**
- Consumes: `get_b2b_invoice_v1` (Task 4), `useGeneratePdf` (existant), `view_b2b_invoices.invoice_number` (Task 5).
- Produces: hook `useDownloadB2bInvoice()` → `{ download(orderId, invoiceNumber, orderNumber), isPending }`.

- [ ] **Step 1 : Étendre l'union `PdfTemplate`**

`apps/backoffice/src/features/reports/hooks/useGeneratePdf.ts` — ajouter `| 'b2b_invoice'` à l'union `PdfTemplate` (l.10-15).

- [ ] **Step 2 : Créer `useDownloadB2bInvoice`**

```ts
// apps/backoffice/src/features/btob/hooks/useDownloadB2bInvoice.ts
// S68 — Fetch invoice data (get_b2b_invoice_v1) then render via generate-pdf and open it.
import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { useGeneratePdf } from '@/features/reports/hooks/useGeneratePdf.js';

export function useDownloadB2bInvoice() {
  const pdf = useGeneratePdf();
  const mut = useMutation<void, Error, { orderId: string; invoiceNumber: string | null; orderNumber: string }>({
    mutationFn: async ({ orderId, invoiceNumber, orderNumber }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await supabase.rpc('get_b2b_invoice_v1', { p_order_id: orderId } as any);
      if (error) throw new Error(error.message);
      if (data === null) throw new Error('invoice_not_found');
      const safe = (invoiceNumber ?? orderNumber).replace(/[^A-Za-z0-9._-]/g, '-');
      const res = await pdf.mutateAsync({ template: 'b2b_invoice', data: data as object, filename: `invoice-${safe}` });
      if (typeof window !== 'undefined') window.open(res.signed_url, '_blank', 'noopener');
    },
  });
  return { download: mut.mutate, isPending: mut.isPending };
}
```

- [ ] **Step 3 : Ajouter `invoice_number` à `useB2bInvoices`**

`useB2bInvoices.ts` — ajouter `invoice_number: string | null;` à `B2bInvoiceRow` et `'invoice_number'` à la liste `.select(...)` (l.35).

- [ ] **Step 4 : Afficher `invoice_number` + bouton dans `B2bInvoicesTab`**

Dans `B2bInvoicesTab.tsx` : importer `Download` de `lucide-react` et `useDownloadB2bInvoice`. Instancier `const inv = useDownloadB2bInvoice();`. Afficher `inv.invoice_number ?? inv.order_number` dans le `<span className="font-mono">` (l.84), en gardant `order_number` en sous-titre. Ajouter, dans le groupe de boutons (l.102-124), un bouton pour toutes les lignes :

```tsx
<Button
  variant="ghost"
  size="sm"
  onClick={() => inv.download({ orderId: invoice.invoice_id, invoiceNumber: invoice.invoice_number, orderNumber: invoice.order_number })}
  disabled={inv.isPending}
  data-testid={`inv-pdf-${invoice.order_number}`}
>
  <Download className="mr-1 h-3.5 w-3.5" aria-hidden /> Invoice PDF
</Button>
```
(Renommer la variable de map de `inv` → `row` si collision avec le hook `inv` ; adapter les refs en conséquence.)

- [ ] **Step 5 : Repointer `useCreateB2bOrder` sur v4**

`useCreateB2bOrder.ts` : remplacer `supabase.rpc('create_b2b_order_v3', …)` (l.128) par `'create_b2b_order_v4'` ; ajouter `invoice_number: string;` à `CreateB2bOrderResult` (l.67-74) ; mettre à jour le commentaire d'en-tête (`create_b2b_order_v4`, S68).

- [ ] **Step 6 : Smoke test du bouton**

Créer `apps/backoffice/src/features/btob/__tests__/B2bInvoicesTab.smoke.test.tsx` : monter `B2bInvoicesTab` avec un mock `useB2bInvoices` renvoyant une ligne (`invoice_number: 'INV/2026/00001'`, `outstanding > 0`) et `canRecord/canCancel=false`, asserter que `screen.getByTestId('inv-pdf-<order_number>')` existe et que le texte `INV/2026/00001` est rendu. Suivre le pattern des smokes BO existants (`ExportButtons.smoke.test.tsx` pour le wrapper QueryClient/mock).

- [ ] **Step 7 : Lancer typecheck + smokes**

```bash
pnpm typecheck
pnpm --filter @breakery/app-backoffice test btob
```
Expected : typecheck exit 0 ; smokes verts (dont le nouveau).

- [ ] **Step 8 : Commit**

```bash
git add apps/backoffice/src/features/reports/hooks/useGeneratePdf.ts apps/backoffice/src/features/btob/
git commit -m "feat(b2b): Invoice PDF button + repoint create_b2b_order_v4 (S68)"
```

---

## Task 8 : Closeout (ancres money-path + suite + INDEX)

**Files:**
- Modify: `packages/supabase/src/types.generated.ts` (re-vérifier no-drift)
- Create: `docs/workplan/plans/2026-07-08-session-68-INDEX.md`
- Modify: `docs/workplan/remise-a-plat/09-b2b-wholesale.md` (cocher D2 facture PDF)

- [ ] **Step 1 : Re-passer les ancres money-path (live)**

Run (MCP `execute_sql`) successivement : `supabase/tests/b2b_settlement.test.sql`, `supabase/tests/b2b_display_aware_stock.test.sql`, `supabase/tests/s44_money_gates.test.sql`. Expected : toutes vertes, `num_failed = 0`. Repointer toute suite qui référence `create_b2b_order_v3` en dur vers v4.

- [ ] **Step 2 : Suite b2b_invoice complète + suite monorepo**

Run (MCP `execute_sql`) : `supabase/tests/b2b_invoice.test.sql` complet → vert. Puis :
```bash
pnpm typecheck && pnpm build && pnpm test
```
Expected : typecheck exit 0, build OK, test exit 0.

- [ ] **Step 3 : Vérifier no-drift des types**

Run (MCP `generate_typescript_types`) → comparer au fichier committé (`git diff --stat packages/supabase/src/types.generated.ts`). Expected : aucun diff (déjà regénéré Task 5). Si diff → committer.

- [ ] **Step 4 : INDEX de session + cocher la fiche 09**

Créer `docs/workplan/plans/2026-07-08-session-68-INDEX.md` (résumé, migrations `_129..133`, déviations éventuelles DEV-S68-xx, dettes). Dans `docs/workplan/remise-a-plat/09-b2b-wholesale.md` §D2, cocher « Facture PDF B2B » comme livrée (S68) + note de mise à jour en tête. Mettre à jour `docs/workplan/remise-a-plat/00-INDEX.md` §3 Vague 2 (ligne « Facture PDF B2B » → ✅ SOLDÉ).

- [ ] **Step 5 : Commit + finishing-a-development-branch**

```bash
git add docs/
git commit -m "docs(s68): session-68 INDEX + fiche 09 D2 facture PDF soldée"
```
Puis invoquer `superpowers:finishing-a-development-branch` pour décider merge/PR + bump `CLAUDE.md` Active Workplan.

---

## Self-Review — couverture du spec

- Spec §5.1 (schéma) → Task 1 ✅ · §5.2 (v4) → Task 2 ✅ · §5.3 (backfill) → Task 3 ✅ · §5.4 (get_b2b_invoice_v1) → Task 4 ✅ · §5.5 (template) → Task 6 ✅ · §5.6 (BO) → Task 7 ✅ · §5.7 (types+tests) → Tasks 5/8 ✅ · vue invoice_number → Task 5 ✅.
- Décisions §2 : format `INV/YYYY/NNNNN` (Task 1), attribution à la création v4 (Task 2), no-PB1 (Task 6 totaux sans taxe), backfill voided inclus (Task 3).
- Hors-scope §3 : aucun task ne touche prix négociés / cycle livraison / avoirs / adjust_b2b / PB1 B2B. ✅
- Types cohérents : `useDownloadB2bInvoice.download({orderId, invoiceNumber, orderNumber})` (Task 7 Step 2) consommé identiquement Task 7 Step 4 ✅ ; template `B2bInvoiceData` = shape de `get_b2b_invoice_v1` (Task 4) ✅.
- Placeholder résiduel assumé : Task 2 Step 2 exige de câbler la fixture sur le pattern `b2b_settlement.test.sql` (asserts réels décrits, pas de code inventé sur une fixture non lue) — l'implémenteur lit la suite existante avant d'écrire.
