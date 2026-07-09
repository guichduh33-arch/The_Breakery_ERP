# INDEX — Remédiation de gouvernance documentaire (S71)

> Date : 2026-07-09 · Session : S71 · Statut : **LIVRÉ (P0 + P1 + P2-sûr)** · Branche : `worktree-audit-gouvernance-s71`
> Spec : [`../specs/2026-07-09-session-71-audit-remediation-spec.md`](../specs/2026-07-09-session-71-audit-remediation-spec.md)
> Plan : [`2026-07-09-session-71-audit-remediation-plan.md`](2026-07-09-session-71-audit-remediation-plan.md)
> Audit source : [`../audits/2026-07-09-audit-general-gouvernance.md`](../audits/2026-07-09-audit-general-gouvernance.md)

## Résultat

Remédiation des findings **P0 (danger immédiat) + P1 (outillage agents) + P2 (sous-ensemble sûr)** de l'audit de gouvernance. Objectif atteint : **plus aucune fausse dette de sécurité présentée comme ouverte, plus aucun projet Supabase V2 pointé sans avertissement, chaque fichier `docs/reference/` bannerisé STALE, versions RPC dé-figées, référence modules réconciliée S69, garde-fou anti-dérive dans CLAUDE.md.**

### Livré

| Bande | Items | Effet |
|---|---|---|
| **P0** | P0-1..5 | `security-fraud-guard` requalifié (7 failles 2026-05-31 → corrigées, **sourcé sur migrations réelles**) ; env `abjabu`→`ikcy` + avertissement ; README → `remise-a-plat/` ; **64/64** bandeaux STALE `docs/reference/` ; runbook DR (print_queue S62, PWA, `complete_order_v17`). |
| **P1** | P1-1..5 | Préfixe MCP → connecteur actif + garde-fou ToolSearch ; **versions RPC money-path dé-figées** (nom non-versionné + « vérifier CLAUDE.md ») dans 11 skills/agents ; `04-modules`→`remise-a-plat` ; **fiches 05/08/09/00-INDEX réconciliées S69** ; corps figés 10/12/14/21 annotés vs headers. |
| **P2 (sûr)** | P2-3..7 | Liens vivants cassés corrigés ; audits modules archivés ; DESIGN/GLOSSARY/print-server annotés. |
| **Garde-fou** | — | Checklist fin-de-session + grep de dérive V2 trimestriel dans `CLAUDE.md`. |

### Méthode qualité (writer + vérificateur adversarial)

- **Sourçage strict** : aucune affirmation d'état sans citation d'un artefact du dépôt (CLAUDE.md / MEMORY / INDEX daté / nom de migration). Non-sourçable → « à vérifier », pas « corrigé ».
- **Déterministe pour le mécanique** : bandeaux ×64 + préfixe MCP par script idempotent (0 hallucination).
- **Double vérificateur adversarial** sur le fichier sécurité : `verif-secu-1` (PROPRE) + `verif-secu-2` (a levé 2 REFUTED). **Le double contrôle a payé** — voir DEV-S71R-04.
- **Vérification à la source** des faits des subagents (P1-2, P1-4/5) par le main-loop avant chaque commit (grep autoritaire + lecture migrations).

## Déviations (détail dans le plan)

- **DEV-S71R-01** — `security-auth` sans fausse dette (audit sur-listé).
- **DEV-S71R-02** — `abjabu` corrigé inline sur l'env seul ; les 7 autres occurrences reference couvertes par le bandeau STALE.
- **DEV-S71R-03** — ⚠️ **Finding à trancher par le propriétaire** : CLAUDE.md dit connecteur MCP `mcp__claude_ai_Supabase__` actif, **mais la session expose `mcp__plugin_supabase_supabase__*`**. Réconcilié vers CLAUDE.md + garde-fou ; note CLAUDE.md 2026-07-07 peut-être à réactualiser.
- **DEV-S71R-04** — Correction post-review adversariale : attribution des fixes vues/MV = migrations `20260619000020/021` (audit 2026-05-31), **pas S50** (fuite distincte) ; reversal = régression récurrente `_030`→`20260709000010`→`_084`, pas « corrigé S55 ». Skill re-sourcé sur migrations.
- **DEV-S71R-05** — Faits S69/S66/S67/S63/S62/S59 des fiches vérifiés à la source (S59 drill-down confirmé : `resolveJeSourceEntity.ts` + bandeau préexistant).

## Reste-à-faire (NON exécuté — aval propriétaire requis)

- **P2-1** — archivage batch de ~21 triplets spec/plan/INDEX S50→~S67 (réorganisation structurelle).
- **P2-2** — sort de `.claude/commands/` (88 fichiers scaffolding claude-flow/sparc) : **décision propriétaire** (purger / archiver / bannière). Déchet évident : `COMMAND_COMPLIANCE_REPORT.md` + repo hardcodé `ruvnet/ruv-FANN`.
- **P3** — rebase en lot des profondeurs de liens d'archive (L-5/L-6), bandeaux SUPERSEDED.
- **Axe E** — cohérence doc↔schéma **live** (`ikcyvlovptebroadgtvd`) — exclu par le choix docs-only.

## Commits (branche `worktree-audit-gouvernance-s71`)

1. `986a2c03` — audit général (591/607, 263 findings).
2. `0522e6c9` — Vague 0 (P0) + P1-1.
3. `1a04f29e` — Vague 1 (P1-2/P1-3 versions RPC + repointage).
4. `1de96af1` — Vague 1 (P1-4/5) + Vague 2 + garde-fou.
