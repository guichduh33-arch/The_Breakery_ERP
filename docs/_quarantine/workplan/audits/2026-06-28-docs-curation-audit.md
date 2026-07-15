# Docs Curation Audit — 2026-06-28

> Audit-first : ce document est un **rapport + plan d'action**. Aucune modification n'est appliquée
> sans validation. Phases 0–2 (lecture seule) faites ; Phase 3 (exécution) sur accord uniquement.
> Delta depuis l'audit `2026-06-27` (exécuté via #127 : sync CLAUDE.md→#125, archive S41–S47).

## 1. Summary

- Arbo **saine** : la curation des 4-12 et 6-27 a déjà archivé la zone legacy `objectif travail/` → `docs/_archive/objectif-travail-v2/`, vidé `docs/Design/` de ses `.md` (images seulement), et **réparé `DESIGN_POS_AND_BACKOFFICE.md`** (les 6 liens morts C3/D2 ont disparu — vérifié). Link-integrity des indexes vivants = **0 lien mort**.
- **Constat 🔴 unique et dominant** : `CLAUDE.md` est **de nouveau périmé de 3 PRs**. Depuis le dernier sync (#125), **#128** (audit par module), **#129** (S50 Vague 1) et **#132** (S50 Vague 2a-i + S51 money-path) sont **mergés sur `master`**. Or l'Active Workplan décrit toujours **S50 et S51 comme « In flight (PR) »** et annonce « Latest on master : **#125** ». C'est exactement le type de mensonge qui empoisonne le contexte de la prochaine session (elle croira S50/S51 non livrés et `complete_order_with_payment` encore en v14).
- **Constat 🟠** : `docs/README.md` figé à « Last updated : 2026-06-27 / sessions 1-47+ » (S50/S51 mergées depuis).
- **Archivage** : **rien à archiver maintenant** — S50 + S51 sont les 2 sessions les plus récentes (buffer « newest 1-2 live » du skill). Candidats *mineurs* : 1 plan orphelin ancien (`2026-06-12-stock-audit-fixes-plan.md`) et, optionnellement, l'amorçage d'un `archive/` pour `docs/superpowers/` (jamais archivé, 24 fichiers datés dont ~10 mergés).
- **Junk** : 1 artefact de débris shell **non suivi** à la racine — `'row_count')` (0 octet). Suppression après sign-off. (Le `{,` et `po-rawmaterials-unit-locked.png` du dernier audit ont disparu.)
- **Hors scope / à statuer** : `docs/Design/Daily Cash June 2026.xlsx` (non suivi, ajouté par l'utilisateur) — pas du markdown, pas du junk ; laissé tel quel.

## 2. Current tree map (delta)

| Zone | Path | Statut |
|---|---|---|
| Living context | `CLAUDE.md` | **🔴 stale** — S50/S51 « in flight » alors que mergées (#132) ; « Latest on master : #125 » faux |
| Living context | `MEMORY.md` (hors repo) | current — index 1-ligne OK |
| Top-level index | `docs/README.md` | 🟠 stale léger (date 2026-06-27 ; « sessions 1-47+ ») |
| Top-level | `docs/V2_V3_GLOSSARY.md` | current |
| Legacy design | `docs/DESIGN_POS_AND_BACKOFFICE.md` | **réparé ✅** (liens morts résolus #127) |
| Canonical ref | `docs/reference/00…12` (108 md) | current — autorité intacte |
| ADRs | `docs/adr/` (1 md) | current |
| Workplan specs | `docs/workplan/specs/` (2 hors archive : S50 + print-bridge) | S50 = buffer live |
| Workplan plans | `docs/workplan/plans/` (7 hors archive) | S50/S51 = buffer live ; 3 plans anciens à trier |
| Workplan audits | `docs/workplan/audits/` | current — ce rapport y atterrit |
| Superpowers | `docs/superpowers/{specs,plans}/` (24 md) | dated history, **jamais archivé** — backlog optionnel |
| Audits | `docs/audit/` (2 md hors archive) | point-in-time — archivables si findings résolus (non vérifié) |
| Design assets | `docs/Design/` (images + 1 xlsx non suivi) | OK |
| Archive | `docs/_archive/`, `workplan/{specs,plans,refs,audits}/archive/` | sain ✅ |

## 3. Findings

### A. Placement & naming

| # | Sév. | Évidence | Règle | Action proposée |
|---|---|---|---|---|
| A1 | 🔴 | Racine repo : `'row_count')` (0 octet, **non suivi**) | junk artifact (débris de redirection shell) | **Supprimer** (`rm`). Sign-off séparé. |
| A2 | 🟡 | `docs/workplan/plans/2026-06-12-stock-audit-fixes-plan.md` — plan orphelin (pas de spec/INDEX), daté 06-12, livré depuis longtemps | dated history archivable | → `plans/archive/` (batch séparé, faible valeur). |
| A3 | ⚪ | `docs/Design/Daily Cash June 2026.xlsx` (non suivi) | hors périmètre markdown | Laisser — décision utilisateur (git-add ou non). |

### B. Archive candidates

- **S50 (2026-06-27 : spec + plan + INDEX + vague2a-isolated-plan) et S51 (2026-06-28 : INDEX)** : mergées via **#132** — mais ce sont **les 2 sessions les plus récentes** ⇒ **garder live** (buffer « newest 1-2 » du skill). À archiver au prochain passage, quand S52 sera mergée.
- **`docs/superpowers/`** (24 fichiers datés, jamais archivés) : ~10 correspondent à du travail mergé (modifiers, recipe-editor, dispatch-routing, stock-flags, held-order, canonical-line-price). **Optionnel** : créer `docs/superpowers/{specs,plans}/archive/` et y déplacer les mergés. Faible urgence (zone d'historique daté, pas de lien mort).
- **`docs/audit/2026-05-28-pos-audit.md` + `2026-06-12-stock-management-audit.md`** : archivables **si findings résolus** — non vérifié dans cette passe (question ouverte, héritée du dernier audit).

### C. Contradictions, duplicates & staleness

| # | Sév. | Évidence | Réalité (git) | Action |
|---|---|---|---|---|
| **C1** | 🔴 | `CLAUDE.md` l.21-22 « **In flight (PR)** : Session 51 / Session 50 » ; l.25 « **Latest on master : PR #125** » ; l.24 « Merged (latest) : Spec B-1 #125 » | `git log` : **#128, #129, #132 mergés**. `complete_order_with_payment` est **v15** sur master ; S50 (sécurité+CI) et S51 (money-path) **livrés** | **Rouler l'Active Workplan** : `#132` = « Latest on master / Merged (latest) » (résumé : Vague 2a-i intégrité + Vague 2a money-path v15 + helper `_resolve_line_price_v1`, migrations `20260710000057..064`) ; `#129` (S50 V1 sécurité/CI, mig. `051..056`) + `#128` (audit par module) dans l'historique « Previously merged » ; **recadrer « In flight »** sur la **prochaine vague = B2B per-invoice settlement (P1.2)** (encore non démarrée) ; conserver le bloc « Deferred S51+ » (POS-view security_invoker, bucket privatization, etc.). |
| C2 | 🟠 | `docs/README.md` l.3 « Last updated : 2026-06-27 » ; structure « sessions 1-47+ » | 2026-06-28 ; S50/S51 mergées (#132) | Bump date → 2026-06-28 ; « sessions 1-51+ ». Reste de la structure correct. |
| C3 | 🟡 | `CLAUDE.md` paragraphe « Migrations » + bullets : couvre `051..056` (S50 V1) et `063..064` (S51) mais **n'énonce pas** `057..062` (S50 Vague 2a-i : pb1-dedup, b2b-balance v2, b2b-flag-stock, je-reference, trial-balance v3, void-zreport v2) | 8 migrations `057..064` sur disque | Complétude : le nouveau bullet « Merged (latest) #132 » doit citer la plage **`057..064`**. (Pris en charge dans C1.) |

### D. Cross-reference integrity

| # | Sév. | Évidence | Action |
|---|---|---|---|
| D1 | ✅ | Indexes vivants (CLAUDE.md, les 2 README, reference/README, tous les `*-INDEX.md`) : **0 lien relatif mort**. Les chemins cités par les bullets S50/S51 (`docs/superpowers/specs/2026-06-28-…`, `docs/workplan/plans/2026-06-28-session-51-INDEX.md`) **existent**. | Aucune. |
| D2 | ✅ | `DESIGN_POS_AND_BACKOFFICE.md` : les 6 cibles mortes du dernier audit ont **disparu** (réparé #127). | Aucune. |

## 4. Proposed action plan (ordonné, batché)

**Bloc 1 — Harmoniser les docs vivants (priorité 🔴 — corrige les mensonges actifs)**
1. `CLAUDE.md` (C1 + C3) — rouler l'Active Workplan :
   - **« Merged (latest) »** → **#132** (Vague 2a-i intégrité + Vague 2a money-path `v15`, helper `_resolve_line_price_v1`, migrations `20260710000057..064`).
   - **« Previously merged »** → ajouter **#129** (S50 V1 : gates financiers `_v2`, fuites MV/audit_log, CI net, mig. `051..056`) et **#128** (audit par module) ; conserver #125/#124/#122 plus bas.
   - **« Latest on master »** → **#132**.
   - **« In flight »** → recadrer sur la **prochaine vague : B2B per-invoice settlement (P1.2)** (`b2b_payment_allocations` + `cancel_b2b_order_v1`) — *pas encore démarrée, pas de branche*.
   - Conserver le bloc **« Deferred (S51+) »** (dettes sécurité S50 + follow-ups S51 §10).
2. `docs/README.md` (C2) — `Last updated : 2026-06-28` ; « sessions 1-51+ ».

**Bloc 2 — Junk (A1), sign-off séparé**
3. `rm "'row_count')"` (fichier 0 octet non suivi à la racine).

**Bloc 3 — Archivage faible-valeur (A2), optionnel**
4. `git mv docs/workplan/plans/2026-06-12-stock-audit-fixes-plan.md docs/workplan/plans/archive/` (re-vérifier liens entrants : Axis D = 0).

**Bloc 4 — Superpowers archive (B), optionnel / sur demande**
5. Créer `docs/superpowers/{specs,plans}/archive/` et y déplacer les designs/plans mergés (modifiers, recipe-editor, dispatch-routing, stock-flags, held-order, canonical-line-price). Faible urgence.

> NE PAS archiver S50/S51 maintenant (buffer « newest 1-2 live »).
> Après chaque batch de déplacement : re-lancer le link-checker (Axis D) → 0 nouveau lien mort.

## 5. Out of scope / left as-is

- **Code/tests** (`apps/`, `packages/`, `supabase/`) — hors périmètre.
- **Boilerplate vendored** `.claude/agents/{core,…}` + `.claude/commands/` (~180 md) — tooling tiers, exclus.
- **`docs/Design/Daily Cash June 2026.xlsx`** — fichier de données utilisateur, non markdown.
- **ADRs, backlog-by-module, runbooks** — sains.
- **Drift pattern-doc ↔ code** (versions RPC) — non audité ligne à ligne ; code hors scope.
- **`docs/audit/*.md`** (2) — archivables si findings résolus ; non vérifié (question ouverte).
