# Plan — Remédiation de gouvernance documentaire (S71)

> Date : 2026-07-09 · Session : S71 · Statut : **P0+P1+P2-sûr LIVRÉS**
> Spec : [`../specs/2026-07-09-session-71-audit-remediation-spec.md`](../specs/2026-07-09-session-71-audit-remediation-spec.md)
> Audit source : [`../audits/2026-07-09-audit-general-gouvernance.md`](../audits/2026-07-09-audit-general-gouvernance.md) §6

## Stratégie d'exécution

Vagues séquentielles ; chaque vague est vérifiée (grep de contrôle) avant la suivante.
- **Vague 0 (danger)** = P0 — exécuté d'abord, précision manuelle + script de bannière idempotent.
- **Vague 1 (outillage)** = P1 — préfixe MCP (script), versions RPC (jugement), réconciliation S69.
- **Vague 2 (hygiène sûre)** = sous-ensemble P2 mono-fichier + liens vivants.
- **Garde-fou** = checklist collée dans CLAUDE.md.
- **Reste-à-faire** = P2-1 / P2-2 / P3 documentés, non exécutés (aval propriétaire).

---

## Vague 0 — P0 (danger immédiat)

- [x] **P0-1** — `security-fraud-guard/SKILL.md` + `security-auth/SKILL.md` : requalifier les 7 gaps + PIN-body void/cancel (sweep S34) + `audit_log` legacy (droppé S56) en **« corrigé S50/S56, re-vérifié live 2026-06-27 »**. Ne pas supprimer le savoir (les patterns de détection restent utiles) — retirer le statut « ouvert/critique ».
- [x] **P0-2** — `docs/reference/12-appendices/03-environment-variables.md` : remplacer `abjabuniwkqpfsenxljp` → `ikcyvlovptebroadgtvd` (+ note « V2 prod incompatible »), `database.generated.ts` → `packages/supabase/src/types.generated.ts`.
- [x] **P0-3** — `README.md` : `docs/reference` n'est plus « source de vérité » → `remise-a-plat/` ; supprimer liens `v2-reference/`, `Ux-reference/` ; aligner texte/href du lien Spec.
- [x] **P0-4** — Bandeau STALE en tête de **chaque** `docs/reference/**/*.md` (script idempotent, marqueur `<!-- STALE-V2 -->`) renvoyant à `remise-a-plat/`.
- [x] **P0-5** — `docs/runbooks/disaster-recovery.md` : retirer Scénario 6 (`print_queue` droppée S62), durcir Scénario 5 (PWA purgée), `complete_order_v9` → `v17` (Appendix A).

**Contrôle Vague 0** : `grep -rn "abjabuniwkqpfsenxljp" docs/reference README.md` → 0 hors note explicite ; chaque fichier `docs/reference/**` a `<!-- STALE-V2 -->`.

---

## Vague 1 — P1 (outillage agents & réconciliation)

- [x] **P1-1** — Préfixe MCP `mcp__plugin_supabase_supabase__` → `mcp__claude_ai_Supabase__` (script) dans `.claude/agents/{db-engineer,edge-functions-engineer,pos-specialist,backoffice-specialist}.md` + `.claude/skills/{db-migrations,accounting,report-audit,edge-functions}/SKILL.md`.
- [x] **P1-2** — Versions RPC des skills/agents → placeholder `_vN (vérifier CLAUDE.md/migrations)` ou valeur S71. Fichiers : `.claude/skills/{b2b-credit,accounting,stock-management,orders,pos-flow-audit,products-catalog,reports-exports}`, `.claude/agents/{db-engineer,pos-specialist}`.
- [x] **P1-3** — Repointer « sources canoniques » `04-modules` → `remise-a-plat/` dans `stock-management`, `pos-flow-audit`, `session-coordinator` (backlog → `remise-a-plat/00-INDEX.md`).
- [x] **P1-4** — Réconcilier `remise-a-plat/{08,09,05,00-INDEX}.md` avec S69 : header « Mise à jour S69 », verdicts C-B1.1/B1.2/B1.7 → ✅, `customer_product_prices` + `create_b2b_order_v5` notés, Vague 2/3 dans 00-INDEX.
- [x] **P1-5** — Annoter corps figés vs headers dans `remise-a-plat/{12,14,21,10}.md` (« tableau figé au 5b0fa92, supplanté par le header »).

**Contrôle Vague 1** : `grep -rn "mcp__plugin_supabase" .claude/` → 0 ; diff versions RPC skills ↔ CLAUDE.md → 0 divergence en dur.

---

## Vague 2 — P2 (sous-ensemble sûr, mono-fichier + liens vivants)

- [x] **P2-3** — hrefs vivants cassés : `plans/2026-07-08-session-69-INDEX.md` (préfixe `../../superpowers/`), `specs/2026-06-27-session-50-spec.md` (lien audit inexistant), `audits/2026-06-27-project-state-and-gaps.md` (→ curation daté du 28).
- [x] **P2-4** — Archiver `docs/audit/2026-05-28-pos-audit.md` + `2026-06-12-stock-management-audit.md` → `docs/audit/archive/`.
- [x] **P2-5** — `docs/DESIGN_POS_AND_BACKOFFICE.md` : repointer `docs/Design/` → `_archive/design-screenshots-pre-code/`, marquer `_bmad`/`breakery-platform` absents.
- [x] **P2-6** — `docs/V2_V3_GLOSSARY.md` : bannière de péremption (versions RPC → CLAUDE.md) + fix lien backlog.
- [x] **P2-7** — `docs/reference/05-integrations/06-print-server.md` : marquer la moitié V3 (station-routing S34, print-bridge) à promouvoir hors référence V2 (note, pas d'extraction lourde).

---

## Garde-fou anti-dérive

- [x] Coller la checklist « FIN DE SESSION » (audit §7.2) dans `CLAUDE.md` (section closeout / conventions).

---

## Reste-à-faire (NON exécuté — aval propriétaire requis)

- **P2-1** — archivage batch S50→~S67 (git mv ~21 triplets vers `{specs,plans}/archive/`, fenêtre glissante 4 sessions vivantes). *Réorganisation structurelle : à valider avant déplacement.*
- **P2-2** — sort de `.claude/commands/` (scaffolding claude-flow/github/sparc) : **décision propriétaire** — purger, déplacer sous `docs/_archive/`, ou bannière « vendored optionnel ». Supprimer a minima `COMMAND_COMPLIANCE_REPORT.md` (déchet) et le repo hardcodé `ruvnet/ruv-FANN` reste à trancher.
- **P3** — rebase en lot des profondeurs de liens d'archive (L-5/L-6), bandeaux SUPERSEDED (specs S26, plans orphelins 2026-06-01, cash-wallets ABANDONNÉ), renommages d'homogénéisation.
- **Axe E** — cohérence doc↔schéma live (`ikcyvlovptebroadgtvd`).

## Déviations

- **DEV-S71R-01** — `security-auth/SKILL.md` n'avait **aucune fausse dette** à purger (l'audit P0-1 l'avait sur-listé) ; seul `security-fraud-guard` portait les 7 gaps périmés. Aucune édition sur security-auth.
- **DEV-S71R-02** — P0-2 (retrait `abjabuniwkqpfsenxljp`) : corrigé **inline** uniquement dans `12-appendices/03-environment-variables.md` (portée audit). La ref subsiste dans 7 autres fichiers `docs/reference/` (00-overview/02, /03 ; 05-integrations/01, /03) mais **tous portent le bandeau STALE** (P0-4) qui interdit explicitement de pointer ce projet — danger neutralisé sans réécrire chaque fichier V2.
- **DEV-S71R-03** — **Finding hors docs-only** : CLAUDE.md fixe le connecteur MCP actif à `mcp__claude_ai_Supabase__` (plugin désactivé), **mais la session d'exécution expose `mcp__plugin_supabase_supabase__*`**. Réconcilié vers le canon CLAUDE.md + garde-fou ToolSearch ajouté (`db-engineer`). **À faire vérifier par le propriétaire** contre le setup réel ; la note CLAUDE.md du 2026-07-07 est peut-être à réactualiser.
- **DEV-S71R-05** — P1-4/P1-5 (réconciliation `remise-a-plat` S69 + annotation corps figés) exécutés par 2 subagents ; **faits vérifiés à la source par le main-loop** avant commit : objets S69 = CLAUDE.md, S66/S67/S63/S62 = CLAUDE.md, et le seul fait hors-CLAUDE.md (drill-down JE→origine « S59 ») **confirmé** — `resolveJeSourceEntity.ts` existe dans le code + bandeau S59 **préexistant** dans la fiche 10 (réutilisé, non inventé). Aucune correction nécessaire. Liens ajoutés (`../plans/*-INDEX.md`) vérifiés résolvants.
- **DEV-S71R-04** — **Correction post-vérification adversariale (le double-vérificateur a payé).** Ma première passe P0-1 attribuait à **S50** la fermeture des vues `view_b2b_invoices`/`view_ar_aging` + REVOKE MV anon (repris de MEMORY). `verif-secu-2` a disjoint deux fuites que MEMORY conflatait ; adjugé à la source : ce fix est de `20260619000020/021` (audit 2026-05-31), tandis que S50 (`20260710000055`) a fermé un trou **distinct** (vue legacy `audit_log`). De même le trou reversal PostgREST n'est pas « corrigé S55 » mais une **régression récurrente** `20260619000030` → `20260709000010` → `20260710000084`. Skill désormais sourcé sur les **migrations réelles** plutôt que des n° de session. Les plans datés `docs/superpowers/plans/*` gardant le préfixe MCP obsolète ne sont **pas** réécrits (append-only).
