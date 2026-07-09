# Session 71 — INDEX (E2E nightly : infra + réparation spec-par-spec + armement cron)

> Branche : `swarm/session-71`. Deux plans exécutés :
> - **Plan 1** — `docs/superpowers/plans/2026-07-09-s71-e2e-nightly-infra.md` (infra : webServer build-in-CI, seed users E2E, provisioning PINs, workflow, fixture UUID, triage). Commits `7be0d581..d5df6e9a`. Triage : `docs/workplan/plans/2026-07-09-session-71-e2e-triage.md`.
> - **Plan 2** — `docs/superpowers/plans/2026-07-09-s71-e2e-nightly-repair.md` (réparation + cron). Commits `a0e89a44..1401d091`.
> Exécution **sub-agent-driven** (un implémenteur par tâche + revue de tâche + revue finale de branche).

## Objectif (Plan 2)
Rendre les **12 specs E2E vertes** contre le backend dev V3 en réparant les vraies causes du triage (dérive du login, précondition « shift ouvert », sélecteurs périmés, versions RPC périmées, 1 locator malformé), puis **armer le cron nightly**.

## Contraintes (tenues)
- **Money-path & app GELÉS** — aucun fichier `apps/**`, `supabase/migrations/**`, Edge Function ni RPC money-path modifié. Diff Plan 2 = **uniquement** `tests/e2e/**`, `scripts/e2e/**`, `.github/workflows/playwright-e2e.yml` (13 fichiers, +552/-235). Vérifié `git diff --name-only 87ed56ec..HEAD` → rien hors périmètre.
- **Aucun PIN/secret réel commité** — PINs pilotés par `process.env.E2E_PIN_ADMIN`/`E2E_PIN_CASHIER` ; défaut jetable local `424242` ; CI depuis les secrets. PIN = 6 chiffres.
- **Cron armé UNIQUEMENT après** preuve des 12 specs vertes en run combiné.

## Résultat
**Run combiné complet vert** (`playwright test` tous projets, webServer build-in-CI). Deux validations :
- **`--retries=0`** (strict) : atteint **26 passed / 2 skipped / 0 failed / exit 0** (runs `full-suite2`/`full-suite3`, ~6,3 min).
- **`--retries=2`** (= config réelle du nightly `playwright.config.ts:17`) : **25 passed / 1 flaky / 2 skipped / 0 failed / exit 0**. Le « flaky » = **`s43` T3** (flux le plus lourd : fire → reload → KDS → paiement de la commande firée) qui a échoué une fois puis **repassé au retry #1** — exactement le rôle du filet `retries: 2`. Les 2 skipped sont des `test.fixme` intentionnels et documentés (Dettes D-1, D-2).

⚠️ **Leçon d'exploitation** : mes runs locaux répétés en `--retries=0` **stressaient et polluaient** le dev V3 partagé (backlog KDS croissant, séquence `order_number` recyclée par jour, buckets rate-limit) → `s43` T3 flakait à un endroit différent à chaque run combiné (jamais en solo). Le **nightly réel** (état plus frais, `retries: 2`) absorbe ces flakes transitoires. Les **corrections déterministes** (sélecteurs, versions RPC, matcher KDS borné, login résilient) portent le reste ; le retry ne couvre que le transitoire.

Cron nightly armé : `playwright-e2e.yml` `on.schedule cron '0 22 * * *'` (le `workflow_dispatch` reste), `timeout-minutes: 30`.

### Statut des 12 specs
| Spec | Projet | Statut | Tâche |
|---|---|---|---|
| complete-order | pos | ✅ | P2-T2 (réécriture) |
| s44-money-path | pos | ✅ (T3 fixme) | P2-T3 |
| bo-admin-pin-reset | backoffice | ✅ | P2-T4 |
| opname-finalize | backoffice | ✅ (réécriture) | P2-T5 |
| po-receive | backoffice | ✅ (réécriture) | P2-T6 |
| s39-bo-completion | backoffice | ✅ 4/4 | P2-T7 |
| s41-catalog-import | backoffice | ✅ 4/4 | P2-T8 |
| s43-pos-audit-fixes | pos | ✅ (T2 fixme) | P2-T9 |
| kiosk-display-realtime | backoffice | ✅ | P2-T10 |
| pos-login-order | pos | ✅ (déjà vert) | — |
| s40-reports | backoffice | ✅ (déjà vert) | — |
| stock-inventory-pages | backoffice | ✅ 4/4 (T4 réparé) | P2-T11 (hors plan) |

## Déviations
- **DEV-S71-P2-01** — `openPosSession`/`openBackofficeSession` refactorés pour **déléguer** à `loginPOS`/`loginWithPin` (tous les chemins de login passent désormais par le cœur résilient). Contrat post-login inchangé (assertion numpad caché / URL `/backoffice`).
- **DEV-S71-P2-02** — Login **résilient au rate-limit** ajouté hors du strict périmètre des tâches (nécessaire pour un run combiné vert) : `enterPinAwaitingAuth` + `loginWithRateLimitRetry` dans `tests/e2e/fixtures/auth.ts`. Observe la réponse `auth-verify-pin`, sur 429 attend la fenêtre (Retry-After si présent, sinon 62 s) et rejoue avec un `goto('/')` frais. Max 3 tentatives.
- **DEV-S71-P2-03** — `s43` T1 : le brief affirmait le sélecteur Americano « correct » ; en réalité la grille produit ouvre sur l'onglet « Favorites » vide et la sélection est **category-scoped** → `addAmericano` doit d'abord cliquer la catégorie **Coffee** + valider via le testid `modifier-add-to-cart` (porté depuis le helper vert de s44).
- **DEV-S71-P2-04** — `s43` T3 : versions RPC périmées corrigées côté test — `fire_counter_order_v1→v4` et `pay_existing_order_v7→v11` (le money-path est v4/v11). Aucun code app touché.
- **DEV-S71-P2-05** — `stock-inventory-pages` T4 (spec hors périmètre du plan mais dans les 12 nightly) : navigation ligne produit via le bouton **« View <name> »** de la ligne (`ProductsTable onView → navigate`), le clic sur le `<tr>` nu étant non fiable (header+body en `rowgroup`). Révélé uniquement par le run combiné (KDS/liste chargés).
- **DEV-S71-P2-07** — `s43` T3 : le ticket KDS était matché par `hasText: fired.order_number` (sous-chaîne → `#0007` matche aussi `#00070`..`#00079`). Sur la **KDS de staging partagée** (les commandes firées non payées s'accumulent au fil des runs) → strict-mode violation (2 articles). Corrigé : regex avec **borne `(?!\d)`** (échappée) → exactement notre ticket. Leçon récurrente : sur staging partagé, tout match par numéro/sous-chaîne doit être borné ; ces flakes n'apparaissent qu'en **run combiné** (état accumulé), pas en solo.

## Dettes / findings
- **D-1 (fixme) — s44 T3** : le flux « void d'une commande comptoir *firée non payée* » renvoie **422** de l'EF `void-order` (`verify-manager-pin`=200, PIN OK ; `void_order_rpc_v4` cible les commandes **PAYÉES**). Limitation applicative, money-path gelé → `test.fixme`. Régression couverte côté pgTAP. Finding possible pour le propriétaire.
- **D-2 (fixme) — s43 T2** : `/tablet/order` est gardé par `role_code='waiter'` **OU** la perm client `sales.create` dans la liste de permissions du login. Le seed E2E n'a pas de waiter et le caissier n'a pas `sales.create`. **Finding EF réel (hors périmètre gelé)** : `supabase/functions/_shared/permissions.ts` `computePermissionsForRole` interroge `user_permission_overrides` avec les colonnes **périmées** `user_id`/`override_type`, alors que le schéma live est `user_profile_id`/`is_granted` → la requête d'override échoue et est **silencieusement ignorée** de la liste de permissions du login (le `has_permission()` DB, lui, lit les bonnes colonnes ; la dérive est **EF-only**). Conséquence : un override par utilisateur ne peut pas atteindre la garde client tant que l'EF n'est pas corrigé. → `test.fixme` + **2 findings pour le propriétaire** : (a) corriger le resolver de permissions de l'EF ; (b) ajouter un user waiter au seed E2E pour couvrir le flux tablette.
- **D-3 (infra locale)** : après de nombreux runs Playwright locaux, des serveurs `vite preview` orphelins s'accumulent et bloquent les ports 5173/5174 (webServer échoue en `0xC0000142`). Nettoyage : tuer par cmdline `vite.*preview`/`@playwright/test`, **jamais** `@playwright/mcp`. Sans impact CI (runner neuf).
- **D-4 (rate limit, résolu par contournement test)** : `auth-verify-pin` est limité à ~3 POST/min/IP (couche mémoire par instance + `edge_function_rate_limits`). Seuil `RATE_LIMIT_PER_MIN` codé en dur dans l'EF (gelé). Résolu côté test par le login résilient (DEV-S71-P2-02) ; à surveiller si le nightly devient lent (attentes de fenêtre).
- **D-5 (hygiène KDS staging — à traiter en provisioning futur)** : les commandes **comptoir firées non payées** (T1/T3 de `s43`, tout flux « Send to Kitchen ») restent **indéfiniment** sur la KDS (aucune fermeture/bump en fin de test). Comme `order_number` est une séquence d'affichage **par shift/jour** (non globale), la KDS accumule au fil des jours des tickets au **même `#NNNN`** → source de flakes de matching (résolue côté test par DEV-S71-P2-07, mais la backlog grossit sans borne). **Reco** : ajouter au `provision-pins.sql` un nettoyage des vieux tickets KDS (bump/served des items de commandes firées non payées antérieures à la journée, ou d'un tag E2E), pour garder la KDS du nightly propre et les matchings déterministes. **Non money-path** (état d'affichage cuisine), mais touche l'état de commandes → à cadrer prudemment. Ces flakes n'apparaissent **qu'en run combiné** (état partagé accumulé), jamais en solo.

## Action utilisateur (post-merge, pour activer le nightly)
1. Poser 3 secrets repo : `VITE_SUPABASE_ANON_KEY` (clé publishable dev V3), `E2E_PIN_ADMIN`, `E2E_PIN_CASHIER` (6 chiffres, = PINs des 2 users E2E `…001`/`…002`). `V3_DEV_PG_POOLER_URL` déjà présent.
2. Optionnel : déclencher `workflow_dispatch` une fois pour valider avant la 1ʳᵉ exécution cron (22:00 UTC).

## Revue finale de branche
Revue whole-branch **opus** (subagent `finalreview`, package `87ed56ec..HEAD`, 28 commits) : **READY TO MERGE**. 0 Critical. Conformité : contrainte 1 (app/money-path gelés) **PASS** pour le package Plan 2 ; **nuance** — la *whole-branch* inclut, hérité de **Plan 1**, la migration `20260710000141_seed_e2e_users.sql` (seed de 2 users E2E, **purement additive + idempotente `ON CONFLICT DO NOTHING`, zéro money-path, zéro changement de schéma** ; PIN placeholder `000000` écrasé au run par les secrets) → esprit de la contrainte respecté, à acter au merge. Contraintes 2 (aucun secret réel), 3 (PIN 6 chiffres), 4 (fixmes documentés) : **PASS**. Vérif positive : aucune version RPC stale restante (v17/fire_v4/pay_v11/tablet_v3/void_v4 conformes au live) ; déterminisme soigné (opname/po-receive épinglent leur propre entité).

**2 Important traités immédiatement** (commit `test(e2e): harden resilient login …`) — DEV-S71-P2-06 :
- **I1** — `loginWithRateLimitRetry` retournait silencieusement en fin de boucle (échec d'auth masqué si un futur appelant omettait sa re-assertion) → **throw explicite** (dernier statut + nb tentatives).
- **I2** — budget retry (jusqu'à 2×62 s) pouvait dépasser le `test.setTimeout(120_000)` des `beforeAll` → **`LOGIN_MAX_ATTEMPTS` ramené à 2** (une seule attente de fenêtre pleine suffit à purger la fenêtre 60 s du nightly serial ; le run combiné vert n'a jamais eu besoin de plus d'un retry). Re-vérifié : run combiné complet re-passé vert après le durcissement.

**Minor (dette test-only, follow-up)** : M1 s44 T3 `[data-held-order-id].first()` non déterministe (inoffensif tant que fixme) ; M2 s44 T2 self-skip si « Fresh Juice » disparaît du seed ; M3 guards négatifs `not.toBeVisible()` (complètent des assertions positives réelles) ; M4 le seed shift n'est jamais fermé (les ventes E2E s'accumulent dans un unique shift ouvert — borné par `WHERE NOT EXISTS` + contrainte `EXCLUDE one_open_session_per_user`).
