# Session 44 — Money-Path Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** implémenter la spec [`2026-06-13-session-44-money-path-hardening-spec.md`](../../specs/archive/2026-06-13-session-44-money-path-hardening-spec.md) — JE par méthode de paiement réelle (P0-A), routage des variantes vers les stations (P0-B), montants money-path recalculés server-side (P0-C : promo/loyalty/discount-append/change), hygiène `pickedUpOrderId`/`clear()` (P1-A/B), symétrie `display_stock` v8 + void (P1-C), enveloppe de replay honnête (OPP-1).

**Architecture :** Wave A = fondations DB (helper multiplier, corrective JE CASE + seeds, pgTAP trigger-level). Wave B = bumps RPC (`complete_order_with_payment_v12`, `pay_existing_order_v8`, `fire_counter_order_v2`) + types regen + EF + call-sites client. Wave C = front (station map variantes, hygiène cartStore, loyalty depuis l'enveloppe serveur). Wave D = corrective void `display_stock` + vérif reversal RPCs. Wave E = E2E + sweeps + closeout.

**Tech stack :** React 18 + TanStack Query + Zustand (POS), Supabase cloud V3 dev `ikcyvlovptebroadgtvd` via MCP (`apply_migration`/`execute_sql`/`deploy_edge_function`/`generate_typescript_types`), pgTAP en enveloppe `BEGIN...ROLLBACK`, Vitest, Playwright. **Jamais** de Docker local.

**Branche :** `swarm/session-44`. Commits conventionnels, squash-merge par wave possible.

**Prérequis exécution :**
- `mcp list_migrations` → vérifier que le dernier NAME-block est `20260627000016` ; ce plan utilise `20260628000010..017`.
- Baseline tests connue : suites live env-gated (S25 DEV-S25-2.A-02) échouent sans `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` ; 2 fichiers POS flake waitFor sous charge (signature S42/S43, verts isolés). Ne pas confondre avec des régressions.
- Enum réel `payment_method` = `cash | card | qris | edc | transfer | store_credit` (vérifié `20260503000000_init_extensions_enums.sql`). Re-confirmer en live au début de Wave A : `SELECT unnest(enum_range(NULL::payment_method));`.

**Faits vérifiés dont le plan dépend (re-vérifier si le doute surgit, fichiers lus le 2026-06-13) :**
- `trg_create_sale_journal_entry_{ins,upd}` : `AFTER INSERT|UPDATE OF status ... FOR EACH ROW WHEN (NEW.status='paid' ...)` — fire à la fin de l'**instruction**, pas du commit (`20260603000014:170-182`). Seuls ces 2 triggers écoutent `status='paid'` sur `orders`.
- v11 : INSERT `orders` en `'paid'` l.393 ; bloc « loyalty JE append » (lit `journal_entries` ref `sale`) l.≈438 ; items loop + stock + display l.≈500-527 ; `promotion_applications` l.529-540 ; `order_payments` l.542-554 ; redeem/earn l.556-600 (`FLOOR(v_total * p_loyalty_multiplier / 1000)` l.≈571). Signature 17 args dont `p_loyalty_multiplier numeric DEFAULT 1.0` (pos. 14) et `p_manager_pin text` (pos. 17).
- v7 : `UPDATE orders SET status='paid', paid_at=now()...` l.312 ; loyalty JE append l.≈360 ; `promotion_applications` puis `order_payments` l.≈370-395 ; earn `p_loyalty_multiplier` l.≈412. **Aucun bloc `display_stock`** (vérifié : zéro occurrence). Signature 13 args dont `p_loyalty_multiplier DECIMAL(4,2) DEFAULT 1.0` (pos. 11).
- `evaluate_promotions_v1(p_cart_items JSONB, p_customer_id UUID DEFAULT NULL, p_subtotal NUMERIC DEFAULT NULL)` retourne `{applied_promotions: [{promotion_id, slug, name, type, discount_amount, description, free_items}], subtotal_before, subtotal_after_discount, total_discount}` (`20260517000082:316-343`). Le client (`useEvaluatePromotions.ts:137-196`) envoie `p_cart_items = [{line_id, product_id, quantity, unit_price}]` **en excluant les lignes `is_promo_gift`** et `p_subtotal` = somme non-gift.
- Wire client → serveur : `PromotionWirePayload { promotion_id, amount, description, scope_line_id? }` (`useCheckout.ts:11-16`). Le serveur compare donc client `amount` ↔ serveur `discount_amount`.
- `get_loyalty_tier(INT)` SQL IMMUTABLE existe (S12, `20260514000001`) ; multipliers TS : bronze 1.0 / silver(≥500) 1.05 / gold(≥2000) 1.1 / platinum(≥5000) 1.2 (`packages/domain/src/loyalty/tiers.ts`). `customer_categories.points_multiplier DECIMAL(4,2)` existe (`20260509000001:16`).
- `fire_counter_order_v1(p_client_uuid UUID, p_session_id UUID, p_items JSONB, p_order_id UUID, p_table_number TEXT, p_order_type order_type)` (`20260627000011`) — gate `pos.sale.create` seul ; items portent `discount_amount` optionnel ; REVOKE pair inline.
- Domain `Discount { type, value, amount, reason, authorized_by? }` (`packages/domain/src/discounts/types.ts`) — les lignes remisées du cart portent `authorized_by`.
- `void_order_rpc_v2` (`20260619000030:99-112`) remonte `current_stock` mais pas `display_stock` ; gate `status='paid'` only.
- cartStore : `pickedUpOrderId` resets **uniquement** init (l.170) + `resetCartAfterCheckout` (l.487) ; persisté sessionStorage (partialize l.444). `clear()` (l.221-239) garde `...s.cart` (donc customerId/tableNumber) + lignes locked (invariant K3). `voidOrder` (l.241-253) ne touche pas `pickedUpOrderId`. `restoreCart` (l.326-337) le préserve.
- `useProducts.ts:33` filtre `.is('parent_product_id', null)` ; `useFireToStations.ts:97` (firableCount) et `:186-188` (routage au fire) construisent la station map depuis `['products']`.
- EF `process-payment` : `userClient.rpc('complete_order_with_payment_v11', {...})` l.188 ; mapping P0001 par message l.240-248.

---

## Hors scope (acté en spec §3 — ne pas implémenter)

Backfill JE historiques (V3 dev non-prod, décision owner), ledger store credit, KDS ventes directes, append post-pickup tablette, reçu honnête / split receipt / filets realtime / close-shift gardé / tables completed / persist tablette (backlog §7 de la spec).

## Décisions owner à faire valider AU MERGE (ne bloquent pas l'exécution)

1. Mapping comptable D2 : `card`/`edc` → compte du mapping `SALE_PAYMENT_DEBIT`, `transfer` → nouveau mapping `SALE_PAYMENT_TRANSFER` → compte 1112 Bank Operating, `store_credit` → fallback cash assumé V1.
2. Pas de backfill des JE historiques.

---

# WAVE A — Fondations DB (P0-A partie trigger + helper multiplier)

### Task A1 : migration `_010` — helper `get_loyalty_multiplier` + tests de sync

**Files:**
- Create: migration MCP `20260628000010_create_get_loyalty_multiplier_helper` (+ miroir `supabase/migrations/20260628000010_create_get_loyalty_multiplier_helper.sql`)
- Test: `packages/domain/src/loyalty/__tests__/tiers-multipliers.test.ts` (create)
- Test: assertions pgTAP dans `supabase/tests/s44_money_gates.test.sql` (amorcé ici, complété en Wave B)

- [ ] **Step 1 : vérifier la base de numérotation**

Via MCP `list_migrations` : le dernier NAME-block doit être `20260627000016`. Si un NAME-block `20260628*` existe déjà, décaler tout le plan d'un cran et noter la déviation.

- [ ] **Step 2 : écrire le test domain qui pinne la table TS**

```ts
// packages/domain/src/loyalty/__tests__/tiers-multipliers.test.ts
// S44 D4 — pinne la table TIERS côté TS. Le miroir SQL get_loyalty_multiplier
// (migration 20260628000010) pinne les mêmes valeurs en pgTAP : si l'une des
// deux tables bouge sans l'autre, un des deux tests casse (pattern sync S19
// pin-strength).
import { describe, it, expect } from 'vitest';
import { TIERS } from '../tiers.js';

describe('loyalty tier multipliers (S44 SQL mirror contract)', () => {
  it('pins the 4-tier multiplier table', () => {
    expect(TIERS.map((t) => [t.tier, t.min, t.points_multiplier])).toEqual([
      ['bronze', 0, 1.0],
      ['silver', 500, 1.05],
      ['gold', 2000, 1.1],
      ['platinum', 5000, 1.2],
    ]);
  });
});
```

Run: `pnpm --filter @breakery/domain test tiers-multipliers` → PASS immédiat (c'est un pin, pas du TDD rouge — le rouge est côté SQL si la table dérive).

- [ ] **Step 3 : appliquer la migration via MCP `apply_migration`**

`project_id='ikcyvlovptebroadgtvd'`, `name='create_get_loyalty_multiplier_helper'` :

```sql
-- 20260628000010_create_get_loyalty_multiplier_helper.sql
-- Session 44 / Wave A / D4 : miroir SQL de packages/domain/src/loyalty/tiers.ts
-- (même pattern que get_loyalty_tier, S12 20260514000001). Consommé par
-- complete_order_with_payment_v12 + pay_existing_order_v8 pour résoudre le
-- multiplier de points server-side (P0-C : l'arg client p_loyalty_multiplier
-- disparaît des signatures).

CREATE OR REPLACE FUNCTION get_loyalty_multiplier(p_lifetime_points INT)
RETURNS NUMERIC
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_lifetime_points >= 5000 THEN 1.2
    WHEN p_lifetime_points >= 2000 THEN 1.1
    WHEN p_lifetime_points >=  500 THEN 1.05
    ELSE 1.0
  END::NUMERIC
$$;

COMMENT ON FUNCTION get_loyalty_multiplier IS
  'Session 44. Mirrors packages/domain/src/loyalty/tiers.ts points_multiplier. '
  'If you change one side, change the other (pinned by tiers-multipliers.test.ts + s44_money_gates pgTAP).';

-- REVOKE pair par cohérence (helper pur, pas de raison d'exposition anon).
REVOKE EXECUTE ON FUNCTION get_loyalty_multiplier(INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_loyalty_multiplier(INT) FROM anon;
GRANT EXECUTE ON FUNCTION get_loyalty_multiplier(INT) TO authenticated;
```

Écrire le même contenu dans le fichier miroir `supabase/migrations/20260628000010_create_get_loyalty_multiplier_helper.sql`.

- [ ] **Step 4 : vérifier en live + amorcer le pgTAP**

Via MCP `execute_sql` :

```sql
SELECT get_loyalty_multiplier(0), get_loyalty_multiplier(499), get_loyalty_multiplier(500),
       get_loyalty_multiplier(2000), get_loyalty_multiplier(5000);
-- attendu : 1.0 | 1.0 | 1.05 | 1.1 | 1.2
```

Créer `supabase/tests/s44_money_gates.test.sql` avec l'en-tête standard (copier la structure de `supabase/tests/counter_fire.test.sql` : enveloppe BEGIN/ROLLBACK, `SELECT plan(N)`, claims simulées via `set_config('request.jwt.claims', ...)`) et les 5 premières assertions :

```sql
SELECT is(get_loyalty_multiplier(0),    1.0::numeric, 'T1 bronze floor');
SELECT is(get_loyalty_multiplier(499),  1.0::numeric, 'T2 bronze ceiling');
SELECT is(get_loyalty_multiplier(500),  1.05::numeric, 'T3 silver boundary');
SELECT is(get_loyalty_multiplier(2000), 1.1::numeric, 'T4 gold boundary');
SELECT is(get_loyalty_multiplier(5000), 1.2::numeric, 'T5 platinum boundary');
```

Exécuter le fichier via MCP `execute_sql` (enveloppe BEGIN...ROLLBACK) → 5/5 PASS.

- [ ] **Step 5 : commit**

```bash
git add supabase/migrations/20260628000010_create_get_loyalty_multiplier_helper.sql supabase/tests/s44_money_gates.test.sql packages/domain/src/loyalty/__tests__/tiers-multipliers.test.ts
git commit -m "feat(db): session 44 — wave A — get_loyalty_multiplier SQL mirror of tiers.ts (D4)"
```

### Task A2 : migration `_011` — corrective `create_sale_journal_entry` (CASE enum réel + audit fallback) + seeds mapping + pgTAP trigger-level

**Files:**
- Create: migration MCP `20260628000011_fix_sale_je_method_mapping` (+ miroir local)
- Create: `supabase/tests/s44_je_by_method.test.sql`

Contexte : le CASE actuel mappe `'debit_card'`/`'credit_card'` (valeurs inexistantes) → `card`/`edc`/`transfer` tombent en cash. Le fallback « no order_payments rows » est silencieux. Le **séquencement** (payments insérés après le statut) est traité en Wave B — cette task rend le trigger correct *quand* les payments existent, ce qui est testable indépendamment (INSERT pending → payments → UPDATE paid).

- [ ] **Step 1 : inventorier les mapping keys existants**

Via MCP `execute_sql` :

```sql
SELECT mapping_key, account_code FROM accounting_mappings
 WHERE mapping_key LIKE 'SALE_PAYMENT%' OR mapping_key LIKE '%BANK%';
```

Attendu (S26) : `SALE_PAYMENT_CASH`, `SALE_PAYMENT_QRIS`, `SALE_PAYMENT_DEBIT`, `SALE_PAYMENT_CREDIT_CARD`, `B2B_PAYMENT_BANK` (1112), `CASH_MOVEMENT_BANK` (1112). Noter les comptes réels — la migration seed `SALE_PAYMENT_TRANSFER` → `'1112'` seulement s'il n'existe pas.

- [ ] **Step 2 : écrire le pgTAP qui échoue (trigger-level, sans RPC)**

`supabase/tests/s44_je_by_method.test.sql` — structure BEGIN/ROLLBACK + plan + fixtures (copier le pattern fixtures/claims de `supabase/tests/counter_fire.test.sql` : profil + session POS + produit). Cas :

```sql
-- T1 : ordre inséré pending_payment, 1 payment qris, UPDATE → paid
--      ⇒ la JE 'sale' a une ligne débit sur le compte du mapping SALE_PAYMENT_QRIS
--      et AUCUNE ligne 'fallback to cash'.
-- T2 : idem avec method 'card' ⇒ ligne débit sur compte SALE_PAYMENT_DEBIT.
-- T3 : idem 'edc' ⇒ compte SALE_PAYMENT_DEBIT.
-- T4 : idem 'transfer' ⇒ compte SALE_PAYMENT_TRANSFER (1112).
-- T5 : split cash 20000 + qris 15000 ⇒ 2 lignes débit (20000 cash, 15000 qris),
--      somme débits = total, JE équilibrée.
-- T6 : ordre paid SANS payments (B2B legacy path) ⇒ fallback cash PRÉSENT
--      + 1 ligne audit_logs action='je.payment_fallback_cash'.
-- T7 : non-régression void : UPDATE paid→voided ⇒ JE 'sale_void' split par méthode.
```

Squelette d'un cas (T1) — les autres suivent le même moule :

```sql
DO $$
DECLARE v_order_id UUID; v_acc UUID; v_n INT;
BEGIN
  INSERT INTO orders (order_number, session_id, served_by, order_type, status, subtotal, tax_amount, total, created_via)
    VALUES ('#T1JE', current_setting('s44.session_id')::uuid, current_setting('s44.profile_id')::uuid,
            'take_out', 'pending_payment', 35000, 3182, 35000, 'pos')
    RETURNING id INTO v_order_id;
  INSERT INTO order_payments (order_id, method, amount) VALUES (v_order_id, 'qris', 35000);
  UPDATE orders SET status='paid', paid_at=now() WHERE id = v_order_id;

  SELECT account_id INTO v_acc FROM accounting_mappings am
    JOIN chart_of_accounts c ON c.code = am.account_code WHERE am.mapping_key='SALE_PAYMENT_QRIS';
  SELECT count(*) INTO v_n FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id
    WHERE je.reference_type='sale' AND je.reference_id=v_order_id
      AND jel.account_id = v_acc AND jel.debit = 35000;
  PERFORM set_config('s44.t1_pass', (v_n = 1)::text, true);
END $$;
SELECT ok(current_setting('s44.t1_pass')::boolean, 'T1 QRIS sale debits the QRIS account');
```

> Note : adapter le join `accounting_mappings` → `chart_of_accounts` à la forme réelle de `resolve_mapping_account` (lire son corps via `pg_get_functiondef` si le schéma diffère). Exécuter la suite via MCP `execute_sql` → T1-T5 doivent FAIL (tout part en cash aujourd'hui), T6/T7 état présent.

- [ ] **Step 3 : appliquer la migration `_011`**

Contenu : recopier intégralement le `CREATE OR REPLACE FUNCTION create_sale_journal_entry()` de `20260603000014` et modifier **4 blocs** (les 2 CASE + les 2 fallbacks, branches paid et voided). Les triggers ne sont PAS recréés (la fonction est remplacée en place). En tête :

```sql
-- 20260628000011_fix_sale_je_method_mapping.sql
-- Session 44 / Wave A / P0-A(b) + D2 : le CASE mappait debit_card/credit_card,
-- valeurs INEXISTANTES dans l'enum payment_method (cash|card|qris|edc|transfer|
-- store_credit) → card/edc/transfer tombaient dans le ELSE cash. Le fallback
-- "no order_payments rows" devient observable (audit_logs je.payment_fallback_cash).
-- Le séquencement statut-après-payments est traité par les bumps v12/v8 (_012/_014).

INSERT INTO accounting_mappings (mapping_key, account_code, description) VALUES
  ('SALE_PAYMENT_TRANSFER', '1112', 'Sale paid by bank transfer → DR Bank Operating')
ON CONFLICT (mapping_key) DO NOTHING;
```

Nouveau CASE (×2, branche paid et branche voided — remplacer les deux occurrences à l'identique) :

```sql
      v_mapping := CASE v_pay.method
        WHEN 'cash'         THEN 'SALE_PAYMENT_CASH'
        WHEN 'qris'         THEN 'SALE_PAYMENT_QRIS'
        WHEN 'card'         THEN 'SALE_PAYMENT_DEBIT'
        WHEN 'edc'          THEN 'SALE_PAYMENT_DEBIT'
        WHEN 'transfer'     THEN 'SALE_PAYMENT_TRANSFER'
        WHEN 'store_credit' THEN 'SALE_PAYMENT_CASH'  -- D2 : pas de ledger d'avoirs V1, assumé
        ELSE 'SALE_PAYMENT_CASH'
      END;
```

Nouveau fallback branche paid (l'équivalent voided reçoit le même INSERT audit avec `'direction','reversal'`) :

```sql
    IF NOT EXISTS (SELECT 1 FROM order_payments WHERE order_id = NEW.id) THEN
      v_acc_id := resolve_mapping_account('SALE_PAYMENT_CASH');
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
        VALUES (v_je_id, v_acc_id, NEW.total, 0,
          'Payment receipt (no order_payments rows — fallback to cash)');
      -- S44 : le fallback était le chemin NOMINAL avant le fix de séquencement v12/v8
      -- (P0-A). Désormais anormal hors B2B credit → trace observable.
      INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
        VALUES (NEW.served_by, 'je.payment_fallback_cash', 'orders', NEW.id,
                jsonb_build_object('order_number', NEW.order_number, 'total', NEW.total,
                                   'direction', 'sale'));
    END IF;
```

Appliquer via MCP `apply_migration` + écrire le miroir local.

- [ ] **Step 4 : re-run pgTAP**

`s44_je_by_method.test.sql` via `execute_sql` → 7/7 PASS. Si `audit_logs.actor_id` a une contrainte FK/NOT NULL incompatible avec `NEW.served_by` NULL (ordres B2B système), utiliser `COALESCE(NEW.served_by, NEW.created_by)` ou tracer la déviation.

- [ ] **Step 5 : commit**

```bash
git add supabase/migrations/20260628000011_fix_sale_je_method_mapping.sql supabase/tests/s44_je_by_method.test.sql
git commit -m "fix(db): session 44 — wave A — sale JE method CASE matches real enum + observable cash fallback (P0-A b)"
```

---

# WAVE B — Bumps RPC (P0-A séquencement, P0-C, OPP-1, P1-C v8) + EF + clients

> Les 3 bumps suivent le même mode opératoire : `SELECT pg_get_functiondef('public.<fn>'::regprocedure)` via MCP pour obtenir le corps EXACT déployé, copie dans la nouvelle migration, application des block-edits listés (chaque edit donne l'ancre à trouver et le SQL de remplacement complet), `DROP FUNCTION <old>` en tête (idiome DO-block S37), REVOKE pair S25 en migration séparée (3 lignes distinctes — DEV-S43-P11-01).

### Task B1 : migrations `_012` + `_013` — `complete_order_with_payment_v12`

**Files:**
- Create: migrations MCP `20260628000012_bump_complete_order_v12` + `20260628000013_revoke_anon_complete_order_v12` (+ miroirs locaux)
- Modify: `supabase/tests/s44_money_gates.test.sql` (cas T6+)

- [ ] **Step 1 : récupérer le corps v11 déployé**

MCP `execute_sql` : `SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname='complete_order_with_payment_v11';` — comparer avec `supabase/migrations/20260621000010` (doit matcher, S43 n'a pas retouché v11).

- [ ] **Step 2 : écrire les cas pgTAP qui échouent (gates v12)**

Ajouter à `s44_money_gates.test.sql` (fixtures : produit à 35 000, promo percentage 10 % active all-days, client avec `lifetime_points=600` catégorie `points_multiplier=2.0`) :

```sql
-- T6  : v12 avec p_promotions [{promotion_id: <promo>, amount: 35000}] (forgé,
--       vrai montant = 3500) ⇒ ERREUR 'Promotion amount mismatch%'.
-- T7  : v12 avec amount exact 3500 ⇒ PASS, promotion_applications.amount = 3500.
-- T8  : v12 client silver(600 pts)×cat 2.0 sur total 31500 ⇒
--       orders.loyalty_points_earned = FLOOR(31500 * 1.05 * 2.0 / 1000) = 66
--       (la signature n'a plus p_loyalty_multiplier — rien à forger).
-- T9  : v12 tender cash amount=35000, cash_received=50000, change_given=20000 (forgé,
--       vrai change = 15000) ⇒ ERREUR 'Invalid change amount%'.
-- T10 : v12 tender qris avec change_given=5000 ⇒ ERREUR 'Invalid change amount%'.
-- T11 : v12 happy-path cash ⇒ JE 'sale' SANS ligne fallback (P0-A séquencement,
--       les payments existent au moment du trigger) + ligne débit compte cash.
-- T12 : replay v12 (même p_idempotency_key) ⇒ envelope.change_given = 15000
--       et envelope.loyalty_points_earned = valeur du 1er appel (OPP-1).
-- T13 : non-régression : v12 sans promo/client/discount ⇒ ok, display_stock
--       décrémenté si is_display_item (bloc v11 conservé).
```

Pour appeler le RPC sous un user simulé, copier le pattern claims+`set_config('request.jwt.claims', ...)` de `supabase/tests/counter_fire.test.sql`. Run → FAIL (v12 n'existe pas).

- [ ] **Step 3 : migration `_012` — block-edits sur la copie du corps v11**

En-tête + DROP :

```sql
-- 20260628000012_bump_complete_order_v12.sql
-- Session 44 / Wave B / P0-A(a) + P0-C(1,2,4) + OPP-1.
-- v11 → v12 :
--   1. P0-A : INSERT orders en 'pending_payment' (paid_at NULL) ; status='paid'
--      + paid_at posés par un UPDATE FINAL après les inserts order_payments →
--      le trigger JE voit les payments et split par méthode (sinon fallback cash à 100 %).
--      Conséquence : le bloc "loyalty JE append" (lit la JE 'sale') migre APRÈS cet UPDATE.
--   2. P0-C(1) : montant promo recalculé via evaluate_promotions_v1 — mismatch = reject.
--   3. P0-C(2) : p_loyalty_multiplier SUPPRIMÉ de la signature ; multiplier résolu
--      via get_loyalty_multiplier(lifetime_points) × customer_categories.points_multiplier.
--   4. P0-C(4) : change_given revalidé (cash : = cash_received - amount ; non-cash : 0/NULL).
--   5. OPP-1 : enveloppe replay reconstruit change_given + loyalty_points_earned.
-- Versioning monotone : DROP v11 dans la même migration.

DO $drop$
DECLARE _r RECORD;
BEGIN
  FOR _r IN SELECT oid::regprocedure AS sig FROM pg_proc
    WHERE proname = 'complete_order_with_payment_v11' AND pronamespace = 'public'::regnamespace
  LOOP EXECUTE 'DROP FUNCTION ' || _r.sig::text || ' CASCADE'; END LOOP;
END $drop$;
```

**Edit 1 — signature.** `complete_order_with_payment_v12(...)` : reprendre les 17 args de v11 **moins** `p_loyalty_multiplier numeric DEFAULT 1.0` (16 args, ordre inchangé par ailleurs). Déclarer en plus :

```sql
  v_loyalty_multiplier   NUMERIC := 1.0;
  v_server_eval          JSONB;
  v_server_amount        DECIMAL(14,2);
  v_eval_items           JSONB;
```

**Edit 2 — replay (ancre : `'change_given',      NULL,`).** Remplacer le `jsonb_build_object` du replay par :

```sql
        SELECT jsonb_build_object(
          'order_id',          o.id,
          'order_number',      o.order_number,
          'subtotal',          o.subtotal,
          'tax_amount',        o.tax_amount,
          'total',             o.total,
          'change_given',      (SELECT COALESCE(SUM(op.change_given), 0)
                                  FROM order_payments op WHERE op.order_id = o.id),
          'loyalty_points_earned', COALESCE(o.loyalty_points_earned, 0),
          'loyalty_balance_after', (SELECT c.loyalty_points FROM customers c WHERE c.id = o.customer_id),
          'idempotent_replay', true
        ) FROM orders o WHERE o.id = v_order_id
```

**Edit 3 — validation des tenders (ancre : la boucle `FOR v_payment_entry IN SELECT * FROM jsonb_array_elements(v_payments_arr) LOOP` de la PHASE VALIDATION, celle qui calcule `v_pay_sum`).** Ajouter dans le corps de la boucle, après l'extraction de `v_pay_change` :

```sql
    v_pay_method := (v_payment_entry->>'method')::payment_method;
    -- S44 P0-C(4) : le change n'est plus une valeur de confiance.
    IF v_pay_method = 'cash' THEN
      IF v_pay_cash_recv IS NOT NULL THEN
        IF v_pay_cash_recv < v_pay_amount AND v_pay_idx = v_pay_count THEN
          RAISE EXCEPTION 'Invalid change amount: cash_received (%) < amount (%)',
            v_pay_cash_recv, v_pay_amount USING ERRCODE = 'check_violation';
        END IF;
        IF COALESCE(v_pay_change, 0) <> GREATEST(v_pay_cash_recv - v_pay_amount, 0) THEN
          RAISE EXCEPTION 'Invalid change amount: change_given (%) != cash_received - amount (%)',
            COALESCE(v_pay_change, 0), GREATEST(v_pay_cash_recv - v_pay_amount, 0)
            USING ERRCODE = 'check_violation';
        END IF;
      ELSIF COALESCE(v_pay_change, 0) <> 0 THEN
        RAISE EXCEPTION 'Invalid change amount: change without cash_received'
          USING ERRCODE = 'check_violation';
      END IF;
    ELSIF COALESCE(v_pay_change, 0) <> 0 THEN
      RAISE EXCEPTION 'Invalid change amount: non-cash tender cannot give change'
        USING ERRCODE = 'check_violation';
    END IF;
```

(`v_pay_method` est déjà déclaré dans v11. Conserver la garde intermédiaire existante `cash_received cannot exceed amount` si présente dans cette boucle.)

**Edit 4 — recompute promo (ancre : `v_promotion_total := v_promotion_total + v_promo_amount;` dans la boucle promo, l.≈344).** Juste AVANT la boucle `FOR v_promo IN ... p_promotions`, insérer l'évaluation serveur :

```sql
    -- S44 P0-C(1) : évalue côté serveur avec le MÊME payload que le client
    -- (useEvaluatePromotions exclut les lignes is_promo_gift et passe le
    -- subtotal non-gift) puis matche chaque promo cliente par promotion_id.
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'line_id',    COALESCE(item->>'line_id', ''),
             'product_id', item->>'product_id',
             'quantity',   (item->>'quantity')::numeric,
             'unit_price', (item->>'unit_price')::numeric)), '[]'::jsonb)
      INTO v_eval_items
      FROM jsonb_array_elements(p_items) AS item
      WHERE COALESCE((item->>'is_promo_gift')::boolean, false) = false;

    v_server_eval := evaluate_promotions_v1(
      p_cart_items  := v_eval_items,
      p_customer_id := p_customer_id,
      p_subtotal    := v_items_total
    );
```

Puis dans la boucle, remplacer la ligne d'accumulation par :

```sql
      SELECT (sp->>'discount_amount')::DECIMAL(14,2) INTO v_server_amount
        FROM jsonb_array_elements(v_server_eval->'applied_promotions') sp
        WHERE (sp->>'promotion_id')::uuid = v_promo_id
        LIMIT 1;
      IF v_server_amount IS NULL THEN
        RAISE EXCEPTION 'Promotion amount mismatch: % not applicable to this cart', v_promo_record.slug
          USING ERRCODE = 'check_violation';
      END IF;
      IF v_server_amount <> v_promo_amount THEN
        RAISE EXCEPTION 'Promotion amount mismatch: % (client %, server %)',
          v_promo_record.slug, v_promo_amount, v_server_amount
          USING ERRCODE = 'check_violation';
      END IF;
      v_promotion_total := v_promotion_total + v_promo_amount;
```

> ⚠️ Vérification obligatoire avant de figer cet edit : relire `useEvaluatePromotions.ts` `cartToRpcPayload` (l.126-150) et `v_items_total` dans v11 — `v_items_total` doit être le subtotal **non-gift** (les gifts sont à prix 0, donc neutres ; si v11 inclut leurs lignes à 0 dans `v_items_total`, le montant est identique — OK). Si `p_subtotal` du client diverge de `v_items_total` (remises ligne déduites ou non), aligner sur ce que le client envoie réellement — sinon les promos threshold divergent. Tracer la décision en INDEX.

**Edit 5 — séquencement statut (ancre : `INSERT INTO orders (` ... `'paid',`).** Dans l'INSERT, remplacer `'paid'` par `'pending_payment'` et `p_idempotency_key, now(), p_table_number,` par `p_idempotency_key, NULL, p_table_number,` (colonne `paid_at`). Puis **déplacer** le bloc « loyalty JE append » (celui qui fait `v_loyalty_liab_id := resolve_mapping_account('LOYALTY_LIABILITY')` et lit `journal_entries WHERE reference_type='sale'`) : le couper de sa position actuelle (entre l'INSERT orders et la boucle items) et le réinsérer APRÈS le nouveau UPDATE ci-dessous. Insérer juste APRÈS la boucle `FOR v_payment_entry ... INSERT INTO order_payments ... END LOOP;` :

```sql
  -- S44 P0-A(a) : le statut paid est posé EN DERNIER, payments déjà insérés →
  -- trg_create_sale_journal_entry_upd split la JE par méthode réelle.
  UPDATE orders SET status = 'paid', paid_at = now(), updated_at = now()
    WHERE id = v_order_id;

  -- (bloc loyalty JE append déplacé ici — il lit la JE créée par le trigger ci-dessus)
```

**Edit 6 — multiplier (ancre : `v_points_earned := FLOOR(v_total * p_loyalty_multiplier / 1000);`).** Juste avant le bloc earn, insérer :

```sql
  IF p_customer_id IS NOT NULL THEN
    SELECT get_loyalty_multiplier(c.lifetime_points) * COALESCE(cc.points_multiplier, 1.0)
      INTO v_loyalty_multiplier
      FROM customers c
      LEFT JOIN customer_categories cc ON cc.id = c.category_id
      WHERE c.id = p_customer_id;
  END IF;
```

et remplacer la ligne earn par `v_points_earned := FLOOR(v_total * v_loyalty_multiplier / 1000);`.

**Edit 7 — métadonnées.** Dans les `audit_logs` `order.discount_applied` / `order.complete` : `'rpc_version', 'v12'`. COMMENT ON FUNCTION final décrivant les 5 changements. Adapter le COMMENT à la nouvelle liste d'args (16).

Appliquer `_012` via MCP. Puis `_013` :

```sql
-- 20260628000013_revoke_anon_complete_order_v12.sql
-- REVOKE pair canonique S25 (3 lignes distinctes — DEV-S43-P11-01).
GRANT EXECUTE ON FUNCTION complete_order_with_payment_v12(uuid, order_type, jsonb, jsonb, uuid, uuid, integer, text, numeric, text, numeric, text, uuid, jsonb, jsonb, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION complete_order_with_payment_v12(uuid, order_type, jsonb, jsonb, uuid, uuid, integer, text, numeric, text, numeric, text, uuid, jsonb, jsonb, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION complete_order_with_payment_v12(uuid, order_type, jsonb, jsonb, uuid, uuid, integer, text, numeric, text, numeric, text, uuid, jsonb, jsonb, text) FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;
```

(Ajuster la liste de types à la signature réelle après l'Edit 1 — la vérifier via `\df` / `pg_get_function_identity_arguments`.)

- [ ] **Step 4 : re-run pgTAP**

`s44_money_gates.test.sql` T6-T13 via `execute_sql` → PASS. `s44_je_by_method.test.sql` re-run → toujours 7/7 (le trigger n'a pas bougé). Vérifier aussi en live qu'un appel v12 nominal n'écrit AUCUN audit `je.payment_fallback_cash`.

- [ ] **Step 5 : commit**

```bash
git add supabase/migrations/20260628000012_bump_complete_order_v12.sql supabase/migrations/20260628000013_revoke_anon_complete_order_v12.sql supabase/tests/s44_money_gates.test.sql
git commit -m "feat(db): session 44 — wave B — complete_order_with_payment_v12 (status-after-payments, promo recompute, DB multiplier, change gate, honest replay)"
```

### Task B2 : migrations `_014` + `_015` — `pay_existing_order_v8`

**Files:**
- Create: migrations MCP `20260628000014_bump_pay_existing_order_v8` + `20260628000015_revoke_anon_pay_existing_order_v8` (+ miroirs)
- Create: `supabase/tests/s44_display_symmetry.test.sql`
- Modify: `supabase/tests/s44_money_gates.test.sql` (cas v8)

- [ ] **Step 1 : pgTAP qui échoue**

`s44_display_symmetry.test.sql` (fixtures : produit `is_display_item=true` avec ligne `display_stock` à 10) :

```sql
-- T1 : ordre comptoir fired (INSERT orders pending_payment + order_items) payé via v8
--      ⇒ display_stock 10 → 10-qty ET display_movements row 'sale' ET
--      stock_movements 'sale' (non-régression).
-- T2 : produit NON display payé via v8 ⇒ display_stock intact (pas de ligne fantôme).
-- T3 : (Wave D le complètera) placeholder void.
```

Cas v8 dans `s44_money_gates.test.sql` :

```sql
-- T14 : v8 promo amount forgé ⇒ 'Promotion amount mismatch%'.
-- T15 : v8 change forgé sur tender cash ⇒ 'Invalid change amount%'.
-- T16 : v8 points = FLOOR(total × multiplier_DB / 1000) (signature sans p_loyalty_multiplier).
-- T17 : v8 happy-path ⇒ JE 'sale' split par méthode réelle (qris), AUCUN fallback cash.
-- T18 : v8 replay ⇒ change_given + loyalty_points_earned réels dans l'enveloppe.
```

Run → FAIL (v8 absent).

- [ ] **Step 2 : migration `_014` — block-edits sur la copie du corps v7**

Mêmes edits que B1, transposés (corps via `pg_get_functiondef('public.pay_existing_order_v7'::regprocedure)`) :

1. **Signature** : `pay_existing_order_v8`, 13 args v7 **moins** `p_loyalty_multiplier DECIMAL(4,2) DEFAULT 1.0` (12 args). DROP v7 en tête (DO-block). Déclarer `v_loyalty_multiplier NUMERIC := 1.0; v_server_eval JSONB; v_server_amount DECIMAL(14,2); v_eval_items JSONB;`.
2. **Replay** (ancre `'change_given',` dans le bloc idempotency en tête) : même remplacement que B1 Edit 2 (sur `o.id = v_order.id`).
3. **Validation tenders** : même bloc que B1 Edit 3 (la boucle de validation existe déjà avec `v_pay_method` absent — le déclarer `v_pay_method payment_method;`).
4. **Recompute promo** : même logique que B1 Edit 4, mais `v_eval_items` se construit depuis `order_items` :

```sql
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'line_id',    oi.id::text,
             'product_id', oi.product_id::text,
             'quantity',   oi.quantity,
             'unit_price', oi.unit_price)), '[]'::jsonb)
      INTO v_eval_items
      FROM order_items oi
      WHERE oi.order_id = p_order_id
        AND oi.is_cancelled = false
        AND oi.is_promo_gift = false;
```

   (`order_items.is_promo_gift` existe — `20260511000003:15`.) `p_subtotal := v_items_total` comme v7 le calcule déjà.
5. **Séquencement** : l'`UPDATE orders SET status='paid', paid_at=now(), ...` actuel (l.≈312, qui pose AUSSI customer/discount/subtotal/total) est scindé : garder cet UPDATE à sa place pour toutes les colonnes **sauf** `status`/`paid_at` (le passer en `status = status` ou simplement retirer les deux colonnes), et ajouter après la boucle `order_payments` :

```sql
  -- S44 P0-A(a) : statut paid posé après les payments → JE split par méthode.
  UPDATE orders SET status = 'paid', paid_at = now(), updated_at = now()
    WHERE id = p_order_id;
```

   **Déplacer le bloc « loyalty JE append »** (`LOYALTY_LIABILITY`, l.≈360 — il lit la JE 'sale' créée par le trigger) APRÈS ce nouvel UPDATE. Vérifier qu'aucun autre bloc entre les deux ne lit `orders.status` (lecture du corps obligatoire à l'exécution).
6. **Bloc display** (P1-C) : dans la boucle stock existante (`FOR v_item IN SELECT oi.product_id, oi.quantity, ... FOR UPDATE OF p`), après l'`UPDATE products SET current_stock ...`, insérer le miroir exact du bloc v11 :

```sql
    IF (SELECT is_display_item FROM products WHERE id = v_item.product_id) THEN
      INSERT INTO display_movements (
        product_id, movement_type, quantity, reason, reference_type, reference_id, created_by
      ) VALUES (
        v_item.product_id, 'sale', -v_item.quantity, 'POS sale (pay existing)', 'order', p_order_id, v_profile_id
      );
      UPDATE display_stock
        SET quantity = quantity - v_item.quantity, updated_at = now()
        WHERE product_id = v_item.product_id;
    END IF;
```

7. **Multiplier** : même bloc que B1 Edit 6 (sur `p_customer_id`), earn → `v_loyalty_multiplier`.
8. **Métadonnées** : `'rpc_version','v8'`, COMMENT à jour. Gate S43 `_016` (`draft` OU `pending_payment`+`created_via='pos'`) : NE PAS toucher — vérifier qu'il est bien dans le corps récupéré par `pg_get_functiondef` (c'est la version `_016`, pas celle du fichier `20260621000012`).

Puis `_015` REVOKE pair (même gabarit que `_013`, signature 12 args réelle).

- [ ] **Step 3 : re-run pgTAP** → T14-T18 + display T1-T2 PASS.

- [ ] **Step 4 : commit**

```bash
git add supabase/migrations/20260628000014_bump_pay_existing_order_v8.sql supabase/migrations/20260628000015_revoke_anon_pay_existing_order_v8.sql supabase/tests/s44_display_symmetry.test.sql supabase/tests/s44_money_gates.test.sql
git commit -m "feat(db): session 44 — wave B — pay_existing_order_v8 (status-after-payments, display_stock parity, promo/multiplier/change gates, honest replay)"
```

### Task B3 : migration `_016` — `fire_counter_order_v2` (gate discount append)

**Files:**
- Create: migration MCP `20260628000016_bump_fire_counter_order_v2` (+ miroir)
- Modify: `supabase/tests/s44_money_gates.test.sql`

- [ ] **Step 1 : pgTAP qui échoue**

```sql
-- T19 : fire v2 avec un item discount_amount=5000 et p_discount_authorized_by NULL
--       ⇒ ERREUR 'Discount requires an authorizing manager' (check_violation).
-- T20 : idem avec p_discount_authorized_by = profil CASHIER (sans sales.discount)
--       ⇒ ERREUR 'Authorizer lacks permission: sales.discount'.
-- T21 : idem avec profil MANAGER ⇒ PASS, order_items.discount_amount=5000,
--       audit_logs 'order.discount_applied' avec authorized_by + rpc 'fire_v2'.
-- T22 : fire v2 sans discount, p_discount_authorized_by NULL ⇒ PASS (chemin nominal intact).
-- T23 : replay idempotent v2 (même p_client_uuid) ⇒ pas de double insert (non-régression).
```

- [ ] **Step 2 : migration `_016`**

Copier le corps v1 (`pg_get_functiondef`), renommer v2, **ajouter l'arg** `p_discount_authorized_by UUID DEFAULT NULL` en fin de signature, DROP v1 en tête (DO-block sur `fire_counter_order_v1`). Après le gate `pos.sale.create` existant, insérer :

```sql
  -- S44 P0-C(3) : une remise de LIGNE appendée post-fire échappait au gate PIN
  -- S43 (fire v1 ne gatait que pos.sale.create). Même règle que v11/v12 :
  -- toute remise exige un autorisateur porteur de sales.discount.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_items) it
    WHERE COALESCE((it->>'discount_amount')::DECIMAL(12,2), 0) > 0
  ) THEN
    IF p_discount_authorized_by IS NULL THEN
      RAISE EXCEPTION 'Discount requires an authorizing manager' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT has_permission_for_profile(p_discount_authorized_by, 'sales.discount') THEN
      RAISE EXCEPTION 'Authorizer lacks permission: sales.discount' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
```

(`has_permission_for_profile` est l'helper profil-id utilisé par `void_order_rpc_v2` — `20260619000030:65`. S'il attend un auth_user_id et non un profile_id, utiliser la même résolution que v11 fait pour `p_discount_authorized_by` : lire le bloc S37 SEC-01 de v11 et répliquer.) Après la boucle items, si remise présente, émettre l'audit :

```sql
  IF p_discount_authorized_by IS NOT NULL THEN
    INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
      VALUES (v_profile_id, 'order.discount_applied', 'orders', v_order_id,
              jsonb_build_object('authorized_by', p_discount_authorized_by,
                                 'source', 'fire_counter_append', 'rpc_version', 'fire_v2'));
  END IF;
```

> Note : v1 n'a pas de variable `v_profile_id` (il n'utilise que `v_user_id := auth.uid()`) — résoudre le profil comme v11 (`SELECT id FROM user_profiles WHERE auth_user_id = v_user_id`) ou réutiliser ce que v1 fait déjà pour `created_by`. Lire le corps réel avant de figer.

REVOKE pair inline en queue de migration (3 lignes distinctes, signature 7 args `(UUID, UUID, JSONB, UUID, TEXT, order_type, UUID)`).

- [ ] **Step 3 : re-run pgTAP** → T19-T23 PASS. Commit :

```bash
git add supabase/migrations/20260628000016_bump_fire_counter_order_v2.sql supabase/tests/s44_money_gates.test.sql
git commit -m "feat(db): session 44 — wave B — fire_counter_order_v2 gates appended line discounts (P0-C 3)"
```

### Task B4 : types regen + EF `process-payment` + call-sites client + classifyCheckoutError

**Files:**
- Modify: `packages/supabase/src/types.generated.ts` (regen MCP)
- Modify: `supabase/functions/process-payment/index.ts:188-200` (v12) + `:240-248` (mapping erreurs)
- Modify: `apps/pos/src/features/payment/hooks/useCheckout.ts` (v8 + fire v2 + drop multiplier)
- Modify: `apps/pos/src/features/cart/hooks/useFireToStations.ts` (fire v2 + authorizer)
- Modify: `packages/domain/src/orders/buildOrderPayload.ts` (drop multiplier du payload EF)
- Modify: `apps/pos/src/features/payment/hooks/retryClassifier.ts` (2 nouveaux codes)
- Test: smokes existants à étendre (`apps/pos/src/__tests__/pay-existing.smoke.test.tsx`, `retryClassifier`)

- [ ] **Step 1 : regen types**

MCP `generate_typescript_types` → écrire dans `packages/supabase/src/types.generated.ts`. Vérifier que `complete_order_with_payment_v12`, `pay_existing_order_v8`, `fire_counter_order_v2` y figurent et que v11/v7/v1 ont disparu. `pnpm --filter @breakery/supabase typecheck`.

- [ ] **Step 2 : EF `process-payment`**

Dans `supabase/functions/process-payment/index.ts` :
- l.188 : `userClient.rpc('complete_order_with_payment_v12', {...})` ; **supprimer** la ligne qui forwarde le multiplier (grep `loyalty_multiplier` dans le fichier — la retirer du spread d'args ET de l'interface du body si typée).
- Bloc mapping (l.240-248) — ajouter AVANT le fallback `no_open_session` :

```ts
      if (msg.includes('Promotion amount mismatch')) {
        return jsonResponse({ error: 'promo_amount_mismatch', message: msg }, 409);
      }
      if (msg.includes('Invalid change amount')) {
        return jsonResponse({ error: 'invalid_change', message: msg }, 409);
      }
```

- Redeploy via MCP `deploy_edge_function` (`process-payment`). Vérifier la version déployée via `list_edge_functions`.

- [ ] **Step 3 : `buildOrderPayload` + `useCheckout`**

- `buildOrderPayload.ts` : retirer le paramètre multiplier du payload EF (champ `loyalty_multiplier` du JSON) et le paramètre `cumulLoyaltyMultiplier`/équivalent de la signature ; mettre à jour ses tests unitaires co-localisés (`packages/domain/src/orders/__tests__/`). Laisser `resolveLoyaltyMultiplier` mort de côté (P3 backlog) ou le supprimer s'il n'a plus aucun appelant — vérifier par grep.
- `useCheckout.ts` :
  - supprimer les l.65-68 (tier/categoryMultiplier/multiplier) et la passe `p_loyalty_multiplier` (l.141) ;
  - l.156 : `supabase.rpc('pay_existing_order_v8', args as PayExistingOrderArgs)` + l.8 : type `Database['public']['Functions']['pay_existing_order_v8']['Args']` ;
  - l.107 : `supabase.rpc('fire_counter_order_v2', {...})` et ajouter au payload d'append l'autorisateur des lignes remisées :

```ts
          const appendAuthorizer = unsynced.find((i) => i.discount?.authorized_by)?.discount?.authorized_by;
          const { error: appendErr } = await supabase.rpc('fire_counter_order_v2', {
            p_client_uuid: appendUuidRef.current.uuid,
            p_session_id: sessionId,
            p_items: unsynced.map((i) => ({
              product_id: i.product_id,
              quantity: i.quantity,
              unit_price: i.unit_price,
              modifiers: i.modifiers,
              ...(i.discount ? { discount_amount: i.discount.amount } : {}),
            })) as unknown as Json,
            p_order_id: pickedUpOrderId,
            ...(appendAuthorizer ? { p_discount_authorized_by: appendAuthorizer } : {}),
          });
```

  - l.187-195 : retirer `multiplier` de l'appel `buildOrderPayload` (aligner sur la nouvelle signature).

- [ ] **Step 4 : `useFireToStations` (fire manuel) + `retryClassifier`**

- `useFireToStations.ts` : bump `fire_counter_order_v1` → `fire_counter_order_v2` (grep l'appel `.rpc('fire_counter_order_v1'`) et passer le même `p_discount_authorized_by` dérivé des items à persister (`toPersist.find((i) => i.discount?.authorized_by)?...`).
- `retryClassifier.ts` : ajouter les cases `promo_amount_mismatch` (fatal, copy FR « La promotion a changé — réévaluez le panier avant d'encaisser ») et `invalid_change` (fatal, « Montant de monnaie invalide — recommencez le paiement »), à côté des cases S43 `discount_requires_authorizer`/`account_locked` (l.≈144-150).

- [ ] **Step 5 : tests + sweeps ciblés**

```bash
pnpm --filter @breakery/domain test orders        # buildOrderPayload sans multiplier
pnpm --filter @breakery/app-pos test retryClassifier
pnpm --filter @breakery/app-pos test pay-existing # bump v8 mocké
pnpm typecheck
```

Adapter les mocks des smokes qui stubaient `pay_existing_order_v7`/`fire_counter_order_v1`/`complete_order_with_payment_v11` (grep ces 3 noms dans `apps/pos/src` et `supabase/functions` → 0 résultat hors migrations/tests legacy attendu en fin de step).

- [ ] **Step 6 : commit**

```bash
git add packages/supabase/src/types.generated.ts supabase/functions/process-payment/index.ts apps/pos/src packages/domain/src/orders apps/pos/src/features/payment/hooks/retryClassifier.ts
git commit -m "feat(pos): session 44 — wave B — bump callers to v12/v8/fire_v2, drop client multiplier, map new fatal codes"
```

---

# WAVE C — Front (P0-B variantes, P1-A/B hygiène, D4 affichage loyalty)

### Task C1 : `useStationMap` — routage stations incluant les variantes (P0-B)

**Files:**
- Create: `apps/pos/src/features/cart/hooks/useStationMap.ts`
- Modify: `apps/pos/src/features/cart/hooks/useFireToStations.ts:23-30` (buildStationMap), `:95-99` (firableCount), `:184-192` (routage au fire)
- Test: `apps/pos/src/features/cart/__tests__/station-map-variants.smoke.test.tsx` (create)

- [ ] **Step 1 : test qui échoue**

```tsx
// apps/pos/src/features/cart/__tests__/station-map-variants.smoke.test.tsx
// S44 P0-B : une ligne panier issue d'une VARIANTE (product_id enfant, absent du
// cache ['products'] qui filtre parent_product_id IS NULL) doit quand même être
// routée vers sa station — sinon ticket amputé + firableCount=0 sur panier
// 100 % variantes (bouton Send to Kitchen mort).
// Moule : copier le harness de rendering/mocks du smoke test existant de
// useFireToStations (S43) — mock supabase.from('products') pour renvoyer
// [{ id: 'variant-child-1', categories: { dispatch_station: 'barista' } }] sur la
// query station-map, et un cart contenant UNE ligne product_id='variant-child-1'.
import { describe, it, expect } from 'vitest';
// T1 : useStationMap expose { 'variant-child-1': 'barista' }.
// T2 : firableCount (hook useFireToStations) === 1 avec ce cart.
// T3 : groupItemsByStation(items, map) place la ligne sous 'barista' (unit, import direct domain).
```

(Écrire T1-T3 réels avec le harness du fichier S43 `apps/pos/src/features/cart/__tests__/*fire*.smoke.test.tsx` — même renderHook/QueryClientProvider.) Run : `pnpm --filter @breakery/app-pos test station-map-variants` → FAIL.

- [ ] **Step 2 : implémenter `useStationMap`**

```ts
// apps/pos/src/features/cart/hooks/useStationMap.ts
// S44 P0-B — map product_id → dispatch_station SANS le filtre
// parent_product_id IS NULL de useProducts : la grille doit cacher les enfants
// variantes (design S27c), mais le routage cuisine doit les connaître — une
// ligne VariantSelectModal porte le product_id de l'ENFANT.
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { DispatchStation } from '@breakery/domain';
import { supabase } from '@/lib/supabase';

export const STATION_MAP_KEY = ['station-map'] as const;

type Row = { id: string; categories: { dispatch_station: string | null } | null };

async function fetchStationMap(): Promise<Record<string, DispatchStation>> {
  const res = await supabase
    .from('products')
    .select('id, categories(dispatch_station)')
    .eq('is_active', true)
    .is('deleted_at', null);
  if (res.error) throw res.error;
  const map: Record<string, DispatchStation> = {};
  for (const row of (res.data ?? []) as Row[]) {
    map[row.id] = (row.categories?.dispatch_station ?? 'none') as DispatchStation;
  }
  return map;
}

export function useStationMap() {
  return useQuery({ queryKey: STATION_MAP_KEY, queryFn: fetchStationMap, staleTime: 60_000 });
}

/** Lecture cache au moment du fire (mutation) — même filet que S43 (cache live, pas closure). */
export async function getStationMap(qc: QueryClient): Promise<Record<string, DispatchStation>> {
  return qc.ensureQueryData({ queryKey: STATION_MAP_KEY, queryFn: fetchStationMap, staleTime: 60_000 });
}
```

(Vérifier le type `DispatchStation` exporté par `@breakery/domain` — sinon réutiliser le type local de `useFireToStations`.)

- [ ] **Step 3 : câbler `useFireToStations`**

- Render path (firableCount, l.95-99) : remplacer `buildStationMap(products ?? [])` par le résultat de `useStationMap()` (`stationMap = stationMapQuery.data ?? {}`) — la sémantique « map vide pendant le chargement → bouton désactivé » est conservée.
- Fire path (l.184-192) : remplacer `queryClient.getQueryData<Product[]>(['products'])` + `buildStationMap(cachedProducts)` par `await getStationMap(queryClient)`. Supprimer `buildStationMap` si plus aucun appelant.
- Vérifier l'auto-fire post-paiement (`printOnly`) : il passe par la même mutation → couvert.

- [ ] **Step 4 : re-run tests**

`pnpm --filter @breakery/app-pos test station-map-variants` PASS + smoke fire S43 existants toujours verts (`pnpm --filter @breakery/app-pos test fire`).

- [ ] **Step 5 : commit**

```bash
git add apps/pos/src/features/cart/hooks/useStationMap.ts apps/pos/src/features/cart/hooks/useFireToStations.ts apps/pos/src/features/cart/__tests__/station-map-variants.smoke.test.tsx
git commit -m "fix(pos): session 44 — wave C — station map includes variant children (P0-B, ticket amputé/bouton mort)"
```

### Task C2 : hygiène cartStore — `pickedUpOrderId` + `clear()` contexte (P1-A/B)

**Files:**
- Modify: `apps/pos/src/stores/cartStore.ts:221-239` (clear), `:241-253` (voidOrder)
- Modify: `apps/pos/src/features/cart/HeldOrdersModal.tsx:135-152` (garde restore)
- Test: `apps/pos/src/stores/__tests__/cartStore.context-hygiene.test.ts` (create) + étendre `cartStore.void.test.ts`

- [ ] **Step 1 : tests qui échouent**

```ts
// apps/pos/src/stores/__tests__/cartStore.context-hygiene.test.ts
// S44 P1-A/B — cycle de vie pickedUpOrderId + purge contexte client/table.
import { describe, it, expect, beforeEach } from 'vitest';
import { useCartStore, resetCartAfterCheckout } from '../cartStore';

describe('cartStore context hygiene (S44)', () => {
  beforeEach(() => resetCartAfterCheckout());

  it('voidOrder clears pickedUpOrderId (P1-A: void of a fired order must not route the next cart to the voided order)', () => {
    useCartStore.getState().setPickedUpOrderId('order-1');
    useCartStore.getState().voidOrder();
    expect(useCartStore.getState().pickedUpOrderId).toBeNull();
  });

  it('clear() with no locked items purges customer + table + attachedCustomer (P1-B)', () => {
    const s = useCartStore.getState();
    s.attachCustomer({ id: 'cust-A', name: 'A', lifetime_points: 0 } as never);
    s.setTableNumber('T-05');
    s.clear();
    const after = useCartStore.getState();
    expect(after.cart.customerId).toBeUndefined();
    expect(after.cart.tableNumber).toBeUndefined();
    expect(after.attachedCustomer).toBeNull();
  });

  it('clear() WITH locked items keeps the context (same in-flight fired order)', () => {
    const s = useCartStore.getState();
    // arranger : 1 item locké (utiliser add + markLocked comme dans cartStore.networkSplit.test.ts)
    // + customer/table attachés → clear() → contexte conservé, item locké conservé (K3).
  });
});
```

(Compléter le 3ᵉ cas avec les helpers d'arrangement du fichier `cartStore.networkSplit.test.ts` — mêmes fixtures `add`/`markLocked`. Adapter les noms exacts d'actions à `cartStore.ts` : `attachCustomer` vs `setAttachedCustomer` — vérifier avant d'écrire.) Run → FAIL (2 premiers cas).

- [ ] **Step 2 : implémenter dans `cartStore.ts`**

`voidOrder` — ajouter le reset dans l'objet retourné :

```ts
      voidOrder: () =>
        set((s) => {
          const { cartDiscount: _cd, loyaltyPointsToRedeem: _l, ...rest } = s.cart;
          return {
            cart: { ...rest, items: [] },
            lockedItemIds: [],
            printedItemIds: [],
            appliedPromotions: [],
            dismissedPromotionIds: new Set<string>(),
            // S44 P1-A : un void d'ordre fired NE doit PAS laisser le prochain
            // panier router en append/pay vers l'ordre voidé (P0002 en boucle,
            // persisté en sessionStorage → reload inopérant).
            pickedUpOrderId: null,
          };
        }),
```

`clear()` — purge conditionnelle :

```ts
      clear: () =>
        set((s) => {
          const lockedItems = s.cart.items.filter((i) => s.lockedItemIds.includes(i.id));
          const hasLocked = lockedItems.length > 0;
          // S44 P1-B : sans ligne fired en cours, le contexte client/table doit
          // partir avec le panier — sinon la vente suivante crédite points et
          // prix catégorie au client précédent (Hold → panier "vide" → vente).
          const { customerId: _c, tableNumber: _t, ...restCart } = s.cart;
          return {
            cart: { ...(hasLocked ? s.cart : restCart), items: lockedItems },
            appliedPromotions: [],
            dismissedPromotionIds: new Set<string>(),
            printedItemIds: s.printedItemIds.filter((id) => s.lockedItemIds.includes(id)),
            ...(hasLocked ? {} : { attachedCustomer: null }),
          };
        }),
```

(Si le store a aussi `customerName` côté cart, le purger dans le même destructuring — vérifier les champs réels de `Cart`.)

- [ ] **Step 3 : garde restore dans `HeldOrdersModal.tsx`**

À côté de la garde `cartHasItems` existante (l.147), ajouter :

```tsx
  const pickedUpOrderId = useCartStore((s) => s.pickedUpOrderId);
  // S44 P1-A : restaurer un held PENDANT un ordre fired appenderait les items du
  // held à l'ordre fired au checkout (le client paierait l'union des deux).
  // L'ordre fired est en DB : il doit être payé ou voidé d'abord.
```

et dans le handler de restore (avant `restore.mutateAsync`) :

```tsx
    if (pickedUpOrderId) {
      toast.error('Finish or void the current fired order before restoring a held one.');
      return;
    }
```

(Reprendre le mécanisme exact de la garde `cartHasItems` — si elle désactive le bouton plutôt qu'un toast, faire pareil : cohérence UI.)

- [ ] **Step 4 : re-run**

`pnpm --filter @breakery/app-pos test context-hygiene` PASS + non-régression : `pnpm --filter @breakery/app-pos test cartStore` (void/networkSplit/golden-path) + `pnpm --filter @breakery/app-pos test held`.

- [ ] **Step 5 : commit**

```bash
git add apps/pos/src/stores/cartStore.ts apps/pos/src/stores/__tests__/cartStore.context-hygiene.test.ts apps/pos/src/features/cart/HeldOrdersModal.tsx
git commit -m "fix(pos): session 44 — wave C — pickedUpOrderId lifecycle + clear() context purge (P1-A/B)"
```

### Task C3 : points fidélité affichés = enveloppe serveur (D4 front)

**Files:**
- Modify: `apps/pos/src/features/payment/hooks/useCheckout.ts:32-40` (CheckoutResponse) + retours des 2 branches
- Modify: `apps/pos/src/features/payment/hooks/usePaymentFlowLogic.ts:168-175` (setSuccess)
- Modify: `apps/pos/src/features/payment/SuccessModal.tsx` (prop `loyaltyBalanceAfter` enfin alimentée)
- Modify: `packages/domain` type `PaymentResult` (+2 champs optionnels)
- Test: étendre le smoke SuccessModal/paymentFlow existant

- [ ] **Step 1 : test qui échoue** — dans le smoke payment-flow existant (grep `pointsEarned` dans `apps/pos/src/__tests__/` et `features/payment/__tests__/`), stub du checkout renvoyant `loyalty_points_earned: 66, loyalty_balance_after: 666` → asserter que le SuccessModal reçoit `pointsEarned=66` et `loyaltyBalanceAfter=666` (et PAS le recalcul `earnPointsForCustomer`).

- [ ] **Step 2 : implémenter**

- `PaymentResult` (domain) : `loyalty_points_earned?: number; loyalty_balance_after?: number;`.
- `useCheckout` : les deux branches lisent l'enveloppe (`envelope.loyalty_points_earned`, `envelope.loyalty_balance_after` côté v8 ; `body.loyalty_points_earned`, `body.loyalty_balance_after` côté EF — v12 les renvoie, étendre `CheckoutResponse`) et les forwardent dans le `return`.
- `usePaymentFlowLogic.dispatchCheckout` :

```ts
      setSuccess({
        orderNumber: result.order_number,
        total: result.total,
        changeGiven: result.change_given,
        pointsEarned: result.loyalty_points_earned ?? 0,
        ...(result.loyalty_balance_after != null ? { loyaltyBalanceAfter: result.loyalty_balance_after } : {}),
        customerName: attachedCustomer?.name ?? undefined,
        paymentMethod: tendersToShip[0]!.method,
      });
```

  Supprimer l'import/appel `earnPointsForCustomer` s'il n'a plus d'appelant ici (grep avant suppression — il sert peut-être ailleurs).
- `PaymentTerminal.tsx` (ou le composant qui rend `<SuccessModal>`) : passer `loyaltyBalanceAfter={success.loyaltyBalanceAfter}` (le type du state `success` s'étend en conséquence).

- [ ] **Step 3 : re-run + commit**

```bash
pnpm --filter @breakery/app-pos test payment && pnpm typecheck
git add apps/pos/src packages/domain/src
git commit -m "fix(pos): session 44 — wave C — loyalty points on success/receipt come from the server envelope (D4)"
```

---

# WAVE D — Corrective void `display_stock` (P1-C reversal)

### Task D1 : migration `_017` + vérification cancel-item / refund + pgTAP

**Files:**
- Create: migration MCP `20260628000017_fix_reversal_rpcs_display_stock` (+ miroir)
- Modify: `supabase/tests/s44_display_symmetry.test.sql` (T3+)

- [ ] **Step 1 : auditer les 3 RPCs de reversal**

Via `pg_get_functiondef` : `void_order_rpc_v2`, `cancel_item_rpc_*` (grep le nom exact dans `supabase/functions/cancel-item/index.ts`), `refund_order_rpc_v2`. Pour chacun, vérifier : restaure `current_stock` ? touche `display_stock` ? Consigner le résultat dans le message de commit + l'INDEX (déviation si cancel/refund sont aussi troués — le fix s'applique alors aux trois dans `_017`).

- [ ] **Step 2 : pgTAP T3-T5 qui échouent**

```sql
-- T3 : vente v12 d'un is_display_item (display 10→9) puis void_order_rpc_v2
--      ⇒ display_stock revient à 10 + display_movements row 'sale_void' (+1).
-- T4 : void d'un produit NON display ⇒ aucune ligne display fantôme.
-- T5 : (si trou confirmé au Step 1) idem refund partiel / cancel-item.
```

- [ ] **Step 3 : migration `_017` — pattern corrective S38**

DO-block `pg_get_functiondef` + replace (signatures inchangées) sur `void_order_rpc_v2` : dans la boucle de restore (`FOR v_item IN SELECT id, product_id, quantity FROM order_items ... LOOP`), après l'`UPDATE products SET current_stock = current_stock + v_item.quantity`, insérer :

```sql
    -- S44 P1-C : la vente (v11/v12/v8) décrémente display_stock pour les
    -- produits vitrine — le reversal doit le rétablir, sinon dérive permanente
    -- du compteur qui pilote le sold-out S43.
    IF (SELECT is_display_item FROM products WHERE id = v_item.product_id) THEN
      INSERT INTO display_movements (
        product_id, movement_type, quantity, reason, reference_type, reference_id, created_by
      ) VALUES (
        v_item.product_id, 'sale_void', v_item.quantity, 'Order voided', 'order', p_order_id, v_profile_id
      );
      UPDATE display_stock
        SET quantity = quantity + v_item.quantity, updated_at = now()
        WHERE product_id = v_item.product_id;
    END IF;
```

(Vérifier que l'enum/CHECK de `display_movements.movement_type` accepte `'sale_void'` — sinon utiliser la valeur de reversal existante du domaine display, lire la table/contraintes via `execute_sql` avant de figer. Idem pour les colonnes exactes.) Étendre aux 2 autres RPCs si le Step 1 a confirmé le trou (même bloc, référence adaptée).

- [ ] **Step 4 : re-run pgTAP** → `s44_display_symmetry.test.sql` complet PASS. Commit :

```bash
git add supabase/migrations/20260628000017_fix_reversal_rpcs_display_stock.sql supabase/tests/s44_display_symmetry.test.sql
git commit -m "fix(db): session 44 — wave D — reversal RPCs restore display_stock (P1-C)"
```

---

# WAVE E — E2E + sweeps + closeout

### Task E1 : E2E Playwright `s44-money-path.spec.ts`

**Files:**
- Create: `tests/e2e/s44-money-path.spec.ts` (moule : `tests/e2e/s43-pos-audit-fixes.spec.ts` — login partagé rate-limit 3/min/IP, garde console)

- [ ] **Step 1 : écrire les 3 tests**

- **T1 — JE par méthode (P0-A)** : login PIN → vente 1 produit → paiement **QRIS** → puis via `execute_sql` (helper du spec S43) : la JE `reference_type='sale'` du nouvel ordre a une ligne débit sur le compte du mapping `SALE_PAYMENT_QRIS` et zéro ligne `fallback to cash`.
- **T2 — variante routée (P0-B)** : tap un produit à variantes → choisir une variante → Send to Kitchen → assert bouton actif + ordre créé (`pending_payment`) + l'`order_items.dispatch_station` de la ligne variante ≠ 'none' ; payer le même ordre (non-régression S43 T3).
- **T3 — hygiène void (P1-A)** : fire comptoir → Void Order (PIN) → nouvelle vente directe → succès **sans reload** (pas de P0002), `pickedUpOrderId` purgé (nouvel ordre ≠ ancien).

- [ ] **Step 2 : run** `npx playwright test tests/e2e/s44-money-path.spec.ts` → 3/3 PASS (dev server + V3 dev). Nettoyer les données de test créées (pattern cleanup S41/S43).

- [ ] **Step 3 : commit** `test(e2e): session 44 — money-path E2E (JE QRIS, variant fire, void hygiene)`.

### Task E2 : sweeps + revue + closeout

- [ ] **Step 1 : suites complètes**

```bash
pnpm --filter @breakery/domain test
pnpm --filter @breakery/ui test
pnpm --filter @breakery/app-pos test
pnpm --filter @breakery/backoffice test   # toucherait types.generated — vérifier 0 régression
pnpm typecheck
```

Baselines connues exclues (env-gated S25, flakes waitFor S42/S43 — re-run isolé si doute). Re-run pgTAP des 3 suites S44 + non-régression `counter_fire.test.sql` 11/11 + `order_discount_gate` 10/10 via MCP.

- [ ] **Step 2 : pattern-guardian**

Lancer l'agent `pattern-guardian` sur le diff de la branche (read-only). Attendu 14/14 — points d'attention : REVOKE pairs 3-lignes (`_013`/`_015`/`_016`), versioning monotone (DROP v11/v7/v1 dans les migrations de bump), aucun `INSERT INTO stock_movements` direct hors RPC.

- [ ] **Step 3 : INDEX + CLAUDE.md**

Créer `docs/workplan/plans/2026-06-13-session-44-INDEX.md` (déviations numérotées DEV-S44-*, statut par task, hors-scope) ; à la fin de session, bump du bullet « Active Workplan » + « Migration sequence active » dans `CLAUDE.md` (NAME-block `20260628000010..017`). PR `swarm/session-44` → master, squash.

---

## Self-review (fait à la rédaction)

- **Couverture spec** : D1→B1/B2 (séquencement) ; D2→A2 ; D3→B1/B2 (Edit 4) ; D4→A1+B1/B2 (Edit 6)+B4+C3 ; D5→B3+B4 ; D6→B1/B2 (Edit 3) ; D7→C1 ; D8→C2 ; D9→C2 ; D10→B2 (Edit 6 display)+D1 ; D11→B1/B2 (Edit 2) ; D12→B4. Critères d'acceptation 1-7 ↔ pgTAP A2/B + smokes C + E2E E1 + sweeps E2.
- **Ancres vs corps déployé** : les numéros de ligne viennent des fichiers de migration git ; chaque task de bump commence par `pg_get_functiondef` pour travailler sur le corps RÉEL (S43 `_016` a déjà modifié v7 — c'est la version cloud qui fait foi, pas `20260621000012`).
- **Points de vigilance signalés in-task** : payload `evaluate_promotions_v1` (gift lines / subtotal — B1 Edit 4 ⚠️), `has_permission_for_profile` vs auth_user_id (B3), enum `display_movements.movement_type` (D1), champs réels de `Cart`/actions du store (C2), prop `loyaltyBalanceAfter` du composant parent (C3).
