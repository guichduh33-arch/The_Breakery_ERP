# Session 21 — Polish hardening reliquat — Spec

> Date authored: 2026-05-18
> Branch: `swarm/session-21`
> Migration block: `20260525000010..099`
> Theme: ramasser 8 follow-ups hardening + UX polish reliquat des sessions S13–S19 en une seule session via 3 streams parallèles.

---

## §0 — Context

Les sessions S13–S20 ont fermé les gros chantiers : V3 monorepo, anon-RLS, GRANT defense-in-depth, recipe cost history, rate-limit durable, session timeout per role, PIN strength warn. Ce qui reste actionnable côté hardening+polish (hors compliance fiscale bloquée business + mobile shell Capacitor XL) est un agrégat de 5 follow-ups officiels (roadmap §"Ce qui reste" §2) + 3 micro-fixes UX/UI tracés en INDEX §10 de S19.

S21 ramasse les 8 d'un coup pour clore proprement le cycle hardening avant de pivoter vers compliance fiscale (si PKP confirmé) ou mobile shell.

| # | Item | Source | Module | Estim |
|---|------|--------|--------|-------|
| 1 | LAN message dedup TTL 5s (hub + client) | `08-operations-lan-audit.md§P1-1`, roadmap §Actifs ligne 3 | 21-lan | M ~3h |
| 2 | Playwright E2E en CI (3 flows smoke ciblés) | D-W6-6C-05, roadmap §Actifs ligne 6 | 23-tests | M ~6h |
| 3 | `pg_net`-based birthday cron | D-W6-6B-02 (S13 follow-up déféré) | 08-customers | S ~1.5h |
| 4 | Cash Flow Investing/Financing sections | D-W6-6A-2 (S13 follow-up déféré) | 11-accounting | M ~3h |
| 5 | `staging-deploy.yml` secrets wiring | D-W6-CICD-01 (S13 follow-up déféré) | 24-cicd | S ~1h |
| 6 | `useIdleTimeout` "About to sign out" warning toast | DEV-S19-3.A-01 | 01-auth + ui | S ~1h |
| 7 | BO `UserDetailPage` 4-vs-6 PIN format mismatch | DEV-S19-3.B-01 | 01-auth | XS ~0.5h |
| 8 | POS `ChangePinModal` UX polish (3 sub-fixes) | DEV-S19-3.C-01..03 | 02-pos | S-M ~2h |

**Total estim** : ~18h serial ; ~7h wall-time avec 3 streams parallèles (max stream).

---

## §1 — Goals (success criteria)

1. **LAN dedup** : doublons de messages côté hub OU client supprimés via TTL 5s en mémoire. Test unitaire packages/lan-bus prouve dedup. Smoke réseau : envoyer le même message 3× en < 5s ne le re-broadcast pas.
2. **Playwright E2E** : `playwright-e2e.yml` GitHub Actions job vert sur 3 flows : (a) POS PIN login → place complete_order → logout ; (b) BO admin reset un PIN user ; (c) Kiosk display load + Supabase Realtime fires on new order. Nightly cron + manual workflow_dispatch. Tests scellés contre V3 dev via secrets.
3. **pg_net birthday cron** : extension `pg_net` activée (ou alternative documentée) ; cron pg_cron `birthday-daily` schedule daily à 09:00 ICT appelle EF `customer-birthday-notify` qui ramasse les `customers.birth_date` du jour et envoie via `notification_outbox`.
4. **Cash Flow Investing/Financing** : `accounts.cash_flow_section` ENUM `operating|investing|financing|none` (default `operating` pour comptes existants) ; RPC `cash_flow_v1` retourne désormais 3 sections (sortie shape change : `operating_total`, `investing_total`, `financing_total`, `net_change`) ; BO Cash Flow report UI rend les 3 sections.
5. **staging-deploy.yml secrets** : workflow staging-deploy charge ses secrets via `${{ secrets.STAGING_SUPABASE_URL }}` et `${{ secrets.STAGING_SUPABASE_SERVICE_ROLE_KEY }}` ; documentation README dans `.github/workflows/STAGING_SETUP.md` ; ancien hard-codage des `.env.staging` (si présent) retiré.
6. **Idle warning toast** : 30 secondes avant `useIdleTimeout` fire, toast "Session expires in 30s — click to stay signed in" s'affiche avec bouton "Stay" qui réinitialise le timer.
7. **PIN format regex** : `UserDetailPage` PIN reset input validation passe de `^\d{4,8}$` à `^\d{6}$` pour matcher l'EF `auth-change-pin` (qui exige exactement 6 chiffres).
8. **ChangePinModal UX** :
   - (a) Remplacer `NumpadPin` (collection) par `PinPad` (verification-only) — convention nommage S19 (DEV-S19-3.C-01).
   - (b) Surface du hint de force PIN à step 2 (saisie) au lieu de step 3 (confirmation) (DEV-S19-3.C-02).
   - (c) Sur mismatch new/confirm, reset à step 2 (saisie) au lieu de step 1 (verify ancien PIN) — convention UX (DEV-S19-3.C-03).

---

## §2 — Non-goals (out of scope)

- **Mobile shell Capacitor** (TASK-18-***) — XL, hors timing.
- **WAC landed cost** (TASK-07-012) — défère S22+.
- **Compliance fiscale I1/I2/I3** — bloquée business (PKP).
- **Modal focus-trap migration** (cross-modules P1, L) — défère S22+, scope trop large.
- **`mv_pl_monthly` branched reuse** (D-W6-6A-1) — défère, optimisation cosmétique.
- **Autres DEV-S17/S18 informationals** (CSV locale, X-axis date format, no zoom, manual cost_price bypass, etc.) — pas dans le ramassage S21.

---

## §3 — Streams & deliverables

3 streams parallèles sous Wave 1 après Wave 0 (spec/INDEX/branch). Wave 2 closeout serial.

### Wave 0 — Spec + INDEX + branch

- Spec `docs/workplan/specs/2026-05-18-session-21-spec.md` (ce document).
- INDEX `docs/workplan/plans/2026-05-18-session-21-INDEX.md`.
- Branche `swarm/session-21` off `master@bd1374e` (post-S20 squash-merge).

### Wave 1 — Stream A : DB+EF (items 3 + 4)

**Files :**
- `supabase/migrations/20260525000010_enable_pg_net_extension.sql` (CREATE — pg_net + safety check) OU `..010_alt_pg_cron_webhook_birthday.sql` si pg_net indisponible.
- `supabase/migrations/20260525000011_schedule_birthday_cron.sql` (CREATE — pg_cron job appelant EF via `net.http_post`).
- `supabase/functions/customer-birthday-notify/index.ts` (CREATE — EF service_role qui scanne `customers.birth_date` du jour et insère dans `notification_outbox`).
- `supabase/functions/customer-birthday-notify/__tests__/birthday.test.ts` (CREATE — Vitest live test).
- `supabase/migrations/20260525000020_add_cash_flow_section_to_accounts.sql` (CREATE — ENUM + column + default seed).
- `supabase/migrations/20260525000021_update_cash_flow_v1_to_3sections.sql` (CREATE — replace RPC, breaking shape change).
- `supabase/tests/cash_flow_v1.test.sql` (CREATE — pgTAP : 3 sections balance, edge cases empty/single-section).
- `packages/domain/src/accounting/__tests__/cash-flow-shape.test.ts` (MODIFY si existe — adapter au shape 3-sections).
- `apps/backoffice/src/features/reports/cash-flow/CashFlowReport.tsx` (MODIFY — render 3 sections).

**Effort** : ~4.5h. **Subagent suggéré** : `backend-dev` sonnet.

### Wave 1 — Stream B : Infra+CI (items 2 + 5)

**Files :**
- `.github/workflows/playwright-e2e.yml` (CREATE — nightly cron + manual dispatch + matrix browsers).
- `playwright.config.ts` (CREATE à racine — baseURL = V3 dev URL, screenshot on failure, retries 2).
- `tests/e2e/pos-login-order.spec.ts` (CREATE — flow 1).
- `tests/e2e/bo-admin-pin-reset.spec.ts` (CREATE — flow 2).
- `tests/e2e/kiosk-display-realtime.spec.ts` (CREATE — flow 3, écoute Supabase Realtime).
- `tests/e2e/fixtures/auth.ts` (CREATE — helper PIN login via service_role).
- `package.json` (MODIFY racine — ajoute `playwright` devDependency + scripts `test:e2e`).
- `.github/workflows/staging-deploy.yml` (MODIFY — secrets wiring + remove hardcoded).
- `.github/workflows/STAGING_SETUP.md` (CREATE — doc).

**Effort** : ~7h. **Subagent suggéré** : `cicd-engineer` sonnet (lui-même peut sous-dispatcher si overload).

### Wave 1 — Stream C : UI+LAN (items 1 + 6 + 7 + 8)

**Files :**
- `packages/lan-bus/src/dedup.ts` (CREATE — TTL Map<msgId, expiry>).
- `packages/lan-bus/src/hub.ts` (MODIFY — wire dedup avant broadcast).
- `packages/lan-bus/src/client.ts` (MODIFY — wire dedup côté réception).
- `packages/lan-bus/src/__tests__/dedup.test.ts` (CREATE — TTL 5s, idempotence prouvée).
- `packages/ui/src/hooks/useIdleTimeout.ts` (MODIFY — émettre warning event 30s avant fire).
- `packages/ui/src/components/IdleWarningToast.tsx` (CREATE — toast + bouton "Stay").
- `apps/pos/src/App.tsx` ou layout root (MODIFY — mount `IdleWarningToast`).
- `apps/backoffice/src/App.tsx` ou layout root (MODIFY — mount `IdleWarningToast`).
- `apps/backoffice/src/features/users/UserDetailPage.tsx` (MODIFY — regex `^\d{6}$`).
- `apps/pos/src/features/auth/ChangePinModal.tsx` (MODIFY — swap NumpadPin→PinPad + hint timing + mismatch step reset).
- `apps/pos/src/features/auth/__tests__/ChangePinModal.test.tsx` (MODIFY/CREATE — 3 RTL tests : PinPad rendered, hint at step 2, mismatch resets to step 2).

**Effort** : ~6.5h. **Subagent suggéré** : `coder` sonnet.

### Wave 2 — Closeout

1. Types regen via MCP `generate_typescript_types` (sera non-vide si items 3+4 ajoutent column/RPC).
2. Mise à jour `00-roadmap-globale.md` : rayer items #3 + #6 des Actifs, ajouter ligne S21 dans Sessions, refresh Indicateurs.
3. Status notes append (S21 update) sur : `21-lan.md`, `23-tests.md`, `08-customers-loyalty.md`, `11-accounting.md`, `24-cicd.md`, `01-auth-permissions.md`, `02-pos-core.md`.
4. INDEX §10 deviations finalisées.
5. Commit closeout + push branche + PR squash-merge.

---

## §4 — Risks & mitigations

| # | Risk | Stream | Likelihood | Mitigation |
|---|------|--------|------------|------------|
| R1 | `pg_net` extension non dispo sur Supabase Pro V3 dev | A | Medium | Vérifier via `SELECT * FROM pg_extension WHERE extname='pg_net'` + `pg_available_extensions`. Si indisponible, fallback `pg_cron` direct call à un Edge Function via `supabase_functions.http_request` (extension Supabase built-in) ou désactiver le cron et ouvrir un follow-up. |
| R2 | Cash Flow shape breaking change casse une consumer existante | A | Low | Grep `cash_flow_v1` dans `apps/` + `packages/`. Le seul consumer attendu est `apps/backoffice/src/features/reports/cash-flow/`. Migration RPC est forward-only ; pas de retour arrière. |
| R3 | Playwright tests flaky sur 1st run (sélecteurs UI) | B | High | Utiliser `data-testid` partout, jamais `getByText` ; retries=2 dans config ; nightly seulement (pas blocking PR) ; documenter dans STAGING_SETUP.md. |
| R4 | `staging-deploy.yml` secrets pas encore configurés côté repo | B | Medium | Vérifier `gh secret list --repo guichduh33-arch/The_Breakery_ERP`. Si secrets manquent, le workflow attendra le runtime — créer task follow-up et documenter dans STAGING_SETUP.md. |
| R5 | `IdleWarningToast` mount à 2 endroits (POS+BO) crée 2× déclenchements si l'utilisateur a les deux ouverts | C | Low | Chaque app a sa propre session GoTrue séparée, donc 2 warnings simultanés sont attendus et corrects. |
| R6 | `ChangePinModal` swap NumpadPin→PinPad casse les test snapshots existants | C | Medium | Lire et adapter `__tests__/ChangePinModal.test.tsx` au nouveau composant. |
| R7 | Stream A & C touchent indirectement `packages/supabase` (types regen) | A+C | Low | Closeout serializes regen après tous les streams done. |
| R8 | LAN dedup TTL 5s peut masquer un message légitime retransmis intentionnellement | C | Low | Dedup key = `messageId` (UUID), pas le payload. Une retransmission intentionnelle utilise un nouveau messageId. Documenter. |

---

## §5 — Smoke test plan

### Stream A
- [ ] `SELECT * FROM cron.job WHERE jobname='birthday-daily'` → 1 row, schedule `0 9 * * *`.
- [ ] Manuel : insérer un `customers` avec `birth_date = CURRENT_DATE`, déclencher la fonction birthday-notify manuellement, vérifier `notification_outbox` reçoit la row.
- [ ] `SELECT cash_flow_v1(...)` retourne `{operating_total, investing_total, financing_total, net_change}`.
- [ ] BO Cash Flow report rend 3 sections (déféré deploy-time si autonomous).

### Stream B
- [ ] `gh workflow run playwright-e2e.yml` → vert sur 3 flows.
- [ ] Staging-deploy workflow dispatch → vert avec secrets.

### Stream C
- [ ] `pnpm --filter @breakery/lan-bus test` → dedup test pass.
- [ ] Idle warning : POS reste ouvert 30s avant le timeout → toast visible (déféré deploy-time si autonomous).
- [ ] BO UserDetailPage PIN reset : entrée 5 chiffres → invalid ; 6 chiffres → submit OK.
- [ ] POS ChangePinModal : 3 RTL tests verts.

---

## §6 — Migration list (planned)

| # | File | Stream | Purpose |
|---|------|--------|---------|
| 1 | `20260525000010_enable_pg_net_extension.sql` (ou fallback) | A | Enable pg_net OU note no-op si fallback pg_cron+supabase_functions |
| 2 | `20260525000011_schedule_birthday_cron.sql` | A | pg_cron job daily 09:00 ICT |
| 3 | `20260525000020_add_cash_flow_section_to_accounts.sql` | A | ENUM + column + seed |
| 4 | `20260525000021_update_cash_flow_v1_to_3sections.sql` | A | Replace RPC (breaking shape) |

Block réservé : `20260525000010..099`. Corrective migrations (si nécessaires) landent à `..050..099`.

---

## §7 — pgTAP test list (planned)

| File | Stream | Assertions |
|------|--------|------------|
| `supabase/tests/cash_flow_v1.test.sql` | A | ~5 — shape (3 sections+net), balance constraints, empty edge case |

Aucun nouveau test pgTAP pour Stream B/C (Playwright + Vitest + RTL couvrent).

---

## §8 — Execution model

- **Branch :** `swarm/session-21` off `master@bd1374e`.
- **Commits :** 1+ par item, regroupés par stream commit-by-stream ou commit-by-item au choix de l'implémenteur. Squash-merge unique en PR.
- **Subagents :** 3 streams en parallèle via `Agent({run_in_background:true})`. Wave 0 serial (lead). Wave 2 serial (lead).
- **Migration apply :** MCP `apply_migration` sur V3 dev `ikcyvlovptebroadgtvd`. Docker retired.
- **Types regen :** en Wave 2 après tous les streams done.
- **UI smoke :** déféré deploy-time (mode autonome).

---

## §9 — Acceptance criteria checklist

- [ ] Stream A : 4 migrations appliquées sur V3 dev, pg_net (ou fallback) actif, birthday cron schedulé, Cash Flow v1 retourne 3 sections, BO Cash Flow UI rend 3 sections.
- [ ] Stream B : Playwright workflow vert (3 flows), staging-deploy.yml secrets wired + doc.
- [ ] Stream C : LAN dedup TTL 5s testé, Idle warning toast monté POS+BO, BO PIN regex fixed, ChangePinModal 3 sub-fixes + tests verts.
- [ ] Wave 2 : types regen committed, roadmap refresh, 7 Status notes, INDEX §10 deviations.
- [ ] `pnpm typecheck`, `pnpm test`, `pnpm build` green (sauf pre-existing flakes).
- [ ] PR opened `swarm/session-21` → `master`, squash-merge, branche supprimée.

---

## §10 — References

- S13 follow-ups : `docs/workplan/plans/2026-05-17-session-13-INDEX.md` §10 (D-W6-* IDs).
- S19 follow-ups : `docs/workplan/plans/2026-05-17-session-19-INDEX.md` §10 (DEV-S19-3.A/B/C).
- LAN audit : `docs/audit/08-operations-lan-audit.md` §P1-1.
- Roadmap : `docs/workplan/backlog-by-module/00-roadmap-globale.md`.
- CLAUDE.md critical patterns : DB cloud V3 dev, PIN auth fetch wrapper, Realtime channel uniqueness, packages/domain IO-free, RPC versioning monotonic, RPC EXECUTE REVOKE-from-anon (S19/S20).
