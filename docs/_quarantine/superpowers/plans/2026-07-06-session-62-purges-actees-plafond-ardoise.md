# Session 62 — Purges actées + plafond ardoise serveur : Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** Solder le lot « purges actées » (décisions propriétaire 2026-07-06 : mesh LAN mort, `print_queue` statuée → purge, remises de palier, `vite-plugin-pwa`, `rbac.update`) et livrer le **plafond de crédit ardoise retail côté serveur** (décision D4, pattern miroir B2B) via un nouveau RPC `attach_tab_customer_v1` — **sans toucher la money-path** (v17/v11/fire_v4 intacts).

**Architecture :** L'ardoise retail = commande `pending_payment` fired anonyme (total=0, pas de client). On n'ajoute PAS le client au fire (ça bumperait `fire_counter_order_v4`, ancre money-path) : un RPC dédié `attach_tab_customer_v1` pose `customer_id` + total provisoire (Σ `order_items.line_total`) sur la commande, sous gate de plafond `customers.retail_credit_limit` (nouvelle colonne, NULL = illimité) avec lock `FOR UPDATE` anti-TOCTOU (pattern S52) et erreur `P0011 credit_limit_exceeded` (miroir B2B). L'ardoise devient alors visible dans `/pos/debts` (`get_pos_b2b_debts_v3` inchangée : `customer_id IS NOT NULL AND outstanding > 0.001`) et payable via le mirror pickup S60 → `pay_existing_order_v11` qui recalcule le vrai total. Les purges sont du delete pur + 3 petites migrations.

**Tech Stack :** pnpm 9.15 + turbo, React/TS (apps/pos, apps/backoffice), Supabase cloud V3 dev `ikcyvlovptebroadgtvd` via MCP (`apply_migration`, `execute_sql`, `generate_typescript_types`), pgTAP via `execute_sql` en enveloppe `BEGIN…ROLLBACK`.

## Global Constraints

- **Money-path INTOUCHABLE** : `complete_order_with_payment_v17`, `pay_existing_order_v11`, `fire_counter_order_v4`, `_record_sale_stock_v1` ne sont PAS modifiés. Ancre `s44_money_gates` 12/12 re-passée live au closeout.
- **Migrations** : numérotation NAME-block monotone — cette session utilise **`20260710000110..112`**. Jamais de `BEGIN;`/`COMMIT;` dans un corps de migration (MCP wrappe déjà). Application via MCP `apply_migration` sur `ikcyvlovptebroadgtvd`, PAS de Docker/local.
- **DEV-S57-02** : toute lecture d'un corps de fonction existant part du LIVE (`SELECT pg_get_functiondef('nom(args)'::regprocedure)` via `execute_sql`), jamais d'un fichier de migration historique.
- **Trio S20 sur tout nouveau RPC** : `REVOKE ALL ... FROM PUBLIC; REVOKE ALL ... FROM anon;` + GRANT explicite + `COMMENT ON FUNCTION`.
- **Types regen obligatoire au closeout** (schéma modifié : DROP table `print_queue`, colonne `retail_credit_limit`, RPC `attach_tab_customer_v1`) → `generate_typescript_types` → `packages/supabase/src/types.generated.ts` commité. Sinon la CI types-regen gate bloque.
- **Lint-ratchet CI** : lint les fichiers ENTIERS touchés vs master, 0 `eslint-disable`. Après chaque tâche frontend : `pnpm --filter <app> exec eslint <fichiers touchés>` et solder ce qui sort.
- **NE PAS CONFONDRE** : `customer_categories.discount_percentage` (tarification par catégorie client, VIP 15 % — VIVANT) ≠ remises de palier fidélité (`TIERS[].discount` — À PURGER). Idem : redemption de points (`SALE_DISCOUNT` compte 4900 dans v17/v11) survit.
- **Heartbeats LAN S59 VIVANTS** : `useLanHeartbeat` (hors branche `send` morte), `posSettingsStore.deviceCode`, page BO LAN Devices, table `lan_devices`, RPC `update_lan_heartbeat_v1` — à GARDER.
- Commits conventionnels, co-auteur `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. Branche : `swarm/session-62`.

---

### Task 1 : Purge du mesh LAN mort (POS + domain)

**Files:**
- Delete: `apps/pos/src/features/lan/lanHub.ts`, `apps/pos/src/features/lan/lanClient.ts`, `apps/pos/src/features/lan/lanHubMessageHandler.ts`, `apps/pos/src/features/lan/hooks/useLanHub.ts`, `apps/pos/src/features/lan/hooks/useLanClient.ts`
- Delete: `apps/pos/src/features/lan/__tests__/lanHub.dedup.test.ts`, `apps/pos/src/features/lan/__tests__/useLanHub.uniqueChannel.test.tsx`, `apps/pos/src/features/lan/__tests__/lan-hub-no-kitchen-chit.smoke.test.tsx`, `apps/pos/src/features/lan/__tests__/lan-hub-typed-client.test.ts`
- Delete: `packages/domain/src/lan/protocol.ts`, `packages/domain/src/lan/messageDedup.ts`, `packages/domain/src/lan/index.ts`, `packages/domain/src/lan/__tests__/messageDedup.test.ts`, `packages/domain/src/lan/__tests__/protocol.test.ts`
- Modify: `apps/pos/src/features/lan/hooks/useLanHeartbeat.ts` (retirer la branche morte AVANT la purge domain), `packages/domain/src/index.ts:44` (retirer `export * from './lan/index.js';`)

**Interfaces:** ne casse rien de consommé — preuve scouting : `useLanHub`/`useLanClient` ne sont importés que par leurs propres tests ; aucun des 3 call-sites de `useLanHeartbeat` (Pos.tsx:94, Kds.tsx:31, TabletLayout.tsx:20) ne passe le param `send`.

- [ ] **Step 1 :** Dans `useLanHeartbeat.ts` : supprimer le param optionnel `send`, le bloc « Broadcast on the LAN mesh » (~lignes 54-62) et les imports `createMessage`/`HeartbeatMessage`/`LanMessage` de `@breakery/domain`. Il ne doit rester que l'appel RPC `update_lan_heartbeat_v1`. NE PAS toucher `useLanHeartbeat.test.ts` ni `pos-lan-heartbeat.smoke.test.tsx` sauf s'ils référencent `send` (adapter alors la cascade minimale).
- [ ] **Step 2 :** Supprimer les 9 fichiers POS listés, puis les 5 fichiers domain + la ligne 44 du barrel `packages/domain/src/index.ts`.
- [ ] **Step 3 :** Vérifier qu'aucun import ne pend : `grep -rn "features/lan/lanHub\|useLanHub\|useLanClient\|lanHubMessageHandler\|domain/src/lan\|from '@breakery/domain'" apps/pos/src packages/domain/src | grep -i "lan"` → seuls hits attendus : `useLanHeartbeat` (RPC seul).
- [ ] **Step 4 :** `pnpm --filter @breakery/domain test && pnpm --filter @breakery/pos test` → exit 0 (les suites lan supprimées ne tournent plus ; `useLanHeartbeat.test` et le smoke passent). `pnpm typecheck` → exit 0.
- [ ] **Step 5 :** Lint-ratchet : `pnpm --filter @breakery/pos exec eslint src/features/lan packages` sur les fichiers modifiés + `pnpm --filter @breakery/domain exec eslint src/index.ts`. Solder toute erreur sans disable.
- [ ] **Step 6 :** Commit : `refactor(pos,domain): purge le mesh LAN mort (décision internet-first 2026-07-06) — heartbeats S59 conservés`

### Task 2 : Purge `print_queue` (table + 5 RPCs + page BO) — migration `_110`

**Files:**
- Create: `supabase/migrations/20260710000110_drop_print_queue.sql`
- Delete: `apps/backoffice/src/features/print-queue/` (tout le dossier : PrintQueueTable.tsx, hooks usePrintQueue/useCancelPrintJob, tests), `apps/backoffice/src/pages/print-queue/PrintQueuePage.tsx` (+ test s'il existe)
- Modify: `apps/backoffice/src/routes/index.tsx` (ligne 88 lazy import + bloc route `path="print-queue"` ~ligne 946), `apps/backoffice/src/layouts/Sidebar.tsx:66` (entrée « Print Queue » + icône `Printer` si devenue orpheline), `packages/supabase/src/rls/permissions.ts:119-120` (retirer `'print_queue.read'` et `'print_queue.manage'`)

**Interfaces:** le vrai chemin d'impression (`apps/pos/src/services/print/printService.ts`, POST direct au print-bridge externe) ne touche PAS `print_queue` — NE PAS le modifier. Décision actée : purge complète (unique écrivain = mesh mort supprimé en Task 1 ; table vérifiée VIDE live le 2026-07-06).

- [ ] **Step 1 :** Migration `20260710000110_drop_print_queue.sql` — garde d'inanité puis drop (adapter les signatures exactes des 5 RPCs depuis le live : `SELECT proname, pg_get_function_identity_arguments(oid) FROM pg_proc WHERE proname LIKE '%print_job%'`) :

```sql
-- S62: purge print_queue (décision internet-first 2026-07-06). Unique écrivain
-- = mesh LAN mort (purgé S62) ; le vrai print passe par le bridge externe en POST direct.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.print_queue) THEN
    RAISE EXCEPTION 'print_queue is not empty — abort drop, investigate first';
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.enqueue_print_job_v1(<args live>);
DROP FUNCTION IF EXISTS public.claim_print_job_v1(<args live>);
DROP FUNCTION IF EXISTS public.mark_print_done_v1(<args live>);
DROP FUNCTION IF EXISTS public.mark_print_failed_v1(<args live>);
DROP FUNCTION IF EXISTS public.cancel_print_job_v1(<args live>);
DROP TABLE IF EXISTS public.print_queue;
DELETE FROM public.permissions WHERE code IN ('print_queue.read', 'print_queue.manage');
```
(Les FK `role_permissions`/`user_permission_overrides` sont ON DELETE CASCADE — un seul DELETE suffit.)

- [ ] **Step 2 :** Appliquer via MCP `apply_migration` (name `drop_print_queue`). Vérifier : `SELECT to_regclass('public.print_queue')` → NULL.
- [ ] **Step 3 :** Purge BO : supprimer dossier + page, retirer lazy import + route + entrée sidebar + les 2 codes de `PermissionCode`. Grep final : `grep -rn "print_queue\|print-queue\|PrintQueue" apps/ packages/ --include="*.ts*"` → 0 hit hors migrations historiques.
- [ ] **Step 4 :** `pnpm --filter @breakery/backoffice test && pnpm typecheck` → exit 0. Lint-ratchet sur routes/index.tsx + Sidebar.tsx + permissions.ts.
- [ ] **Step 5 :** Commit : `refactor(backoffice,db): purge print_queue — table vide, écrivain unique = mesh mort ; le print réel POST directement au bridge (migration _110)`

### Task 3 : Purges légères — remises de palier, `vite-plugin-pwa`, `rbac.update` — migration `_111`

**Files:**
- Modify: `packages/domain/src/loyalty/tiers.ts:4-7` (retirer le champ `discount` des 4 objets TIERS — garder `tier`/`min`/`label`/`points_multiplier` et tout le reste du fichier), `packages/domain/src/loyalty/__tests__/tiers.test.ts:63-68` (supprimer le `it('exposes discount field…')`), le type TS du tier s'il déclare `discount`
- Modify: `apps/pos/package.json:44` (supprimer la devDependency `vite-plugin-pwa`) puis `pnpm install` (le lockfile évacue `vite-plugin-pwa@1.2.0` + l'arbre `workbox-*`)
- Modify: `packages/supabase/src/rls/permissions.ts:71` (retirer `| 'rbac.update'`)
- Create: `supabase/migrations/20260710000111_delete_rbac_update_permission.sql`

**Interfaces:** SURVIVANTS obligatoires — `points_multiplier`, `tierFromLifetime`, `earnPointsForCustomer`, RPCs `get_loyalty_tier`/`get_loyalty_multiplier`, `LoyaltyBadge`, test `tiers-multipliers.test.ts` ; permission `rbac.read` (gate les écrans matrice read-only + 4 policies RLS SELECT).

- [ ] **Step 1 :** tiers.ts + tiers.test.ts : purge du champ `discount`. `pnpm --filter @breakery/domain test loyalty` → vert.
- [ ] **Step 2 :** `vite-plugin-pwa` : retirer la ligne du package.json, `pnpm install`, vérifier `grep -c "vite-plugin-pwa" pnpm-lock.yaml` → 0. `pnpm --filter @breakery/pos build` → vert (le plugin n'était pas dans vite.config.ts, build inchangé).
- [ ] **Step 3 :** Migration `20260710000111_delete_rbac_update_permission.sql` :

```sql
-- S62: RBAC lecture seule assumée (décision propriétaire 2026-07-06) — l'éditeur est ANNULÉ.
-- FK role_permissions/user_permission_overrides ON DELETE CASCADE (20260517000030).
DELETE FROM public.permissions WHERE code = 'rbac.update';
```
Appliquer via MCP. Vérifier `SELECT count(*) FROM permissions WHERE code='rbac.update'` → 0. Retirer `permissions.ts:71`. (Le commentaire cosmétique `20260517000200:32` reste — migration historique, ne pas réécrire.)
- [ ] **Step 4 :** `pnpm typecheck && pnpm --filter @breakery/domain test && pnpm --filter @breakery/pos test` → exit 0. Lint-ratchet sur les fichiers touchés.
- [ ] **Step 5 :** Commit : `refactor(domain,pos,db): purges actées — remises de palier retirées (points_multiplier seul), vite-plugin-pwa évacué, permission rbac.update supprimée (_111)`

### Task 4 : Plafond ardoise serveur — colonne + `attach_tab_customer_v1` + pgTAP — migration `_112`

**Files:**
- Create: `supabase/migrations/20260710000112_retail_tab_credit_gate.sql`
- Create: `supabase/tests/retail_tab_credit_gate.test.sql`

**Interfaces:**
- Consomme : `orders` (`status='pending_payment'`, `created_via='pos'`), `order_items.line_total`, `order_payments`, `business_config.tax_rate`, `round_idr()`.
- Produit : `customers.retail_credit_limit NUMERIC(14,2)` (NULL = illimité, CHECK ≥ 0) ; RPC `attach_tab_customer_v1(p_order_id UUID, p_customer_id UUID) RETURNS JSONB` — succès `{order_id, customer_id, customer_name, total, outstanding_before, credit_limit}` ; erreurs : `order_not_found`/`customer_not_found_or_inactive` (P0002), `order_not_attachable` (P0001), **`credit_limit_exceeded: {json}` (P0011, DETAIL = jsonb)** — miroir exact du contrat B2B de `create_b2b_order_v3`.
- **NE PAS réutiliser `validate_b2b_credit_limit_v1`** (lit `b2b_current_balance` et court-circuite les non-b2b) ; **NE PAS créer de colonne solde retail** (l'encours est calculé live, décision scouting S62).

- [ ] **Step 1 :** Lire les corps live nécessaires via `execute_sql` : `pay_existing_order_v11` (expression exacte de `v_items_total` ~SELECT SUM(line_total), lecture `business_config`, sémantique du SET `subtotal`/`tax_amount`/`total`, résolution d'acteur/gate) et `get_pos_b2b_debts_v3` (expression exacte de l'outstanding retail : statuts exclus, jointure `order_payments`). Mirrorer ces expressions verbatim dans le RPC.
- [ ] **Step 2 :** Migration `20260710000112_retail_tab_credit_gate.sql` :

```sql
-- S62: plafond de crédit ardoise retail (décision propriétaire D4 2026-07-06, pattern B2B S52).
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS retail_credit_limit NUMERIC(14,2)
  CHECK (retail_credit_limit IS NULL OR retail_credit_limit >= 0);
COMMENT ON COLUMN public.customers.retail_credit_limit IS
  'Plafond ardoise comptoir (IDR). NULL = illimité. Gate: attach_tab_customer_v1 (S62).';

CREATE OR REPLACE FUNCTION public.attach_tab_customer_v1(
  p_order_id UUID, p_customer_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order RECORD; v_customer RECORD;
  v_items_total NUMERIC(14,2); v_tax_rate NUMERIC(5,4); v_tax_amount NUMERIC(14,2);
  v_outstanding NUMERIC(14,2); v_exceed NUMERIC(14,2);
BEGIN
  -- <résolution d'acteur + gate permission : MIRROIR du pattern live de pay_existing_order_v11 / discard_held_order_v1>
  SELECT id, status, created_via, customer_id INTO v_order
    FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_order.status <> 'pending_payment' OR v_order.created_via <> 'pos' THEN
    RAISE EXCEPTION 'order_not_attachable: status=%', v_order.status USING ERRCODE = 'P0001';
  END IF;

  -- Lock customer FIRST, re-check contre la ligne lockée (anti-TOCTOU, pattern S52).
  SELECT id, name, is_active, retail_credit_limit INTO v_customer
    FROM customers WHERE id = p_customer_id FOR UPDATE;
  IF NOT FOUND OR v_customer.is_active IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'customer_not_found_or_inactive' USING ERRCODE = 'P0002';
  END IF;

  -- Total provisoire = MIRROIR de l'expression v_items_total du corps LIVE de pay_existing_order_v11.
  SELECT COALESCE(SUM(line_total), 0) INTO v_items_total
    FROM order_items WHERE order_id = p_order_id;  -- + clause d'exclusion des items cancelled si v11 l'a

  IF v_customer.retail_credit_limit IS NOT NULL THEN
    -- Encours ardoise live = MIRROIR de l'outstanding retail de get_pos_b2b_debts_v3, restreint aux
    -- commandes comptoir (created_via='pos') — le crédit B2B a son propre plafond/ledger.
    SELECT COALESCE(SUM(o.total - COALESCE(p.paid, 0)), 0) INTO v_outstanding
      FROM orders o
      LEFT JOIN (SELECT order_id, SUM(amount) AS paid FROM order_payments GROUP BY order_id) p
        ON p.order_id = o.id
     WHERE o.customer_id = p_customer_id AND o.created_via = 'pos'
       AND o.status NOT IN (/* statuts exclus MIRROIR _071 live : au moins 'voided', 'paid' via outstanding>0 */)
       AND (o.total - COALESCE(p.paid, 0)) > 0.001;
    v_exceed := GREATEST(0, v_outstanding + v_items_total - v_customer.retail_credit_limit);
    IF v_exceed > 0 THEN
      RAISE EXCEPTION 'credit_limit_exceeded: %', jsonb_build_object(
        'current_outstanding', v_outstanding, 'order_amount', v_items_total,
        'credit_limit', v_customer.retail_credit_limit, 'would_exceed_by', v_exceed)::text
      USING ERRCODE = 'P0011', DETAIL = jsonb_build_object(
        'current_outstanding', v_outstanding, 'order_amount', v_items_total,
        'credit_limit', v_customer.retail_credit_limit, 'would_exceed_by', v_exceed)::text;
    END IF;
  END IF;

  SELECT tax_rate INTO v_tax_rate FROM business_config LIMIT 1;  -- MIRROIR lecture v11 live
  v_tax_amount := round_idr(v_items_total * v_tax_rate / (1 + v_tax_rate));
  UPDATE orders SET customer_id = p_customer_id,
    subtotal = v_items_total - v_tax_amount, tax_amount = v_tax_amount,
    total = v_items_total, updated_at = now()
   WHERE id = p_order_id;  -- provisoire : pay_existing_order_v11 recalcule au paiement

  INSERT INTO audit_logs (entity_type, entity_id, action, actor_id, metadata)
  VALUES ('order', p_order_id, 'order.attach_tab_customer', /* v_actor */ NULL,
          jsonb_build_object('customer_id', p_customer_id, 'total', v_items_total,
                             'outstanding_before', v_outstanding));
  -- ^ aligner colonnes/actor sur un writer récent (ex. kds_bump_order_v1 live) — vocabulaire audit_logs S56.

  RETURN jsonb_build_object('order_id', p_order_id, 'customer_id', p_customer_id,
    'customer_name', v_customer.name, 'total', v_items_total,
    'outstanding_before', COALESCE(v_outstanding, 0), 'credit_limit', v_customer.retail_credit_limit);
END $$;

REVOKE ALL ON FUNCTION public.attach_tab_customer_v1(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.attach_tab_customer_v1(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.attach_tab_customer_v1(UUID, UUID) TO authenticated;
COMMENT ON FUNCTION public.attach_tab_customer_v1(UUID, UUID) IS
  'S62: attache un client à une commande comptoir pending_payment (ardoise nommée) sous plafond retail_credit_limit (P0011). Appelé en RPC direct par le POS.';
```
Les blocs marqués MIRROIR sont à remplir depuis les corps live (Step 1) — pas d'invention. Re-attach idempotent : re-appeler avec le même client re-passe le gate et ré-écrit les mêmes valeurs (pas de clé d'idempotence nécessaire — aucune écriture cumulative).
- [ ] **Step 3 :** Appliquer via MCP `apply_migration`. Smoke : `SELECT attach_tab_customer_v1('00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid)` → erreur `order_not_found` P0002.
- [ ] **Step 4 :** Suite pgTAP `supabase/tests/retail_tab_credit_gate.test.sql` (enveloppe `BEGIN…ROLLBACK` via `execute_sql`, fixtures copiées d'une suite récente type `pay_existing_flag_aware.test.sql` : user+session+produit+commande fired). Tests (plan 8) :
  1. `attach` OK sous plafond → `customer_id` + `total` posés sur la commande (encours 0, plafond 100 000, commande 50 000).
  2. `attach` bloqué au-delà du plafond → `throws_ok` ERRCODE P0011, message `credit_limit_exceeded`.
  3. Plafond NULL = illimité → attach OK avec commande énorme.
  4. Encours existant compté : 1ʳᵉ ardoise 60 000 attachée, 2ᵉ commande 50 000 avec plafond 100 000 → P0011 (60k + 50k > 100k).
  5. Commande `paid` → `order_not_attachable` P0001.
  6. Client inactif → P0002.
  7. Après attach, la dette apparaît dans `get_pos_b2b_debts_v3` (outstanding = total).
  8. Re-attach même client → idempotent (pas d'erreur, mêmes valeurs).
- [ ] **Step 5 :** Exécuter la suite live (enveloppe ROLLBACK) → 8/8. Re-passer l'ancre `pay_existing_flag_aware` 3/3 (voisinage).
- [ ] **Step 6 :** Commit : `feat(db): plafond ardoise retail serveur — customers.retail_credit_limit + attach_tab_customer_v1 (P0011, anti-TOCTOU S52) + suite pgTAP (_112)`

### Task 5 : POS — action « Ardoise » sur les commandes fired + classification P0011

**Files:**
- Create: `apps/pos/src/features/heldOrders/hooks/useAttachTabCustomer.ts`
- Modify: `apps/pos/src/features/cart/HeldOrdersModal.tsx` (action « Ardoise » sur les lignes `status === 'pending_payment'`)
- Modify: `packages/domain/src/payment/retryClassifier.ts` (case `credit_limit_exceeded` dans `friendlyFatalMessage()`)
- Test: `apps/pos/src/features/heldOrders/__tests__/attach-tab-customer.smoke.test.tsx` (+ test unitaire du classifieur dans le test existant de retryClassifier)

**Interfaces:** consomme `attach_tab_customer_v1` (Task 4) et le picker client existant (`apps/pos/src/features/customers/CustomerSearchModal.tsx` — vérifier sa prop de sélection avant réutilisation). Invalidations React-Query : `['held-orders']` + la queryKey des debts POS (celle de `useOutstandingDebts`).

- [ ] **Step 1 :** Hook `useAttachTabCustomer` : `useMutation` → `supabase.rpc('attach_tab_customer_v1', { p_order_id, p_customer_id })`, onSuccess invalide `['held-orders']` + queryKey debts. Erreur : détecter `credit_limit_exceeded` (code P0011 / message) et exposer les montants du DETAIL jsonb si parsables.
- [ ] **Step 2 :** `HeldOrdersModal` : sur chaque ligne `pending_payment`, bouton « Ardoise » (cible tactile ≥ 44 px, conventions ui-kit) → ouvre le picker client → confirme → mutation. Toast succès « Ardoise de <client> : <total> » ; échec plafond → message français lisible « Plafond ardoise dépassé — encours <X> + commande <Y> > plafond <Z> ». Garder le fichier < 500 lignes (extraire un sous-composant si besoin).
- [ ] **Step 3 :** `retryClassifier.ts` : ajouter le mapping `credit_limit_exceeded` → message friendly fatal (le classifieur lit `err.details.error`/`err.details.code` — suivre le pattern des cases existants).
- [ ] **Step 4 :** Smoke test : modal rend le bouton sur une ligne pending_payment, la mutation est appelée avec les bons args, le cas P0011 affiche le message plafond (mock rpc). Test classifieur : P0011/`credit_limit_exceeded` → friendly.
- [ ] **Step 5 :** `pnpm --filter @breakery/pos test heldOrders && pnpm --filter @breakery/domain test payment && pnpm typecheck` → exit 0. Lint-ratchet fichiers touchés.
- [ ] **Step 6 :** Commit : `feat(pos): ardoise nommée — attacher un client à une commande fired depuis HeldOrdersModal, gate plafond P0011 classifié`

### Task 6 : BO — champ « Plafond ardoise » sur la fiche client retail

**Files:**
- Modify: `apps/backoffice/src/features/customers/` — fiche/édition client : exposer `retail_credit_limit` (input numérique, vide = illimité) pour les clients `customer_type = 'retail'`, en MIRROIR exact du câblage existant de `b2b_credit_limit` dans `B2BFieldsSection.tsx:81-89` (même chemin de persistance — vérifier dans `useCustomerDetail.ts` / la mutation d'update comment `b2b_credit_limit` est sauvé et faire pareil ; si c'est un RPC qui n'accepte pas la colonne, le signaler BLOCKED plutôt que d'inventer un update direct)
- Test: smoke co-localisé `__tests__/` (le champ apparaît pour un retail, pas pour un b2b ; la valeur saisie part dans la mutation)

**Interfaces:** consomme la colonne Task 4. Ne PAS toucher la section B2B existante ni `customer_categories`.

- [ ] **Step 1 :** Lire `B2BFieldsSection.tsx` + le hook d'update pour comprendre le chemin de persistance réel, puis ajouter le champ (nouvelle petite section « Ardoise » ou champ dans la section générale — suivre la structure du formulaire existant).
- [ ] **Step 2 :** Smoke test + `pnpm --filter @breakery/backoffice test customers && pnpm typecheck` → exit 0. Lint-ratchet.
- [ ] **Step 3 :** Commit : `feat(backoffice): champ plafond ardoise (retail_credit_limit) sur la fiche client retail`

### Task 7 : Closeout S62

- [ ] **Step 1 :** Types regen : MCP `generate_typescript_types` → écrire `packages/supabase/src/types.generated.ts` (drift attendu : `print_queue` disparue, `retail_credit_limit`, `attach_tab_customer_v1`) → commit `chore(types): regen après migrations _110..112`.
- [ ] **Step 2 :** Ancres live : `s44_money_gates` 12/12 (v17/v11/fire_v4 intacts), `pay_existing_flag_aware` 3/3, `security` (si elle référence les permissions supprimées — vérifier qu'elle n'asserte ni `rbac.update` ni `print_queue.*` ; scouting : elle n'asserte que `rbac.read`).
- [ ] **Step 3 :** Suite monorepo complète : `pnpm typecheck && pnpm build && pnpm test` → exit 0.
- [ ] **Step 4 :** Docs : créer `docs/workplan/plans/2026-07-06-session-62-INDEX.md` (tâches/commits/migrations/dettes) ; MAJ `docs/workplan/remise-a-plat/00-INDEX.md` (purges soldées, `print_jobs`→`print_queue` statuée PURGÉE, plafond ardoise livré) + fiches 02/03 (notes S62) ; bump `CLAUDE.md` Active Workplan (S62 merged, S63 next).
- [ ] **Step 5 :** Push + PR vers master (squash-merge après CI verte).
