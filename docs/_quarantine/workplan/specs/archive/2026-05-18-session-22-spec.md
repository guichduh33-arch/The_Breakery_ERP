# Session 22 — Focus-trap lock-in + dette technique ciblée — Spec

> Date authored: 2026-05-18
> Branch: `swarm/session-22` (off `20d484c` master post-S21 merge PR #25)
> Migration block: `20260526000010..099`
> Theme: verrouiller l'acquis focus-trap (déjà fait implicitement V3) via tests + lint guard + roadmap cleanup ; ramasser 2 dettes techniques ciblées S17/S19.

---

## §0 — Context

S21 a fermé les 8 follow-ups hardening reliquat S13–S19. Le cycle hardening est désormais clos sauf items P3 (WAC polish, mobile shell, compliance fiscale).

L'audit roadmap §Actifs ligne 5 listait `Fix modal focus traps : migrer modales custom vers shadcn Dialog (Radix)` comme P1 actif. L'audit empirique en début de S22 a établi :

- **30+ modals nommés `*Modal.tsx` dans `apps/`** routent tous à travers une primitive Radix (`Dialog`, `FullScreenModal`, `CenterModal`, `Sheet`) de `packages/ui` — aucun overlay `<div fixed inset-0>` brut n'existe.
- `TASK-22-006 — Modal focus trap + Escape (Radix Dialog migration) [P1] [DONE]` est déjà marqué `[DONE]` dans `docs/workplan/backlog-by-module/22-design-system.md:90`, vraisemblablement fermé implicitement lors de la consolidation V3 monorepo + packages/ui.
- La roadmap globale `00-roadmap-globale.md:43` est stale (item Actif alors que le travail est DONE).

S22 prend acte de ce statut et **verrouille l'acquis** via régression tests (RTL focus-trap sur les 4 primitives) + ESLint rule `no-raw-modal-overlay` (interdit `fixed inset-0` JSX hors `packages/ui`) + roadmap cleanup. Parallèlement, S22 ramasse 2 dettes techniques ciblées qui restaient sans propriétaire de session :

| # | Item | Source | Module | Estim |
|---|------|--------|--------|-------|
| A | Focus-trap verification + lock-in (RTL + ESLint rule + roadmap cleanup) | empirical S22 + TASK-22-006 status reconciliation | 22-design-system + 23-tests | M ~4h |
| B.1 | WAC bypass guard via column-level REVOKE UPDATE + RPC `update_cost_price_v1` | DEV-S17-1.B-01 | 06-inventory + 07-purchasing + 25-security | M ~2.5h |
| B.2 | `Retry-After` header sur les 5 EFs rate-limited (auth-verify-pin, kiosk-issue-jwt ×2 buckets, refund-order, void-order, cancel-item) | DEV-S19-2.A-02 | 01-auth + 25-security | S ~1.5h |

**Total estim** : ~8h serial ; ~5h wall-time avec 2 streams parallèles (max stream).

---

## §1 — Goals (success criteria)

### Stream A — Focus-trap lock-in

1. **RTL regression tests** : 4 nouveaux fichiers de tests `__tests__/*.focus-trap.test.tsx` dans `packages/ui/src/primitives/` et `packages/ui/src/components/` qui assertent pour chaque primitive (`Dialog`, `FullScreenModal`, `CenterModal`, `Sheet`) :
   - Tab cycles forward stays within the modal subtree (`document.activeElement` reste dans le portal subtree).
   - Shift+Tab cycles backward similarly.
   - Escape key fires `onOpenChange(false)`.
   - On close, focus returns to the triggering element (autoFocus restore).
2. **ESLint custom rule `no-raw-modal-overlay`** : règle TypeScript dans `packages/eslint-config/src/rules/` qui flag `className` contenant `fixed inset-0` ou `position: fixed` JSX inline style en `.tsx` HORS de `packages/ui/**` ET `**/__tests__/**`. Wirée au level `error` dans le shared config consumed par `apps/pos` + `apps/backoffice`.
3. **ESLint rule tests** : RuleTester avec ≥ 5 cases (2 valid : `packages/ui/...`, modal qui import `Dialog` ; 3 invalid : raw overlay dans `apps/pos`, dans `apps/backoffice`, dans `packages/domain`).
4. **Lint scan green** : `pnpm exec eslint apps/pos/src apps/backoffice/src packages/{domain,supabase,utils}/src` retourne 0 erreur pour la nouvelle règle.
5. **Roadmap cleanup** : `00-roadmap-globale.md` §Actifs item 5 strikethrough avec ref S22 ; §Sessions complétées ajoute row S22 ; §Indicateurs ajoute ligne `Modal focus-trap audit | locked-in | DONE S22`.
6. **Status notes** : append-only Status note datée 2026-05-18 sur `22-design-system.md` (sous TASK-22-006) confirmant lock-in ; cross-ref Status note sur `02-pos-cart-orders.md` si A1-3 entry existe ; Status note sur `23-tests.md` documentant le nouveau test pattern.

### Stream B — Dette technique ciblée

7. **WAC bypass guard (DEV-S17-1.B-01)** :
   - **Pre-flight empirical check (blocking gate)** : verify `receive_stock_v1.prosecdef = true` AND `proowner = 'postgres'` via `SELECT prosecdef, pg_get_userbyid(proowner) FROM pg_proc WHERE proname='receive_stock_v1'`. Si NOT, refactor required avant REVOKE et B.1 défère.
   - `REVOKE UPDATE (cost_price) ON public.products FROM authenticated, anon, PUBLIC` au niveau colonne. `service_role` intentionnellement retenu pour emergency ops (admin BO bulk fixes) ; RPC est néanmoins le path préféré documenté en COMMENT ON COLUMN.
   - Defense-in-depth pattern S20 : inclure `FROM PUBLIC` même si `authenticated`/`anon` listés (PUBLIC inheritance ACL caveat).
   - RPC SECURITY DEFINER `update_cost_price_v1(p_product_id UUID, p_new_cost NUMERIC, p_reason TEXT, p_idempotency_key UUID DEFAULT NULL)` qui :
     - check permission via `roles_permissions` join. Permission name décidé en INDEX §5 step 3 (préférence `inventory.cost_correction` ; fallback `inventory.write` si la première n'existe pas, décision tracée en INDEX §10 DEV-S22-1.B-NN).
     - emit `stock_movements` row `movement_type='cost_price_correction'` avec `notes` jsonb `{old_cost, new_cost, reason}`.
     - update `products.cost_price`.
     - return `{success: boolean, movement_id: UUID}`.
   - `receive_stock_v1` continue de fonctionner sans changement (tourne déjà en SECURITY DEFINER owned by `postgres` → bypass transparent du REVOKE — preflight le confirme).
   - pgTAP 4 asserts : direct UPDATE rejette, RPC SECURITY DEFINER passe, `receive_stock_v1` WAC continue, audit row émise.
8. **Retry-After 429 (DEV-S19-2.A-02)** :
   - Helper `rateLimitedResponse(retryAfterSec, msg)` dans `supabase/functions/_shared/responses.ts` (CREATE ou MODIFY si existe) qui retourne `Response` 429 avec headers `Retry-After: <integer seconds>`, `Content-Type: application/json`, `Access-Control-Expose-Headers: Retry-After` + corsHeaders existants.
   - Wired dans les 5 EFs : `auth-verify-pin`, `kiosk-issue-jwt` (2 sites pour 2 buckets), `refund-order`, `void-order`, `cancel-item`.
   - Vitest live test `supabase/tests/functions/rate-limit-retry-after.test.ts` trigger 429 sur 1 EF, asserts `response.headers.get('Retry-After')` est numérique entre 1 et 60.

---

## §2 — Non-goals (out of scope)

- **Compliance fiscale I1/I2/I3** — bloquée statut PKP business.
- **Mobile shell Capacitor** (TASK-18-***) — XL, hors timing.
- **WAC landed cost shipping pro-rata** (TASK-07-012) — défère, M, scope distinct du bypass guard.
- **WAC opt-out sample/promo** (DEV-S17-1.C-01) — défère.
- **WAC garbage-in stale current_stock** (DEV-S17-1.C-02) — défère.
- **Rotate `birthday-cron-daily` secret to vault.secrets** (DEV-S21-1.A.1-04) — défère, XS, hygiène séparée.
- **`mv_pl_monthly` branched (conditional reuse) reopen** (D-W6-6A-1) — accepted compromise S13, ne pas réouvrir (gain mesurable nul à Breakery scale).
- **Tous autres DEV-S17/S18/S19/S20/S21 informationals non listés** — ramassés au cycle suivant si pertinents.

---

## §3 — Streams & deliverables

2 streams parallèles sous Wave 1 après Wave 0 (spec/INDEX/branch). Wave 2 closeout serial.

### Wave 0 — Spec + INDEX + branch

- Spec `docs/workplan/specs/2026-05-18-session-22-spec.md` (ce document).
- INDEX `docs/workplan/plans/2026-05-18-session-22-INDEX.md`.
- Branche `swarm/session-22` off `master@20d484c` (post-S21 squash-merge PR #25).

### Wave 1 — Stream A : Focus-trap verification + lock-in

**Files :**
- `packages/ui/src/primitives/__tests__/Dialog.focus-trap.test.tsx` (CREATE — Tab/Shift+Tab cycles, Esc, focus restore).
- `packages/ui/src/primitives/__tests__/Sheet.focus-trap.test.tsx` (CREATE — idem pour Sheet drawer).
- `packages/ui/src/components/__tests__/FullScreenModal.focus-trap.test.tsx` (CREATE — wrapper test).
- `packages/ui/src/components/__tests__/CenterModal.focus-trap.test.tsx` (CREATE — wrapper test).
- `packages/eslint-config/src/rules/no-raw-modal-overlay.ts` (CREATE — TypeScript-aware ESLint rule).
- `packages/eslint-config/src/rules/__tests__/no-raw-modal-overlay.test.ts` (CREATE — RuleTester ≥ 5 cases).
- `packages/eslint-config/src/index.ts` (MODIFY — wire new rule, level `error`).
- `packages/eslint-config/package.json` (MODIFY si besoin — add `@typescript-eslint/utils` devDep).
- `docs/workplan/backlog-by-module/00-roadmap-globale.md` (MODIFY — strike item 5, S22 row, Indicateur).
- `docs/workplan/backlog-by-module/22-design-system.md` (MODIFY — Status note 2026-05-18).
- `docs/workplan/backlog-by-module/02-pos-cart-orders.md` (MODIFY si A1-3 entry — Status note).
- `docs/workplan/backlog-by-module/23-tests.md` (MODIFY — Status note nouveau pattern focus-trap RTL).

### Wave 1 — Stream B : Dette technique ciblée (B.1 + B.2)

**Files :**
- `supabase/migrations/20260526000010_revoke_direct_update_products_cost_price.sql` (CREATE — column-level REVOKE + ALTER DEFAULT PRIVILEGES sur `cost_price` column FROM authenticated, anon, service_role, PUBLIC).
- `supabase/migrations/20260526000011_create_update_cost_price_v1_rpc.sql` (CREATE — SECURITY DEFINER RPC avec permission check + audit row + UPDATE).
- `supabase/tests/products_cost_price_guard.test.sql` (CREATE — pgTAP 4 asserts).
- `supabase/functions/_shared/responses.ts` (CREATE si absent ; MODIFY si existe — helper `rateLimitedResponse`).
- `supabase/functions/auth-verify-pin/index.ts` (MODIFY — wire helper).
- `supabase/functions/kiosk-issue-jwt/index.ts` (MODIFY — wire helper sur 2 sites).
- `supabase/functions/refund-order/index.ts` (MODIFY — wire helper).
- `supabase/functions/void-order/index.ts` (MODIFY — wire helper).
- `supabase/functions/cancel-item/index.ts` (MODIFY — wire helper).
- `supabase/tests/functions/rate-limit-retry-after.test.ts` (CREATE — Vitest live).
- `packages/supabase/src/types.generated.ts` (MODIFY post-Wave 2 — regen pour `update_cost_price_v1`).

### Wave 2 — Closeout

**Files :**
- `packages/supabase/src/types.generated.ts` (MODIFY — types regen via MCP `generate_typescript_types`).
- `docs/workplan/plans/2026-05-18-session-22-INDEX.md` (MODIFY — fill §10 deviations + mark Phase 0.1 done).
- Commit final + push + PR.

---

## §4 — Risks & mitigations

| # | Risk | Severity | Mitigation |
|---|------|----------|------------|
| R1 | `REVOKE UPDATE (cost_price)` casse `receive_stock_v1` parce qu'il fait `UPDATE products SET cost_price = ...` | **High** | `receive_stock_v1` est SECURITY DEFINER owned by `postgres` → bypass transparent du REVOKE. **Pre-flight empirical check (blocking gate)** dans INDEX §5 Step 1 : `SELECT prosecdef, pg_get_userbyid(proowner) FROM pg_proc WHERE proname='receive_stock_v1'`. Si `prosecdef=false` OR `owner ≠ 'postgres'`, refactor avant REVOKE ou défère B.1. |
| R2 | `service_role` admin BO opérations cassent (par ex. import CSV ancien cost_price) | **Medium** | Les imports doivent passer par l'RPC `update_cost_price_v1`. Si script existant fait `UPDATE` direct via service_role, identifier et migrer. Grep `supabase/scripts/`, `apps/backoffice/src/features/products/` pour `cost_price.*update` patterns. |
| R3 | Tests ESLint custom rule échouent en CI parce que `@typescript-eslint/utils` RuleTester n'est pas wired | Medium | Add devDep + test runner config dans `packages/eslint-config/vitest.config.ts`. CI doit run `pnpm --filter @breakery/eslint-config test`. |
| R4 | `Retry-After` header overridden par CORS preflight ou stripped par middleware | Medium | Add `Access-Control-Expose-Headers: Retry-After` au response headers. Vérifier empiriquement via curl + assertion dans Vitest. |
| R5 | Focus-trap test flake sur jsdom Radix Portal (portal target not in DOM) | Low | Use `@testing-library/react` `render` with default container (Radix Portal monte sur `document.body` par défaut, accessible dans jsdom). Pattern déjà validé par `Dialog.test.tsx` existing. |
| R6 | ESLint rule trop large catch `position: fixed` legitime non-modal (ex. sticky header) | Medium | Restrict pattern à `fixed inset-0` ET pas `inset-x-*` / `inset-y-*` / `top-N` / etc. Tester avec un fixture sticky-header valid. |
| R7 | Le RPC `update_cost_price_v1` permission gate s'appuie sur un check permission qui n'existe pas | Medium | Check existence de `inventory.cost_correction` permission (ou équivalent) via `SELECT * FROM permissions WHERE code LIKE 'inventory.%'`. Si absente, créer dans migration `_011` ou utiliser `inventory.write` existante. |
| R8 | Stream A audit empirique manque un modal "custom" dans une feature non grep-able | Low | Le grep initial S22 a couvert `**/*Modal*.tsx` ET `**/*Dialog*.tsx`. Edge case : un `<div fixed inset-0>` sans nom Modal/Dialog. La règle ESLint le catch by design — c'est précisément son rôle. |

---

## §5 — Testing strategy

| Layer | Tool | Stream | Files |
|-------|------|--------|-------|
| RTL unit | Vitest + @testing-library/react | A | 4 nouveaux `*.focus-trap.test.tsx` |
| ESLint rule unit | Vitest + `@typescript-eslint/rule-tester` | A | 1 `no-raw-modal-overlay.test.ts` |
| Lint scan integration | `pnpm exec eslint` | A | run sur apps/pos + apps/backoffice + packages/* hors ui |
| pgTAP | `mcp__plugin_supabase_supabase__execute_sql` BEGIN/ROLLBACK | B.1 | `products_cost_price_guard.test.sql` (4 asserts) |
| Vitest live RPC | Vitest + service_role client | B.2 | `rate-limit-retry-after.test.ts` |
| Smoke manual | curl + dashboard inspection | B.2 | 1 EF post-deploy curl 5× sur même IP, vérifier `Retry-After` header |

---

## §6 — Data migration considerations

- **Stream A** : aucune data migration. Tests + lint + docs uniquement.
- **Stream B.1** : `REVOKE` au niveau colonne n'affecte pas les données existantes. Pas de backfill nécessaire. La data `products.cost_price` actuelle reste intacte. Toute lecture continue de fonctionner (REVOKE UPDATE n'affecte pas SELECT).
- **Stream B.2** : aucun changement schéma. Modification de comportement EFs côté response headers uniquement.

---

## §7 — Acceptance criteria (DoD globale)

- [ ] Branch `swarm/session-22` créé off `20d484c`.
- [ ] Spec + INDEX commités dans Wave 0.
- [ ] Wave 1 Stream A : 4 RTL focus-trap tests green + 1 ESLint rule test green + lint scan 0 nouveau error.
- [ ] Wave 1 Stream B.1 : 2 migrations appliquées sur V3 dev (`20260526000010..011`) + pgTAP 4/4 + `receive_stock_v1` smoke green.
- [ ] Wave 1 Stream B.2 : 5 EFs déployés avec Retry-After header + Vitest live green.
- [ ] Wave 2 : types regen committed + roadmap refresh + Status notes + INDEX §10 deviations + final quality gates (`pnpm typecheck && pnpm build && pnpm exec turbo run test --concurrency=1`) green.
- [ ] PR créée avec body listant les 2 streams + deviations + test plan.

---

## §10 — Deviations slot

*Finalized post-execution Wave 2. Format `DEV-S22-1.A-NN` (Stream A) / `DEV-S22-1.B-NN` (Stream B). Categories : informational | low | medium | high. Default informational unless marked.*

(filled after Wave 1 execution)
