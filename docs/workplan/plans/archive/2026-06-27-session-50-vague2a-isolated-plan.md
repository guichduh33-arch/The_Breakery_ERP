# Session 50 — Vague 2a (tranche isolée) — Plan d'exécution

> **Date** : 2026-06-27 · **Branche** : `swarm/session-50-v2a` (base = `swarm/session-50` / PR #129)
> **Décision métier (2026-06-27)** : démarrer par la **tranche isolée** de la Vague 2a — intégrité argent/compta **sans toucher `complete_order_with_payment_v14`**. Le prix-ligne serveur canonique (`_resolve_line_price_v1` + bump v14→v15) fera l'objet d'une **spec dédiée** ensuite.
> **Source** : `docs/workplan/audits/2026-06-27-triangulated-audit-synthesis-and-completion-plan.md` §4 Vague 2a.
> **Contrainte d'exécution** : les subagents n'ont PAS le MCP Supabase → toutes les migrations + pgTAP passent par la session principale. Les EF (Deno) et le code app sont délégables ; le déploiement EF + l'apply migration restent côté lead.

## Modèle live vérifié (2026-06-27, `ikcyvlovptebroadgtvd`)

- Plus haute migration locale = `20260710000056` → la Vague 2a-i démarre à `…057`.
- `complete_order_with_payment_v14` (16 args, `p_manager_pin`) — **NON touché dans cette tranche**.
- `adjust_b2b_balance_v1(p_customer_id,p_delta,p_reason,p_idempotency_key)` — DEFINER ; gate `customers.update` ; `UPDATE customers.b2b_current_balance` + audit_log ; **AUCUN JE de contrepartie ; pas de PIN**.
- `create_b2b_order_v1(...)` — DEFINER ; guard `IF v_product.current_stock < v_quantity THEN insufficient_stock` **inconditionnel** (ignore `track_inventory`) + décrément `current_stock`/`stock_movements` inconditionnel.
- `calculate_pb1_payable_v1(p_period_start,p_period_end)` — DEFINER STABLE ; `Σ(credit−debit)` sur 2110 `status IN ('posted','locked')` **sans dédup void+refund**.
- `get_profit_loss_v2` dédupe déjà : `AND NOT (je.reference_type='sale_void' AND EXISTS (SELECT 1 FROM refunds rf WHERE rf.order_id=je.reference_id))` — **pattern canonique à réutiliser**.
- `get_trial_balance_v2(p_date_start,p_date_end)` — gaté S50 ; **non cumulatif** (soldes comptes permanents = mouvements de période, pas solde d'ouverture).
- `void_zreport_v1(p_zreport_id,p_reason)` — **pas de PIN** ; `sign_zreport_v2` a déjà `p_manager_pin`.

## Tâches (ordre = valeur/isolation croissante en risque)

### T1 — PB1 dédup void+refund (`calculate_pb1_payable_v1`, CREATE OR REPLACE en place)
- Ajouter le filtre canonique du P&L pour exclure la JE `sale_void` quand un refund existe pour le même `order_id`.
- Signature + forme de retour inchangées (bugfix report STABLE) → pas de bump, pas de changement de grants.
- pgTAP : order vendu (2110 crédité) → void complet → refund ⇒ `pb1_output` ne double-passe PAS (= net du seul refund). Happy path inchangé.
- Pas de regen types (signature stable).

### T2 — `adjust_b2b_balance_v1` → `_v2` : JE de contrepartie + PIN manager (header) + perm dédiée
- Nouvelle perm `b2b.balance.adjust` (MANAGER/ADMIN/SUPER_ADMIN) — seedée.
- Arg `p_manager_pin TEXT` ; vérifier via le helper PIN serveur (mirror `create_manual_je_v1`).
- **JE de contrepartie** sur le compte de contrôle AR B2B (`resolve_mapping_account('B2B_AR')`) ⇄ compte de contrepartie. **DÉCISION OUVERTE** : quel compte de contrepartie pour un ajustement AR sans encaissement ? (bad-debt expense / AR adjustment). À trancher après requête COA. Candidats : créer un compte `6xxx AR Adjustment / Bad Debt` si absent, ou réutiliser un opex existant. **Ne pas coder le JE avant cette décision.**
- DROP v1 + REVOKE pair complet + regen types + mettre à jour le call-site BO (`adjust_b2b_balance` hook) pour passer le PIN en header.

### T3 — `get_trial_balance` cumulative as-of (`_v2` → `_v3`)
- Comptes permanents (classe 1/2/3) : solde = solde d'ouverture (cumul < p_date_start) + mouvements de période. Comptes de résultat (4/5/6) : mouvements de période seuls.
- Bump v2→v3 (changement de sémantique du retour) + DROP v2 + gate `accounting.tb.read` préservé + regen types + MAJ `useTrialBalance`.

### T4 — `create_b2b_order_v1` → `_v2` : stock flag-aware (fix N1)
- Guard `insufficient_stock` + décrément `current_stock`/`stock_movements 'sale'` **gatés sur `track_inventory=true`**.
- Pour `deduct_stock=true` : consommer les matières recette (mirror v14 via `_resolve_recipe_consumption_v1`) — vérifier la logique v14 avant de coder pour parité exacte.
- DROP v1 + REVOKE pair + regen types + MAJ call-site B2B (`useCreateB2BOrder`).
- pgTAP : produit non-tracké stock 0 ⇒ commande B2B OK ; produit tracké stock insuffisant ⇒ exception conservée.

### T5 — `void_zreport_v1` → `_v2` : PIN manager
- Arg `p_manager_pin TEXT` + vérif serveur. DROP v1 + REVOKE pair + regen types + MAJ `useVoidZReport`/EF wrapper `x-manager-pin`.

### T6 — Durcissement EF (délégable `edge-functions-engineer` ; déploiement via lead)
- `generate-zreport-pdf` : remplacer `auth.getUser()` par `getActingAuthUserId` (HS256 PIN-JWT).
- `auth-change-pin` : rate-limit durable (`_shared` rate-limit).
- `notification-dispatch` : secret de query param → header.
- z-report upload : `upsert:true` (race).

## Loop d'exécution (adapté MCP-funnel)
Par tâche DB : lead écrit la migration → `apply_migration` MCP → pgTAP via `execute_sql` BEGIN/ROLLBACK → regen types si signature change → commit. Revue de diff par `pattern-guardian`/`db-engineer` sur les tâches à blast-radius (T2/T4). EF/app code délégués aux spécialistes, revus, puis déployés/commités par le lead.

## Suivi
Ledger : `.superpowers/sdd/progress.md`. Décisions/déviations numérotées dans l'INDEX de session.
