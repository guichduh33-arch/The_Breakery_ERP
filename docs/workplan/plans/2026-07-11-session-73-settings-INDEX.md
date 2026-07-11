# Session 73 — Refonte modules Settings (POS + BO) — INDEX

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement, task-by-task.

**Source** : audit validé [`docs/workplan/audits/settings-pos-bo-audit.md`](../audits/settings-pos-bo-audit.md)
(décisions propriétaire 2026-07-11 : A4 supprimer Automation · A5 câbler discount presets ·
B5 NPWP reporté · B1 implémenter Notifications + Customer Display org + Printing org,
lier Categories/Product Types/Settings History, fusionner Network Devices, Floor Plan +
KDS Config en session dédiée avec tuiles marquées « Planned »).

**Branche** : `swarm/session-73-settings` — 3 PRs empilées, squash-merge par lot.

| Lot | Plan | Contenu | DB ? |
|---|---|---|---|
| **1 — POS fixes** | [`2026-07-11-session-73-settings-plan-pos.md`](2026-07-11-session-73-settings-plan-pos.md) | A1 verrou Printing (P0), A3 rename « Customer Display », A2 badges portée, A4 suppr. Automation, A6 URL mono-surface, A5 câblage discount presets (UI + call-sites) | non |
| **2 — Promotion org** | [`2026-07-11-session-73-settings-plan-org-db.md`](2026-07-11-session-73-settings-plan-org-db.md) | Migration `_159` (4 colonnes + 2 catégories RPC), pgTAP, types regen, hooks POS org (display copy, auto-toggles), cleanup posSettingsStore, pages BO Customer Display + Printing | **oui** |
| **3 — BO hub & pages** | [`2026-07-11-session-73-settings-plan-bo.md`](2026-07-11-session-73-settings-plan-bo.md) | Hub cleanup (liens/suppr./gates/blurbs), AuditPage `?action=`, sidebar, page POS Configuration (`pos_presets`), page Notifications, durcissement General (ISO/IANA/%), dictionnaire de clés partagé, doc modèle d'autorité, CLAUDE.md | non |

## Global constraints (rappel — s'appliquent à toutes les tâches)

- **DB via MCP `mcp__claude_ai_Supabase__*` uniquement**, projet `ikcyvlovptebroadgtvd`. Jamais
  `db reset`/Docker. **Les subagents n'ont PAS accès au MCP** : apply_migration, execute_sql
  (pgTAP) et generate_typescript_types sont exécutés par le CONTRÔLEUR (étapes marquées
  `CONTROLLER-ONLY`).
- Migration : NAME-block suivant = `20260711000159` (max actuel `20260710000158` ; `_153`
  vit sur une branche non poussée — ne pas réutiliser). **Pas de BEGIN/COMMIT dans le corps.**
- RPC : `set_setting_v1` / `get_settings_by_category_v1` gardent leur signature → `CREATE OR
  REPLACE` (précédent S66/S67 `_128`), **corps repris du live `pg_get_functiondef`**
  (leçon DEV-S57-02), jamais du fichier de migration.
- Types regen après migration → `packages/supabase/src/types.generated.ts`, **diff avant
  commit** (drift de sessions parallèles possible). Jamais `as any`/`as never` pour masquer.
- Money-path **non touché** (aucun RPC de vente, aucun fichier payment hors SuccessModal
  lecture de toggles). `roundIdr()`, DECIMAL(12,2), WITA intacts.
- Tokens design uniquement (0 couleur en dur). Fichiers < 500 lignes. Tests co-localisés
  `__tests__/`. `pnpm typecheck` + `pnpm lint` + tests ciblés verts par tâche.
- Réutiliser l'existant (RPC/clés/pages), zéro schéma parallèle, zéro réglage sans
  consommateur réel.

## Definition of Done (reprise du prompt propriétaire)

1. ✅ Rapport Phase 0 validé (fait, 2026-07-11).
2. Zéro tuile Soon en cul-de-sac (liée / implémentée / retirée) — exception actée :
   Floor Plan + KDS Config restent visibles marquées « Planned (dedicated session) ».
3. Aucune page settings orpheline (PaymentMethods → sidebar, ExpenseThresholds → hub).
4. `tax_rate` & réglages partagés : source unique DB (déjà vrai — non-régression testée).
5. Verrou de permission effectif sur **tous** les onglets POS.
6. Persistance org vs terminal explicite dans l'UI (badges).
7. typecheck / lint / test verts ; types regénérés (migration `_159`).
8. Récap dans CLAUDE.md → Active Workplan (Lot 3, dernière tâche).

## Post-session (tracé, hors périmètre S73)

- **Session dédiée « Floor Plan BO + KDS Configuration »** (aucun backend KDS-config à ce
  jour) — à spécifier avant d'ouvrir.
- **B5 reporté** : NPWP / identité fiscale indonésienne (migration + templates PDF).

## Déviations (closeout 2026-07-12)

- **DEV-S73-01** : session coupée en pleine Task 13 (page Notifications) — fichiers complets
  retrouvés sur disque, validés (tests 4/4 + typecheck) et commités par le contrôleur à la
  reprise ; revue de tâche passée après coup (Approved + spec ✅).
- **DEV-S73-02** (T15) : le `export type { SettingsCategory } from '@breakery/supabase'`
  littéral du plan ne lie pas le type dans le scope local sous `verbatimModuleSyntax` —
  scindé en `import type` + ré-export séparé dans `useSettings.ts` (fix TS standard,
  validé en revue).
- **DEV-S73-03** (T15) : statut de l'audit doc écrit « branche `swarm/session-73-settings` »
  sans numéros de PR (inexistants au moment du commit) — à compléter au merge.
- **DEV-S73-04** (T11/T12/T13) : les tuiles hub `settings/pos` et `settings/notifications`
  ont pointé vers des routes livrées dans des commits ultérieurs de la même PR (gap
  sanctionné, PR atomique).

## Dettes (candidates suivi, non bloquantes — issues des revues de tâche)

- **D-1** : reset du draft des cards sœurs à l'invalidation de la liste
  (`SettingsNotificationsPage` — hérité du pattern `EmailTemplateEditor` : sauver une card
  refetch la liste et écrase les brouillons non sauvés des autres cards).
- **D-2** : `SettingsGeneralPage` selects — une valeur DB hors liste (currency/timezone
  legacy) s'affiche vide (pas de corruption au save : le dirty-check la garde intacte).
- **D-3** : `TIMEZONES` via `Intl.supportedValuesOf` = 300+ entrées dans un `<select>` natif
  sans recherche (UX).
- **D-4** : flakiness pré-existante `SettingsPaymentMethodsPage.smoke` sous charge parallèle
  (tinypool worker crash, passe en isolation — même famille que D-5 S72).
