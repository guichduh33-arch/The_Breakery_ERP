# Docs Curation Audit — 2026-06-27

> Audit-first : ce document est un **rapport + plan d'action**. Aucune modification n'est appliquée
> sans validation. Phases 0–2 (lecture seule) faites ; Phase 3 (exécution) sur accord uniquement.

## 1. Summary

- **409 fichiers markdown** suivis (hors boilerplate vendored `.claude/`). Arbo globalement saine — une curation antérieure (`2026-06-04`, `2026-06-12`) a déjà archivé la zone legacy `docs/objectif travail/` → `docs/_archive/objectif-travail-v2/` et vidé `docs/Design/` de ses `.md` (n'y restent que des images).
- **Constat 🔴 principal** : `CLAUDE.md` est **périmé de 2 PRs**. Il annonce « Latest on master : PR #122 » alors que **#123, #124, #125 sont mergés**. Pire : son bloc « In flight: Spec B » décrit précisément ce que **#125 (Spec B-1 dispatch/print) a déjà livré**.
- **Constat 🟠** : `docs/README.md` figé au « Last updated : 2026-06-12 » et annonce « sessions 1-42+ » (S47 mergée).
- **Constat 🔴 ciblé** : `docs/DESIGN_POS_AND_BACKOFFICE.md` — **6 liens morts** + cadrage **V2** (« effectivement déployés dans AppGrav V2 ») contredisant « V3 = canonique ». Ce fichier est référencé par ~20 modules de `reference/` → **à réparer sur place, pas à archiver**.
- **Archivage proposé** : **7 triplets de session (S41→S47)**, tous squash-mergés (≤ #98), à déplacer en batch vers `specs/archive/` + `plans/archive/`.
- **Junk** : 2 artefacts de débris shell à la racine (`{,` zéro-octet, `po-rawmaterials-unit-locked.png`) — non suivis, à supprimer après accord.
- **Liens** : `git`-tracked indexes (CLAUDE.md, les 2 README, reference/README, tous les INDEX) = **0 lien mort**. Seul `DESIGN_POS_AND_BACKOFFICE.md` (non couvert auparavant) casse.

## 2. Current tree map

| Zone | Path | Statut |
|---|---|---|
| Living context | `CLAUDE.md` | **stale** (retard de #123/#124/#125 ; cadence figée à #122) |
| Living context | `MEMORY.md` (hors repo) | current — index 1-ligne/mémoire OK |
| Top-level index | `docs/README.md` | **stale** (date 2026-06-12 ; « sessions 1-42+ ») |
| Top-level | `docs/V2_V3_GLOSSARY.md` | current |
| Legacy design | `docs/DESIGN_POS_AND_BACKOFFICE.md` | **misplaced/legacy** — V2-framed + 6 liens morts, mais activement câblé (réparer) |
| Canonical ref | `docs/reference/00…12` (108 md) | current — autorité, structure numérotée intacte |
| ADRs | `docs/adr/` (1 md) | current |
| Workplan specs | `docs/workplan/specs/` (73 md ; 8 hors archive) | S41-S47 = **archive candidates** |
| Workplan plans | `docs/workplan/plans/` (121 md ; ~15 hors archive) | idem |
| Workplan audits | `docs/workplan/audits/` (9 md) | current — ce rapport y atterrit |
| Superpowers | `docs/superpowers/{specs,plans}/` (23 md) | dated history — OK |
| Audits | `docs/audit/` (2 md hors archive) | point-in-time — à évaluer (résolus ?) |
| Runbooks | `docs/runbooks/disaster-recovery.md` | living |
| Design assets | `docs/Design/` (images only) | OK (legacy `.md` déjà retirés) |
| Archive | `docs/_archive/objectif-travail-v2/` (16 md) | déjà archivé ✅ |
| Changelog | `CHANGELOG.md` | figé v0.1.0 — **déjà auto-conscient** (bandeau présent) → no-op |

## 3. Findings

### A. Placement & naming

| # | Sév. | Évidence | Règle | Action proposée |
|---|---|---|---|---|
| A1 | 🟡 | `docs/DESIGN_POS_AND_BACKOFFICE.md` à la racine de `docs/` | stray root-level doc hors README/glossary | Laisser en place (câblé par ~20 modules) **mais** réparer (voir C3). Pas un déplacement. |
| A2 | 🔴 | Racine repo : `{,` (0 octet, non suivi) + `po-rawmaterials-unit-locked.png` (71 Ko, non suivi). git status montre aussi `'row_count')` et `{,` | junk artifacts (débris de redirection shell) | **Supprimer** (non suivis → `rm`). Sign-off séparé. |
| A3 | 🟡 | `docs/Design/` (D majuscule) contient uniquement des `.jpg/.png` | naming (casse), mais pas de `.md` rot | Laisser — dossier d'assets screenshots. Aucune action doc. |

### B. Archive candidates

| Session | Triplet (spec/plan/INDEX) | Statut INDEX | Action |
|---|---|---|---|
| S41 (2026-06-12) | catalog-import | Livré (≤ #74) | → `archive/` |
| S42 (2026-06-12) | catalog-import-minors | Livré (≤ #78) | → `archive/` |
| S43 (2026-06-12) | pos-audit-fixes | Livré | → `archive/` |
| S44 (2026-06-13) | money-path-hardening | Livré (#85) | → `archive/` |
| S45 (2026-06-13) | products-actions | Livré (#82) | → `archive/` |
| S46 (2026-06-18) | purchasing-hardening | Livré (#95) | → `archive/` |
| S47 (2026-06-19) | configurable-combos | Livré (#98) | → `archive/` |

- **Garder hors archive** : `2026-06-01-pos-print-bridge-deploy-{spec,plan}.md` (guide de déploiement, pas une session) et `2026-05-20-audit-integral-V3-plan.md` (audit transversal).
- Toutes les sessions ci-dessus sont **≤ #98**, très en deçà du dernier mergé **#125** → sûres à archiver. (Garder éventuellement S47 « live » 1 session si tu préfères un tampon.)
- `docs/audit/2026-05-28-pos-audit.md` + `2026-06-12-stock-management-audit.md` : à archiver **si findings résolus** — à confirmer (non vérifié dans cette passe).

### C. Contradictions, duplicates & staleness

| # | Sév. | Évidence | Réalité | Action |
|---|---|---|---|---|
| **C1** | 🔴 | `CLAUDE.md` : « **Latest on master: PR #122** » + « Merged (latest): … (#122) » + « In flight: **Spec B** » | git log : **#123** (refresh CLAUDE.md), **#124** (route-split −69% bundle), **#125** (Spec B-1 dispatch/print — *c'est précisément « Spec B »*) tous mergés | Rouler le bloc Active Workplan : **#125 = Merged (latest)**, #124 dans l'historique, recadrer « In flight » sur le reliquat de Spec B (Phase 2 import Sales+Expenses). Mentionner migrations dispatch `20260710000031/040-043`. |
| **C2** | 🟠 | `docs/README.md` l.3 « Last updated : 2026-06-12 » ; l.32 « sessions 1-42+ » | On est le 2026-06-27 ; S47 mergée, #125 en tête | Bump date → 2026-06-27 ; « sessions 1-47+ ». Le reste de la structure est correct (pointe déjà `_archive/` et `plans/archive/`). |
| **C3** | 🔴 | `docs/DESIGN_POS_AND_BACKOFFICE.md` l.2-9 : « design **effectivement déployés dans AppGrav V2** » + lien `[DESIGN.md](../DESIGN.md)` | V2 n'est PAS en prod (MEMORY) ; `reference/02-design-system/` = autorité ; `../DESIGN.md` **absent** | **Réparer sur place** : recadrer V2→V3 (ou « vision historique V2, voir reference/ pour l'état courant »), corriger/retirer les 6 liens morts (voir D2). NE PAS archiver (câblé par ~20 modules). |
| C4 | 🟡 | `CHANGELOG.md` figé v0.1.0 | 30+ sessions plus loin | **No-op** — bandeau d'auto-conscience déjà présent (l.3). |

### D. Cross-reference integrity

| # | Sév. | Évidence | Action |
|---|---|---|---|
| D1 | ✅ | CLAUDE.md, README.md, docs/README.md, reference/README.md, tous les `*-INDEX.md` : **0 lien relatif mort** (sous-agent : 188+ liens vérifiés) | Aucune. |
| **D2** | 🔴 | `DESIGN_POS_AND_BACKOFFICE.md` → **6 cibles mortes** : `../DESIGN.md`, `design/03-design-system.md`, `design/05-component-specs.md`, `design/v3-improvements-from-v2-2026-05-01.md`, `ux/assets/screens/*`, `ux/v2-token-inventory.md` (dossiers `docs/design/` et `docs/ux/` inexistants) | Réparer dans la même passe que C3 : repointer vers `reference/02-design-system/` + `docs/Design/` (assets réels) ou retirer les liens. |

## 4. Proposed action plan (ordonné, batché)

**Bloc 1 — Harmoniser les docs vivants (priorité, corrige les mensonges actifs)**
1. `CLAUDE.md` (C1) — rouler l'Active Workplan : `#125` en « Latest on master / Merged (latest) » avec résumé Spec B-1 dispatch/print ; ajouter `#124` route-split à l'historique ; recadrer « In flight » sur le reliquat (Phase 2 Sales+Expenses import) ; citer migrations `20260710000031/040-043`.
2. `docs/README.md` (C2) — `Last updated : 2026-06-27` ; « sessions 1-47+ ».

**Bloc 2 — Réparer `DESIGN_POS_AND_BACKOFFICE.md` (C3 + D2), sur place**
3. Recadrer le périmètre V2 → V3 (ou bannière « lecture historique, `reference/02-design-system/` fait foi »).
4. Corriger les 6 liens morts (repointer `reference/02-design-system/` + `docs/Design/`, ou supprimer).

**Bloc 3 — Archiver S41→S47 (B), en batch par session**
5. Pour chaque session : `git mv` spec → `docs/workplan/specs/archive/`, plan + INDEX → `docs/workplan/plans/archive/`.
6. Réécrire les liens entrants éventuels (Axis D a montré 0 lien entrant cassant vers ces fichiers hors archive ; re-vérifier après chaque batch).

**Bloc 4 — Junk (A2), sign-off séparé**
7. `rm "{,"` et statuer sur `po-rawmaterials-unit-locked.png` (supprimer ou ranger). Fichiers **non suivis** → pas de `git mv`.

> Après chaque batch : re-lancer le link-checker (Axis D) → 0 nouveau lien mort.

## 5. Out of scope / left as-is

- **Code/tests** (`apps/`, `packages/`, `supabase/`) — hors périmètre du curator.
- **Boilerplate vendored** `.claude/agents/{core,…}` + `.claude/commands/` (~180 md) — tooling tiers, exclus.
- **`CHANGELOG.md`** — déjà auto-conscient, aucune action.
- **ADRs, superpowers, backlog-by-module** — historique daté / vivant édité en place, sains.
- **`docs/audit/*.md`** (2 fichiers) — archivables *si* findings résolus ; non vérifié ici → laissé en suspens (question ouverte).
- **Drift pattern-doc ↔ code** (versions RPC dans CLAUDE.md vs migrations) — non audité ligne à ligne ; le code reste hors scope de modification.
