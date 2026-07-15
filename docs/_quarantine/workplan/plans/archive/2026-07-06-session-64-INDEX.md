# Session 64 — INDEX (2026-07-06)

**Branche :** `swarm/session-64` · **Périmètre :** fiche 19 D2.1 (moyens de paiement configurables, ferme B1.1c/B1.7) + fix I-1 S63 (voids même-jour, décision propriétaire 2026-07-06).
**Spec :** `docs/superpowers/specs/2026-07-06-s64-configurable-payment-methods-design.md`
**Plan :** `docs/superpowers/plans/2026-07-06-s64-configurable-payment-methods.md`

## Livré

| Tâche | Commit | Contenu |
|---|---|---|
| T1 (DB) | `68cc978` | Migration **`20260710000115`** : colonne `business_config.enabled_payment_methods` JSONB NOT NULL DEFAULT (les 6) + CHECK array non vide ; branche `WHEN 'payments'` dans `get_settings_by_category_v1` ; validation `WHEN 'enabled_payment_methods'` dans `set_setting_v1` (array/non-vide/whitelist 6/anti-doublon, audit old-new hérité) ; trio S20 ; pgTAP `payment_methods_config` **11/11 live** ; types regen (+3 additifs). |
| T2 (BO) | `ad95900` | `SettingsPaymentMethodsPage` (draft/dirty/save, gates `settings.read`/`settings.update`, ordre canonique au save — anti dirty fantôme) ; route `settings/payment-methods` gated ; tuile hub « Payment Methods » activée ; `SettingsCategory` + `'payments'` ; smoke **3/3**. |
| T3 (POS) | `373e73e` | Hook `useEnabledPaymentMethods` (miroir `useTaxRate` : SELECT direct `business_config`, **fail-open = les 6**, staleTime 30 s + refetchInterval 60 s + refetch on focus) ; filtre des 2 grilles (`PaymentMethodGrid`, `PerPayerMethodStep` — tableaux distincts conservés) ; garde de désélection dans `usePaymentFlowLogic` (méthode draft désactivée → `selectedMethod: null`) ; hook tests 4/4 + rendus ; POS **607/608** (1 skip pré-existant). |
| T4 (DB) | `98f8812` | Migration **`20260710000116`** : fix **I-1** — `AND NOT r.is_full_void` dans les **3** soustractions de refunds (dashboard `revenue_today` + CTE `day_refunds` 30 j ; daily_sales CTE `day_refunds`), corps repris du live (DEV-S57-02), trio S20, `[types-noop]` ; pgTAP `net_revenue_full_void` **11/11 live** (pin : void même-jour → delta net 0 sur les DEUX RPCs ; partiel toujours soustrait) ; non-régression `dashboard_overview` **14/14** ; I-1 fermé dans l'INDEX S63. |

**Money-path non modifiée** (v17/v11/fire_v4/`_record_sale_stock_v1`/EF process-payment/`useCheckout` intouchés — T1/T4 = config + lecture pure ; T3 = filtre UI).
Défaut = les 6 méthodes → **zéro changement de comportement au déploiement**.

## Déviations

- **DEV-S64-01** : brainstorming interactif sauté (utilisateur AFK) — périmètre = fiche 19 D2.1 + décision I-1 actée en cours de session.
- **DEV-S64-02** : T1 appliquée via **API-from-file** (corps > seuil MCP inline) — bookkeeping migration inséré manuellement (`20260706143127`), pattern mémoire `workflow_supabase_api_from_file_runner`. `_116` (10,9 KB) est passée par MCP `apply_migration` standard.
- **DEV-S64-03** : session interrompue entre T2 (code écrit, non commité/non reviewé) et sa validation — reprise : tests+typecheck re-exécutés par le contrôleur, commit, puis revue de tâche normale (Approved). Aucun rapport implémenteur T2 (jugé sur pièces).
- **DEV-S64-04** : T3 — 3 harness de tests pré-existants réparés hors liste de fichiers du brief (`PaymentMethodGrid.smoke`, `SplitPaymentFlow.smoke`, `split-modes.smoke` : `QueryClientProvider` requis dès lors que les composants montent `useQuery`). Render-harness seulement, zéro assertion changée — cascade légitime adjugée en revue.
- **DEV-S64-05** : T4 — forme simple `AND NOT r.is_full_void` (sans COALESCE) : la colonne est `NOT NULL DEFAULT false`, simplification pré-autorisée par le plan.
- **DEV-S64-06 (P10, relevé pattern-guardian)** : `_116` réécrit `get_dashboard_overview_v1`/`get_daily_sales_v1` **in-place** (CREATE OR REPLACE, pas de bump `_v2`) malgré un vrai changement sémantique — assumé : RPCs de **lecture pure**, signatures inchangées, fix mandaté par décision propriétaire 2026-07-06, précédents S57 `_090`/S58 `_100`/S61 `_107-108`/S63 `_114`. Le trio S20 de `_116` omet volontairement `ALTER DEFAULT PRIVILEGES` (déjà posé S20, idempotent — pratique dominante du repo sur les REPLACE de fonctions déjà conformes).

## Dettes

- **D-1 (spec A.2.6)** : enforcement **UI-level v1** — l'EF `process-payment` accepte toujours les 6 méthodes ; un client malveillant/stale peut encaisser avec une méthode désactivée. Enforcement serveur = session future (COMMENT posé sur la colonne).
- **D-2** : les **tenders déjà ajoutés** et un **draft de payer split confirmé** ne sont pas re-gatés — une méthode désactivée après ajout part quand même (conséquence assumée de D-1). **Asymétrie relevée en revue finale** : la garde de désélection ne couvre que le flux single (`usePaymentFlowLogic.selectedMethod`) ; `PerPayerMethodStep` n'a pas d'équivalent — un payer split **non confirmé** ayant déjà choisi une méthode désactivée peut encore confirmer avec (vérifié non-cassant : la garde ne touche jamais `tenders` ni `payer.method`).
- **D-3** : effet « ≤ 60 s » par **polling** (staleTime 30 s + refetchInterval 60 s) — realtime différé.
- **D-4** (T1 review) : t9_perm teste le 42501 via un sub aléatoire, pas un vrai rôle sans `settings.update` (matrice RBAC non exercée) ; pas d'assertion `p_value='null'::jsonb`.
- **D-5** (T2 review) : si la contrainte DB (array non vide) était un jour relâchée, le fallback non-array de la page laisse `dirty=false` (Save silencieusement indisponible) ; pas de test du chemin d'erreur RPC de `handleSave`.
- **D-6** (T3 review) : garde de désélection sans test direct ; pas de test mixed valid/invalid dans le hook.
- **D-7** (T4 review) : `COMMENT ON FUNCTION` des 2 RPCs non restaté (le carve-out full-void n'apparaît pas dans les comments) ; pin T11 combiné (void+partiel) plutôt qu'isolé.
- **D-9 (sémantique, revue finale)** : `_116` change le sens de **`daily_sales.summary.refund_total`** (et `by_day[].refunds`) — il ne compte plus que les **refunds partiels** (full-voids exclus), aligné sur le nouveau net. Voulu (décision propriétaire) et pinné T07/T10, mais un lecteur futur ne doit pas le lire comme « tous les refunds ».
- **D-10 (infra tests, pré-existant)** : la suite POS complète flake par timeouts 15 s sous pleine parallélisation locale (3 runs → 3 fichiers différents, verts isolés/à 2 forks). Options futures : bump `testTimeout` 15→30 s, ou capper `maxForks` dans `vitest.config.ts`, ou per-file timeout sur les smokes au gros graphe d'import.
- ~~D-8~~ **spot-check bookkeeping fait en closeout** : `enabled_payment_methods` (20260706143127, insert manuel DEV-S64-02) et `net_revenue_exclude_full_void_refunds` (20260706151628, MCP clock-stamped) tous deux présents dans `schema_migrations` — pas de drift S64.

## Tests (closeout)

- pgTAP live : `payment_methods_config` 11/11 · `net_revenue_full_void` 11/11 · ancre `dashboard_overview` 14/14.
- Vitest : BO smoke SettingsPaymentMethodsPage 3/3 · POS 607/608 (1 skip pré-existant).
- Suite monorepo : typecheck 6/6 ✓, build 2/2 ✓, tests domain/ui/supabase/BO ✓. **POS : 151 fichiers / 607 verts + 1 skip** — mais 3 runs pleins ont chacun fait timeouter (15 s) **un fichier différent** (`void-idempotency-header`, `pos-grid-hides-variants`, `discount.smoke`), tous **verts isolés** et **verts en run complet à 2 forks** (`--poolOptions.forks.maxForks=2`). Cause : contention des workers vitest sous charge sur la machine dev (problème connu et documenté dans `apps/pos/vitest.config.ts` depuis la S9 — le graphe de modules a encore grossi). Aucun des 3 fichiers n'est touché par S64. → dette D-10.

## Revue finale de branche

- **pattern-guardian** : aucune violation HIGH. 3 INFO — P10 in-place `_116` (→ DEV-S64-06), omission volontaire `ALTER DEFAULT PRIVILEGES` dans le trio `_116` (→ DEV-S64-06), enforcement UI-only (→ D-1). Money-path, BEGIN/COMMIT, INSERT bruts, stock_movements, audit_logs, domain IO-free, channels, PIN header, < 500 lignes : tous passés sans réserve.
- **Revue whole-branch** : **Ready to merge — 0 Critical, 0 Important**, 3 Minor actés (commentaire de couplage posé sur la page BO ; asymétrie split → D-2 ; sémantique `refund_total` → D-9). Triage des findings per-task : aucun bloquant, tous en dettes D-4..D-7.
