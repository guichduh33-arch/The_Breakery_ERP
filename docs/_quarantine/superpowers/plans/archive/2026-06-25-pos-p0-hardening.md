# POS P0 Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` (frontend waves) ou exécution inline (DB waves). Steps use `- [ ]` checkboxes.

**Goal:** Corriger les 7 P0 de l'audit POS 2026-06-25 (fraude reversal, ledger déséquilibré, KDS vide, blind-count, reconnect realtime, tactile WAITER, hiérarchie caisse) sans régression money-path.

**Architecture:** 3 vagues. Vague 1 = DB sécurité/compta (migrations cloud séquentielles, exécution inline contrôlée). Vague 2 = KDS config + garde-fou. Vague 3 = frontend tactile/realtime (subagents parallèles en worktree).

**Tech Stack:** Supabase Postgres (RPC SECURITY DEFINER, pgTAP) · Deno EF · React/TS/Tailwind · `@breakery/ui` · Vitest.

## Global Constraints
- Versioning RPC monotone : `_vN+1` + `DROP …vN(<args>)` même migration. Jamais éditer une signature publiée.
- REVOKE admin : `REVOKE EXECUTE FROM anon, PUBLIC` (authenticated hérite via PUBLIC).
- Ledgers append-only : write via SECURITY DEFINER seulement.
- PIN header `x-manager-pin` ; idempotence header `x-idempotency-key` → `getIdempotencyKey`.
- Types regen après tout DDL → `packages/supabase/src/types.generated.ts` → commit.
- DB = cloud `ikcyvlovptebroadgtvd` via MCP `apply_migration`/`execute_sql`. pgTAP en `BEGIN…ROLLBACK`. Pas de Docker.
- Conventional commits + co-author Claude. Fichiers < 500 lignes.

---

## VAGUE 1 — DB sécurité & compta (inline, séquentiel)

### Task 1 — LOT 1 : durcir refund/void (REVOKE + idempotency + contre-passation unique)

**Files:**
- Read (source des bodies à recréer) : migrations `20260620172629_bump_refund_order_v4_modifier_ingredients`, `20260620172527_bump_void_order_v3_modifier_ingredients`, `20260619151404_combo_aware_reversals`, `20260531102309_create_reversal_rpcs_acting_user` (via `execute_sql` sur `pg_get_functiondef`).
- Create (migration) : `refund_order_rpc_v5` + `void_order_rpc_v4` + REVOKE pairs + `void_order_idempotency_keys` table + DROP v4/v3.
- Modify : `supabase/functions/refund-order/index.ts` (→ v5), `supabase/functions/void-order/index.ts` (→ v4 + `getIdempotencyKey`).
- Test : `supabase/tests/functions/reversal-hardening.test.ts` (Vitest live) + pgTAP inline.

**Interfaces:**
- Produces : `refund_order_rpc_v5(p_order_id, p_lines, p_tenders, p_reason, p_authorized_by, p_idempotency_key, p_acting_auth_user_id)` ; `void_order_rpc_v4(p_order_id, p_reason, p_authorized_by, p_acting_auth_user_id, p_idempotency_key)`. Tous REVOKED de authenticated, GRANT service_role.

- [ ] **Step 1** — Récupérer les définitions live : `select pg_get_functiondef('public.refund_order_rpc_v4(...)'::regprocedure), pg_get_functiondef('public.void_order_rpc_v3(...)'::regprocedure);` pour partir des corps exacts.
- [ ] **Step 2** — Vérifier le mécanisme de double contre-passation : inspecter `void_order_rpc_v3` body — repère l'INSERT dans `refunds` (ligne miroir) + le trigger `sale_void`. Confirmer la branche à retirer (R1.4).
- [ ] **Step 3** — Écrire la migration `apply_migration` (name `bump_reversal_rpcs_v5_v4_revoke_idempotent`) : (a) `CREATE OR REPLACE` interdit → `CREATE FUNCTION refund_order_rpc_v5` (corps v4 inchangé) ; (b) `CREATE FUNCTION void_order_rpc_v4` = corps v3 **+ param `p_idempotency_key uuid DEFAULT NULL`** + re-read idempotency (table dédiée) + **sans INSERT refunds miroir** ; (c) `void_order_idempotency_keys(idempotency_key uuid PK, order_id uuid, result jsonb, created_at)` + RLS + REVOKE ; (d) `REVOKE EXECUTE ON FUNCTION refund_order_rpc_v5, void_order_rpc_v4 FROM PUBLIC, anon, authenticated; GRANT EXECUTE … TO service_role;` ; (e) `DROP FUNCTION refund_order_rpc_v4(<args>); DROP FUNCTION void_order_rpc_v3(<args>);`.
- [ ] **Step 4** — Vérifier en live : `has_function_privilege('authenticated','refund_order_rpc_v5(...)','EXECUTE')` = **false** ; idem void_v4. Attendu : false/false.
- [ ] **Step 5** — pgTAP inline (`BEGIN…ROLLBACK`) : asserts `function_privs_is('refund_order_rpc_v5', 'authenticated', '{}')`, idem void_v4 ; un void firé 2× avec même `p_idempotency_key` renvoie le même résultat.
- [ ] **Step 6** — Repointer `void-order/index.ts` (appel v4 + `import { getIdempotencyKey }` + propager `p_idempotency_key`) et `refund-order/index.ts` (appel v5). Maj commentaires d'en-tête stale (DB-INFO #1/#2).
- [ ] **Step 7** — `generate_typescript_types` → écrire `types.generated.ts`.
- [ ] **Step 8** — `pnpm --filter @breakery/supabase test reversal` + `pnpm build`. Attendu : vert.
- [ ] **Step 9** — Commit `feat(security): harden refund/void RPC — REVOKE from authenticated + idempotent void + single reversal JE`.

### Task 2 — LOT 2 : intégrité du grand livre

**Files:**
- Read : `fn_create_je_for_refund` (migration `20260514014551_refactor_refund_je`), `create_sale_journal_entry` (fallback CR de référence).
- Create (migration) : bump `fn_create_je_for_refund` (fallback CR) + `REVOKE` writes ledger + data-fix 8 JE orphelines.
- Test : pgTAP inline.

- [ ] **Step 1** — `select pg_get_functiondef('public.fn_create_je_for_refund()'::regprocedure);` + repérer la boucle sur `refund_payments` (R2.1).
- [ ] **Step 2** — Migration `apply_migration` (name `harden_ledger_refund_je_balance_and_appendonly`) : (a) `CREATE OR REPLACE FUNCTION fn_create_je_for_refund` avec fallback : si aucune ligne CR posée (refund_payments vide), poser une ligne CR sur le compte cash/clearing par défaut pour `total_credit` ; (b) `REVOKE INSERT, UPDATE, DELETE ON public.journal_entries, public.journal_entry_lines FROM authenticated, PUBLIC;`.
- [ ] **Step 3** — Data-fix idempotent (même migration ou séparée) : pour les 8 JE `sale_refund` avec `Σcredit=0`, poser la ligne CR manquante OU contre-passer le JE. Garde `WHERE NOT EXISTS` pour idempotence.
- [ ] **Step 4** — Vérifier : `select je.id from journal_entries je left join journal_entry_lines l on l.journal_entry_id=je.id group by je.id having coalesce(sum(l.debit),0)<>coalesce(sum(l.credit),0);` = **0 row**. + `get_trial_balance_v1` : `Σdr=Σcr`.
- [ ] **Step 5** — pgTAP inline : `table_privs_are('journal_entries','authenticated','{SELECT}')` ; refund sans refund_payments → JE balanced.
- [ ] **Step 6** — `pnpm --filter @breakery/supabase test` (compta) + build. Commit `fix(accounting): balance refund JE + revoke ledger writes from authenticated + clean 8 orphan JE`.

---

## VAGUE 2 — KDS config + garde-fou (inline)

### Task 3 — LOT 3 : rendre le KDS fonctionnel

**Files:**
- Read : `apps/pos/src/features/kds/hooks/useKdsOrders.ts`, `apps/pos/src/features/cart/BottomActionBar.tsx` (fire), `create_category_v1`/`update_category_v1` (dispatch_station ?).
- Modify : composant de fire POS (garde-fou catégorie non routée) ; CRUD catégorie BO si `dispatch_station` non exposé.
- Test : smoke `__tests__/`.

- [ ] **Step 1** — Confirmer si `update_category_v1`/`create_category_v1` acceptent `dispatch_station` (`pg_get_functiondef`). Si non → migration bump pour l'exposer.
- [ ] **Step 2** — Garde-fou fire : avant l'envoi KDS, si la catégorie du produit = `dispatch_station='none'`, afficher un toast d'avertissement (« produit non routé en cuisine »). Non-bloquant.
- [ ] **Step 3** — Test smoke : fire d'un produit `none` déclenche l'avertissement.
- [ ] **Step 4** — Build + commit `feat(kds): warn on fire of unrouted product + expose category dispatch_station`.
- [ ] **Step 5 (escalade)** — Documenter dans le commit/PR que le **mapping catégorie→station** (backfill data) attend la décision owner. Ne PAS deviner le mapping.

---

## VAGUE 3 — Frontend (subagents parallèles, worktrees isolés)

> Chaque task = 1 subagent `pos-specialist` en `isolation: worktree`. Inputs détaillés = rapports d'audit `audit-design`/`audit-flow` (fichier:ligne déjà fournis).

### Task 4 — LOT 4 : blind-count clôture caisse
- **Files:** `apps/pos/src/features/shift/components/CloseShiftModal.tsx:85-109`.
- [ ] Masquer `expectedCash` + variance live pendant la saisie ; révéler l'écart après soumission ; raison si `|écart|>seuil`. Test smoke « attendu non visible avant saisie ». Commit `feat(shift): blind cash count at close`.

### Task 5 — LOT 5 : filet reconnect realtime
- **Files:** `useDisplayRealtime.ts:39`, `useTableOccupancy.ts:52`, `usePromotionsRealtime.ts:39`, `useHeldOrdersRealtime.ts:20`, `useTabletOrderStatusListener.ts:63`.
- [ ] Ajouter `refetchInterval` (≤30s) ou orchestrateur `online→invalidateQueries` sur chaque hook (modèle KDS+inbox existant). Test : reconnection invalide les queries. Commit `fix(realtime): reconnect safety net on 5 POS channels`.

### Task 6 — LOT 6 : refonte tactile tablette WAITER (effort L)
- **Files:** `apps/pos/src/features/tablet/components/{TabletProductGrid,TabletCartPanel}.tsx`, `pages/tablet/TabletLayout.tsx`, `features/pos/.../CategorySidebar.tsx`.
- [ ] Grille iPad-first 2-3 col + recherche `h-12` ; panier `QuantityStepper` ≥48px ; header table active+offline+compteur ; sidebar alignée `CategoryNav`. Tests smoke cibles ≥44px. Commit `feat(tablet): iPad-first waiter grid + cart + header`.

### Task 7 — LOT 7 : hiérarchie BottomActionBar + payment
- **Files:** `apps/pos/src/features/cart/BottomActionBar.tsx:57,266-286`, `features/payment/.../usePaymentFlowLogic.ts:42`, `PaymentMethodGrid.tsx`.
- [ ] Checkout `size="lg"`/`≥h-12` dominant ; pré-sélection Cash à l'ouverture terminal ; quick-cash visible pré-méthode (cf. audit payment-caisse 2026-06-25). Tests smoke. Commit `feat(pos): dominant checkout + cash preselect + quick-cash`.

---

## Self-review (couverture spec)
- R1.* → Task 1 ✓ · R2.* → Task 2 ✓ · R3.* → Task 3 ✓ (R3.3 escaladé) · R4.* → Task 4 ✓ · R5.* → Task 5 ✓ · R6.* → Task 6 ✓ · R7.* → Task 7 ✓.
- Escalades owner (mapping KDS, PB1) explicitement hors-code. Hardware = angle mort documenté.

## Ordre & dépendances
1. **Vague 1 séquentielle** (Task 1 → Task 2) : migrations cloud monotones, money-path — exécution inline contrôlée, **pas de parallélisme DB**.
2. **Vague 2** (Task 3) après Vague 1.
3. **Vague 3** (Task 4-7) en parallèle (subagents worktree) — indépendants, fichiers disjoints.
