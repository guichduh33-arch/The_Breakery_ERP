# Plan — Remédiation de gouvernance documentaire (S71)

> Date : 2026-07-09 · Session : S71 · Statut : **P0+P1+P2-sûr LIVRÉS** ; **P2-1 (archivage) + P3 (rebase liens) exécutés le 2026-07-09** (décisions propriétaire, cf. déviations DEV-S71R-06..08)
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

## Décisions propriétaire 2026-07-09 (2ᵉ vague d'exécution)

- **DEV-S71R-03 tranché** — **on GARDE le connecteur `mcp__claude_ai_Supabase__` comme canon** (P1-1 était dans le bon sens ; CLAUDE.md inchangé). La session expose le préfixe plugin mais c'est traité comme atypique — aucune inversion.
- **P2-1 : EXÉCUTÉ** (fenêtre = 4 sessions vivantes S68→S71). Voir DEV-S71R-06.
- **P2-2 : NO-OP CÔTÉ DÉPÔT** — `.claude/commands/` est **gitignored** (0 fichier tracké) : rien à purger dans le dépôt/PR, ces 88 fichiers sont purement locaux. Suppression locale non effectuée (contexte changé, non confirmée). Voir DEV-S71R-08.
- **P3 : PARTIEL** — rebase de liens exécuté (substantiel, vérifié) ; bandeaux SUPERSEDED + renommages NON faits. Voir DEV-S71R-07.

## Reste-à-faire (NON exécuté)

- **P3 (queue longue)** — 81 liens morts résiduels en zone archive tolérée (dont 30 `README` auto-référentiels artefactuels), fichier-dépendants ; bandeaux SUPERSEDED (à re-sourcer, l'audit a des chemins erronés) ; renommages d'homogénéisation.
- **P2-2 (local)** — suppression physique locale de `.claude/commands/` si souhaitée (hors dépôt).
- **Axe E** — cohérence doc↔schéma live (`ikcyvlovptebroadgtvd`).
- **Finding cash-wallets** — l'audit affirme « module Trésorerie jamais implémenté » mais un smoke test `apps/backoffice/…/cash-wallets-hooks.smoke.test.tsx` existe → **contradiction à investiguer** (hors docs-only).

## Déviations

- **DEV-S71R-01** — `security-auth/SKILL.md` n'avait **aucune fausse dette** à purger (l'audit P0-1 l'avait sur-listé) ; seul `security-fraud-guard` portait les 7 gaps périmés. Aucune édition sur security-auth.
- **DEV-S71R-02** — P0-2 (retrait `abjabuniwkqpfsenxljp`) : corrigé **inline** uniquement dans `12-appendices/03-environment-variables.md` (portée audit). La ref subsiste dans 7 autres fichiers `docs/reference/` (00-overview/02, /03 ; 05-integrations/01, /03) mais **tous portent le bandeau STALE** (P0-4) qui interdit explicitement de pointer ce projet — danger neutralisé sans réécrire chaque fichier V2.
- **DEV-S71R-03** — **Finding hors docs-only** : CLAUDE.md fixe le connecteur MCP actif à `mcp__claude_ai_Supabase__` (plugin désactivé), **mais la session d'exécution expose `mcp__plugin_supabase_supabase__*`**. Réconcilié vers le canon CLAUDE.md + garde-fou ToolSearch ajouté (`db-engineer`). **À faire vérifier par le propriétaire** contre le setup réel ; la note CLAUDE.md du 2026-07-07 est peut-être à réactualiser.
- **DEV-S71R-05** — P1-4/P1-5 (réconciliation `remise-a-plat` S69 + annotation corps figés) exécutés par 2 subagents ; **faits vérifiés à la source par le main-loop** avant commit : objets S69 = CLAUDE.md, S66/S67/S63/S62 = CLAUDE.md, et le seul fait hors-CLAUDE.md (drill-down JE→origine « S59 ») **confirmé** — `resolveJeSourceEntity.ts` existe dans le code + bandeau S59 **préexistant** dans la fiche 10 (réutilisé, non inventé). Aucune correction nécessaire. Liens ajoutés (`../plans/*-INDEX.md`) vérifiés résolvants.
- **DEV-S71R-06** — **P2-1 exécuté** (2ᵉ vague). `git mv` de 22 plans/INDEX + 1 spec (S50) vers `{plans,specs}/archive/`. Chemins-backtick entrants réparés en zone vivante **NON append-only** (21 fiches `remise-a-plat`) par `sed` déterministe `plans/<sessionNN>`→`plans/archive/<sessionNN>` (correctif : classe `[A-Za-z0-9]` — `INDEX` majuscule avait fait échouer la 1ʳᵉ passe) ; plans datés `docs/superpowers/**` **non réécrits** (append-only). Vérif : 0 chemin vivant résiduel vers un fichier déplacé. `remise-a-plat-master-plan.md` gardé vivant (référence, non-session).
- **DEV-S71R-07** — **P3 partiel.** Rebase de liens d'archive exécuté et **mesuré** (linkcheck avant/après : **194→81** occurrences mortes, −58 %, 0 régression — cibles vérifiées existantes) : L-5 glossaire, L-6 profondeur `reference` (+1 niveau), régression `audit/`→`audit/archive/` causée par P2-4, et 12 liens README à intention explicite. **Bandeaux SUPERSEDED + renommages NON faits** : l'audit cite des chemins erronés (`cash-wallets` est sous `docs/superpowers/…/archive/`, pas `workplan/plans/archive/`) et une affirmation **contredite par le code** (« cash-wallets jamais implémenté » vs smoke test existant) — refus d'écrire une assertion non sourçable en zone archive.
- **DEV-S71R-08** — **P2-2 = no-op dépôt.** `.claude/commands/` est **gitignored** (0 fichier tracké) : la décision « purger » n'a aucun effet sur le dépôt/PR ; les 88 fichiers scaffolding sont purement locaux et n'ont jamais pollué le versioning. Suppression physique locale non effectuée sans confirmation (le contexte « gitignored » diffère de celui de la décision).
- **DEV-S71R-04** — **Correction post-vérification adversariale (le double-vérificateur a payé).** Ma première passe P0-1 attribuait à **S50** la fermeture des vues `view_b2b_invoices`/`view_ar_aging` + REVOKE MV anon (repris de MEMORY). `verif-secu-2` a disjoint deux fuites que MEMORY conflatait ; adjugé à la source : ce fix est de `20260619000020/021` (audit 2026-05-31), tandis que S50 (`20260710000055`) a fermé un trou **distinct** (vue legacy `audit_log`). De même le trou reversal PostgREST n'est pas « corrigé S55 » mais une **régression récurrente** `20260619000030` → `20260709000010` → `20260710000084`. Skill désormais sourcé sur les **migrations réelles** plutôt que des n° de session. Les plans datés `docs/superpowers/plans/*` gardant le préfixe MCP obsolète ne sont **pas** réécrits (append-only).
