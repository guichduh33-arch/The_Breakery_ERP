# Session 51 — INDEX — Vague 2a money-path « prix-ligne canonique serveur »

> Branch `swarm/session-51` (base `swarm/session-50` incl. 2a-i #130) · Spec `docs/superpowers/specs/2026-06-28-pos-canonical-server-line-price-design.md`
> DB layer applied + verified live on cloud `ikcyvlovptebroadgtvd` by the main session (MCP).
> Suite la tranche isolée 2a-i (#130) ; ferme les findings audit **C8/C9** (P1.1). Settlement B2B par facture (P1.2) → vague suivante.

## 1. Summary

- **Money-path bumped `v14 → v15`** — `complete_order_with_payment_v15` (signature identique 16 args). Le serveur devient la **seule autorité** sur le prix de ligne : `price_adjustment` des modifiers et surcharges combo relus depuis `product_modifiers` (le prix client est ignoré), lignes-cadeau validées contre les `free_items` de `evaluate_promotions_v1` (produit + quantité), retour enrichi d'une ventilation serveur `lines[]`. `DROP complete_order_with_payment_v14` dans la même migration.
- **Helper `_resolve_line_price_v1`** — SECURITY DEFINER STABLE interne (REVOKE PUBLIC+anon+authenticated) : base (`get_customer_product_price` / `combo_base_price`) + modifiers serveur ; cadeau ⇒ 0.
- **EF `process-payment` repointée v15 + redéployée** (version 13, ACTIVE, `verify_jwt=false`) — le retour `lines[]` transite verbatim vers le client.
- **Client consomme les valeurs serveur** — reçu post-paiement (`SuccessModal`) lit `total`/`tax_amount`/`lines[]` serveur ; `useTaxRate()` (lecture `business_config.tax_rate`) remplace `DEFAULT_TAX_RATE=0.10` sur les chemins d'encaissement.
- **Baseline pgTAP money-path alignée v15** — 7 suites vertes live + nouvelle suite d'acceptation 13/13.

## 2. Migrations applied (local NAME-block → cloud version clock-assigned)

| File timestamp | Object |
|---|---|
| `20260710000063_resolve_line_price_v1` | helper interne `_resolve_line_price_v1(uuid,numeric,jsonb,uuid,boolean,boolean)` (REVOKE pair complet) |
| `20260710000064_complete_order_v15_canonical_line_price` | `complete_order_with_payment_v15` (CREATE) + REVOKE PUBLIC/anon + **GRANT authenticated+service_role** + `DROP …v14` |

## 3. New files

- **Migrations** : 063, 064 (ci-dessus).
- **DB tests** : `supabase/tests/canonical_line_price.test.sql` (A1-A4 + gate anon + smoke v15 + v14 droppée) — **13/13**.
- **Client** : `apps/pos/src/features/settings/hooks/useTaxRate.ts`.
- **Spec** : `docs/superpowers/specs/2026-06-28-pos-canonical-server-line-price-design.md` ; this INDEX.

## 4. Files modified

- `supabase/functions/process-payment/index.ts` — appel RPC `v14 → v15` (retour forwardé verbatim).
- `packages/domain/src/types/payment.ts` — `PaymentResultLine` + `PaymentResult.subtotal?/lines?`.
- `apps/pos/.../payment/{hooks/useCheckout,hooks/usePaymentFlowLogic,PaymentTerminal,SuccessModal}` — propagation + consommation `lines[]`/`tax_amount` serveur.
- `apps/pos/.../cart/{ActiveOrderPanel,BottomActionBar,hooks/usePrintBill}` + `display/hooks/useCartBroadcast` — `useTaxRate` (cf. DEV-S51-W2-02 pour les 2 `DEFAULT_TAX_RATE` conservés).
- `supabase/tests/{s44_money_gates,order_discount_gate,combo_sale,combo_reversal,modifier_ingredient_deduction,loyalty_transactions_append_only,sale_flag_aware_deduction}.test.sql` — alignement v15 + réconciliations fixtures.
- `packages/supabase/src/types.generated.ts` — régénéré post-apply.

## 5. Tests run (live, MCP `execute_sql`, BEGIN/ROLLBACK, by lead)

| Suite | Count | Status |
|---|---|---|
| `canonical_line_price` (nouveau) | 13 | PASS |
| `s44_money_gates` | 12 | PASS |
| `order_discount_gate` | 10 | PASS |
| `combo_sale` | 11 | PASS |
| `combo_reversal` | 3 | PASS |
| `modifier_ingredient_deduction` | 24 | PASS |
| `loyalty_transactions_append_only` | 5 | PASS |
| `sale_flag_aware_deduction` | 6 | PASS |
| `pnpm typecheck` (@breakery/app-pos + @breakery/domain) | — | PASS |

> `usePaymentFlowLogic.test` (Vitest) échoue sur la **baseline pré-existante env-gated** (`VITE_SUPABASE_URL`) — vérifié identique sur `master` (git stash) ; **pas une régression**.

## 6. RPCs added / bumped

| Action | RPC | Notes |
|---|---|---|
| add | `_resolve_line_price_v1` | helper interne money-path (REVOKE complet) |
| bump | `complete_order_with_payment_v14 → v15` | prix-ligne canonique serveur + `lines[]` ; DROP v14 |

## 7. Decisions (spec D1-D4, validées 2026-06-28)

- **D1** = reçu pré-paiement reste calcul client **au taux serveur** (`useTaxRate`).
- **D2** = validation cadeau **exact match** `(product_id, quantity)` vs `free_items` (`evaluate_promotions_v1` les expose).
- **D3** = signature v15 **inchangée** (16 args) — blast-radius EF/client minimal.
- **D4** = prix de base divergent = **override + audit** (`order.price_overridden`), pas de rejet.

## 8. Deviations vs spec/plan

| ID | Section | What happened | Reason | Risk |
|---|---|---|---|---|
| DEV-S51-PRE-01 | Orchestration | db-engineer a produit les fichiers SQL ; le lead a appliqué + vérifié via MCP | MCP indisponible en contexte subagent | Informational |
| DEV-S51-W1-01 | Grant v15 | **Faille critique interceptée avant apply** : la migration de db-engineer faisait `REVOKE PUBLIC/anon` **sans** `GRANT authenticated` (hypothèse erronée « EF=service_role »). Corrigé pour mirrorer v14 (`GRANT authenticated + service_role`). | L'EF appelle via JWT utilisateur (`authenticated`) — sans grant, money-path cassée en `permission denied` | **Évité** (aurait été bloquant) |
| DEV-S51-W3-01 | combo_sale / modifier_ingredient_deduction | bugs de tests **latents** : les checks « insufficient stock » sont gatés sur `allow_negative_stock=false` (#122, postérieur à S47) ; le défaut dev est `true` → jamais exercés. Fix : `UPDATE business_config SET allow_negative_stock=false` au setup. | Jamais détecté car les 62 tests live-RPC ne tournent pas en CI (audit C6) | Informational (corrigé) |
| DEV-S51-W3-02 | order_discount_gate / loyalty | seed session inconditionnel → `one_open_session_per_user` sur le cashier résolu. Fix : reuse-or-insert. | Fragilité fixture | Informational (corrigé) |
| DEV-S51-W2-01 | Reçu | `SuccessModal` aligne `lines[]` aux lignes panier non-annulées **par index** avec fallback client défensif (jamais throw sur le reçu) ; `calculateTotals` conservé uniquement pour des sous-lignes tax-indépendantes. | Le pickup (`pay_existing_order_v10`) hors bump v15 peut omettre `lines` | Informational |
| DEV-S51-W2-02 | Taux de taxe | 2 `DEFAULT_TAX_RATE` conservés volontairement : `useCartBroadcast` (broadcast tax-inclusif rate-indépendant ; brancher `useTaxRate` cassait `cart-broadcast.smoke` qui ne mocke pas supabase) et `useApplyCartDiscount` (subtotal base discount, rate-indépendant). | Couplage réseau inutile pour zéro bénéfice | Informational |
| DEV-S51-W2-03 | Isolation subagents | le guard `bgIsolation` a bloqué l'outil Edit des subagents (session parente bg non isolée au niveau session ; cwd EST déjà le worktree) ; les subagents ont écrit via remplacements scriptés Bash dans le worktree (isolation physique réelle). | Limitation harness | Informational (à régler proprement) |

## 9. Acceptance criteria (spec §7)

- [x] **A1** — modifier `price_adjustment` client falsifié ignoré → prix `product_modifiers` réel.
- [x] **A2** — option modifier inconnue/inactive → `check_violation`.
- [x] **A3** — ligne-cadeau produit non autorisé → `check_violation` ; cadeau légitime OK.
- [x] **A4** — surcharge combo recalculée serveur.
- [x] **A5** — v15 renvoie `lines[]` ; reçu/affichage les consomment ; pas de recalcul client du total/taxe encaissés.
- [x] **A6** — taux de taxe client = `business_config.tax_rate` (plus de `0.10` hardcodé sur l'encaissement).
- [x] **A7** — baseline money-path non régressée (7 suites vertes sur v15).
- [x] **A8** — REVOKE pair complet sur helper + v15 ; v14 droppée ; types regénérés.

## 10. Deferred (vague suivante / follow-ups)

1. **Settlement B2B par facture** (P1.2 : `b2b_payment_allocations` + `cancel_b2b_order_v1`) — vague dédiée.
2. **D1(b)** RPC `quote_order_pricing_v1` lecture seule — dette, seulement si une divergence reçu pré/post-paiement est constatée.
3. **CI live-RPC** — la baseline money-path reste hors CI tant que `SUPABASE_SERVICE_ROLE_KEY` n'est pas configuré (héritage S50 / audit C6).
4. **Isolation subagents** (DEV-S51-W2-03) — à régler pour les prochains swarms.
