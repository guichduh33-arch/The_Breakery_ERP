<!-- Généré le 2026-07-09 — audit read-only, docs-only. Ne pas réécrire l'historique daté. -->

# Audit général de gouvernance — documentation, config projet & config Claude
### The Breakery ERP (V3) — 2026-07-09 · session S71

## 0. Méthodologie & couverture

**Commande de cadrage** : `/sparc:orchestrator`.
**Moteur d'exhaustivité** : `Workflow` (fan-out multi-agents) — 41 sous-agents auditeurs **lecture-seule** en parallèle (~15 fichiers/agent) + 1 agent de synthèse (opus).
**Rubrique par fichier** : grille du skill `docs-curator` (classement canonique/historique/archive/périmé/doublon/orphelin/config/déchet + issues P0-P3).
**Portée** : `docs/**`, `CLAUDE.md`, `README.md`, `CHANGELOG.md`, `.claude/**` (7 agents, 21 skills, 88 commandes, settings, `.mcp.json`), config racine + 6 workflows CI.
**Choix explicite du demandeur** : **docs-only** — aucune vérification contre la base Supabase live (les faits de schéma ne sont confrontés qu'aux *autres documents*, jamais à la DB). Un axe « cohérence doc↔schéma réel » reste donc à faire ultérieurement contre le projet `ikcyvlovptebroadgtvd`.

**Couverture** : **591 / 607 fichiers** réellement lus. Les **16 manquants = lot-13** (erreur API mid-run) sont tous de vieux plans **déjà archivés** `docs/workplan/plans/archive/2026-05-03…2026-05-12` (sessions S8-S12 gelées) — angle mort **bénin**, hors zone critique. Ils peuvent être re-audités via `Workflow({resumeFromRunId})`.

**Détail machine-actionnable** : les 263 findings bruts (fichier, sévérité, catégorie, preuve, reco) sont dans le sidecar [`2026-07-09-audit-general-gouvernance-findings.json`](./2026-07-09-audit-general-gouvernance-findings.json).

> ⚠️ Note de lecture : dans le corps ci-dessous, l'agent de synthèse a **regroupé** des issues (les compteurs « ~150 issues » de son texte reflètent des familles agrégées ; les vrais totaux unitaires sont **263 issues / 591 fichiers**, cf. §1). Il a aussi promu certaines P1 en actions « P0 » dans le plan §6 — c'est une repriorisation d'action délibérée, pas une divergence de données.

---

## 1. Résumé exécutif

### État de santé global : **6/10 — corpus vivant sain, corpus de référence largement périmé**

La gouvernance du projet souffre d'une **fracture nette entre trois strates** :

- **Strate canonique vivante (saine)** — `CLAUDE.md`, `MEMORY.md`, `docs/workplan/remise-a-plat/`, les INDEX de session, la config racine (`package.json`, `turbo.json`, `.github/workflows`, `playwright.config.ts`) : à jour, cohérente, fait autorité. Aucun défaut structurel.
- **Strate de référence (`docs/reference/`) — critique** : ~90 % des fichiers décrivent **l'architecture V2 mono-app (AppGrav)** — mauvais projet Supabase, npm/Vercel, PWA/Capacitor, RPC obsolètes. Danger opérationnel réel (un lecteur peut appliquer une migration sur `abjabuniwkqpfsenxljp` = **prod V2 incompatible**).
- **Strate d'outillage agents (`.claude/skills` + `.claude/agents`) — à risque** : versions RPC périmées, préfixe MCP d'un connecteur **désactivé**, et surtout des **fausses dettes de sécurité** rouvertes (skill `security-fraud-guard` présente comme « ouvertes » 7 failles toutes corrigées).

### Chiffres clés

| Indicateur | Valeur |
|---|---|
| Zones auditées | ~30 |
| Classes de fichiers | canonique 48 · historique 230 · archive 130 · **périmé 52** · **orphelin 53** · config 74 · doublon 2 · déchet 2 |
| Catégories d'issues | **lien-mort 123** · périmé 56 · incohérence 41 · contradiction 19 · mal-placé 8 · doublon 5 · orphelin 4 · déchet 3 |
| Fichiers audités / en scope | **591 / 607** (16 non couverts = lot-13, cf. note de couverture) |
| Issues levées | **263** |
| **P1 (critique)** | **38** — concentrées sur `docs/reference` (V2), `.claude/skills` (sécurité/RPC), `README.md` |
| P2 (majeur) | **93** |
| P3 (mineur / archive) | **132** |
| Contradictions inter-documents avérées | 12+ |
| Familles de liens morts | 9 (voir §5) |
| Danger de sécurité fonctionnelle (fausses dettes rouvertes) | 1 skill (`security-fraud-guard`), P1 |
| Danger opérationnel DB (mauvais projet Supabase documenté) | 4 fichiers, P1 |

### Verdict par priorité d'action
1. **Neutraliser le danger** : bandeau STALE en tête de `docs/reference/`, corriger `README.md`, purger les fausses dettes du skill `security-fraud-guard`, retirer le ref `abjabuniwkqpfsenxljp` des exemples d'env.
2. **Aligner l'outillage agents** : préfixe MCP + versions RPC des 6 skills/agents concernés.
3. **Réconcilier `remise-a-plat`** avec S69 (headers manquants).
4. **Hygiène d'archive** : archiver S50→~S67, corriger en lot les profondeurs de liens.

---

## 2. Santé par zone

| Zone | Volume | État | Diagnostic |
|---|---|---|---|
| **`CLAUDE.md`** | 1 | ✅ **Sain** | Source de vérité, à jour S71. Aucun défaut. |
| **`MEMORY.md`** | (global) | ✅ Sain | Canonique, cohérent. |
| **Config racine** (`package.json`, `turbo.json`, `tsconfig.base.json`, `eslint.config.mjs`, `pnpm-workspace.yaml`, `vercel.json`, `.env.example`, `.npmrc`, `.prettier*`, `playwright.config.ts`) | ~13 | ✅ Sain | Aucune issue levée. |
| **`.github/workflows`** | 6 | ✅ Sain | Aucune issue. |
| **`docs/workplan/remise-a-plat/`** | (ref modules vivante) | 🟠 **À risque léger** | Autorité actuelle, mais **non réconciliée avec S69** (fiches 08/09/05 + 00-INDEX contredisent CLAUDE.md), et corps figés qui contredisent leurs propres headers (12, 14, 21, 10). |
| **`docs/workplan/plans` & `specs` (vivants)** | S50→S70 | 🟠 À risque | Sessions mergées **non archivées** (accumulation), quelques hrefs cassés (S69 INDEX, S50 spec). |
| **`docs/workplan/**/archive/`** | 44+ | 🟡 Toléré | Régressions de profondeur de liens massives post-archivage (`../../` vs `../../../`, `../specs/` vs `../../specs/archive/`) — cosmétique mais systémique. |
| **`docs/_archive/`** | 44 | 🟡 Toléré | Liens `V2_V3_GLOSSARY.md` et `CURRENT_STATE.md` morts (profondeur), disclaimés par les notes d'archive. Faible priorité. |
| **`docs/superpowers/`** | 61 | 🟡 Majoritairement sain | Plans/specs datés append-only. Dérive MCP (plugin désactivé) et filtre pnpm `@breakery/backoffice` erroné — à ne pas rejouer. |
| **`docs/reference/`** | 64 | 🔴 **CRITIQUE** | ~90 % décrit V2 (mono-app, npm/Vercel, `abjabuniwkqpfsenxljp`, PWA/Capacitor, RPC morts). Bannière STALE **au niveau dossier seulement** → lecture directe de fichier trompe. |
| **`docs/DESIGN_POS_AND_BACKOFFICE.md`** | 1 | 🟠 À risque | Liens `docs/Design/` (déplacé en `_archive`) + artefacts `_bmad/`/`breakery-platform/` inexistants. |
| **`docs/V2_V3_GLOSSARY.md`** | 1 | 🟠 À risque | Colonne « V3 réel » figée ère S25 (versions RPC fausses), lien backlog mort. |
| **`README.md` (racine)** | 1 | 🔴 **À risque fort** | Présente `docs/reference/` comme « source de vérité » (contredit CLAUDE.md) + 2 liens de dossiers inexistants (`v2-reference/`, `Ux-reference/`). |
| **`.claude/skills`** | 6 (+ skills projet) | 🔴 À risque | Versions RPC périmées, MCP désactivé, **fausses dettes sécurité** (`security-fraud-guard` P1), `04-modules` cité comme canonique. |
| **`.claude/agents`** | 7 | 🟠 À risque | `db-engineer`/`pos-specialist` versions RPC obsolètes, `session-coordinator` pointe backlog archivé, préfixe MCP désactivé. |
| **`.claude/commands`** | 88 | 🔴 **Déchet/orphelin** | Scaffolding générique `claude-flow`/`ruv-swarm` (analysis, automation, github, sparc…) non aligné au workflow projet, index désynchronisés, repo externe `ruvnet/ruv-FANN` hardcodé, rapport de conformité égaré. |
| **`docs/audit`, `docs/adr`, `docs/runbooks`, `docs/product`** | ~7 | 🟠 À risque ponctuel | Runbook DR envoie vers `print_queue` (droppée S62) — P1. ADR sains. Audits modules à archiver. |

---

## 3. Contradictions inter-documents

> Conflit direct entre deux fichiers de gouvernance (ou fichier vs canonique CLAUDE.md/MEMORY.md).

| # | Sujet | Fichier A (erroné) | Fichier B (canonique) | Sévérité |
|---|---|---|---|---|
| C-1 | **V2 en production** | `docs/reference/00-overview/01-product-context.md` (« V2 production-ready … en exploitation ») ; `.../specs/archive/2026-05-13-session-13-spec.md` | `MEMORY.md` (v2-not-in-production) ; `CLAUDE.md` | P1 |
| C-2 | **Projet Supabase de travail** | `.../00-overview/02-business-overview.md`, `.../12-appendices/03-environment-variables.md`, `.../05-integrations/01-supabase.md` (→ `abjabuniwkqpfsenxljp`) | `CLAUDE.md` (cible = `ikcyvlovptebroadgtvd` ; abjabu = V2 incompatible) | P1 |
| C-3 | **Longueur PIN** | `.../04-modules/01-auth-permissions.md` (4 chiffres) | `CLAUDE.md`/`MEMORY.md` (6 chiffres, S58) | P1 |
| C-4 | **RPC money-path** | `.../04-modules/02-pos-cart-orders.md` + `03-payments-split.md` + `11-conventions/04-supabase-patterns.md` (`complete_order_with_payments`, SECURITY INVOKER, appelé par POS) | `CLAUDE.md` (`complete_order_with_payment_v17`, SECURITY DEFINER, via EF process-payment) | P1 |
| C-5 | **Primitives UI shadcn** | `.../02-design-system/03-shadcn-primitives.md` (Select installé) | skill `breakery-ui-kit` (pas d'export Select/RadioGroup → fallbacks natifs) | P1 |
| C-6 | **PWA/Capacitor vivants** | `.../02-design-system/06,07`, `.../05-integrations/04,05`, `.../04-modules/18-mobile-shell.md` | `MEMORY.md`/`CLAUDE.md` (PWA purgée S62, owner-decisions 2026-07-06) | P1 |
| C-7 | **KDS/LAN hub vivant** | `.../04-modules/04-kds-kitchen.md`, `.../06-lan-architecture/*` | `CLAUDE.md` (mesh LAN mort S62, internet-first) | P1 |
| C-8 | **Taille max fichier** | `.../12-appendices/02-file-organization.md` (300 lignes) | `CLAUDE.md` (500 lignes) | P1 |
| C-9 | **`docs/reference` = source de vérité** | `README.md` l.81 | `CLAUDE.md` (04-modules STALE ; réf = remise-a-plat) | P1 |
| C-10 | **Prix négocié B2B inexistant** | `remise-a-plat/09-b2b-wholesale.md` + `08-customers-loyalty.md` + `05-products-categories.md` + `00-INDEX.md` | `CLAUDE.md` (S69 : `customer_product_prices`, `create_b2b_order_v5`, D-W6-CUSTCAT-01 fermée) | P1 |
| C-11 | **Failles sécurité ouvertes** | skill `security-fraud-guard` (7 gaps « verified critical ») | `MEMORY.md` (toutes corrigées, re-vérifié 2026-06-27) | P1 |
| C-12 | **Table audit** | skill `security-fraud-guard` + plans S13 (`audit_log` singulier écrit) | `CLAUDE.md` (S56 : vue `audit_log` DROPPÉE, `audit_logs` seule surface) | P1 |
| C-13 | **04-modules « canonical »** | skills `stock-management`, `pos-flow-audit` | `_AVERTISSEMENT.md` + `CLAUDE.md` (STALE, réf = remise-a-plat) | P2 |
| C-14 | **Corps de fiche vs son propre header** | `remise-a-plat/12` (B1.4 🔴 vs header S66/S67), `14` (dashboard « n'existe pas » vs header S63), `21` (print_queue présente vs header S62), `10` (B1.2 🟠 vs header S59) | header interne du même fichier | P2 |

---

## 4. Fichiers périmés / doublons / orphelins / déchets

### 4.1 Périmés — décrivent V2, dangereux si pris pour l'état courant
- **Tout `docs/reference/00-overview/`** (01→05) : produit-context, business-overview, tech-stack, repository-structure, glossary.
- **Tout `docs/reference/02-design-system/`** (01→07 + `_AVERTISSEMENT` insuffisant) : chemins `src/`, `/DESIGN.md` mort, PWA/Capacitor.
- **Tout `docs/reference/04-modules/`** (06→19) : bannière STALE au niveau dossier seulement ; RPC/PIN/KDS/pricing V2.
- **Tout `docs/reference/05-integrations/`** (01→09) : `abjabuniwkqpfsenxljp`, 15 EF V2, Sentry mono-app, PWA, jsPDF client. (`06-print-server.md` = mixte : moitié V3 à promouvoir.)
- **`docs/reference/06-lan-architecture/`** (mesh mort), **`12-appendices/03,06`** (`breakery-platform/`, env V2), **`runbooks/disaster-recovery.md`** (Scénario 6 `print_queue` droppée + Appendix A `complete_order_v9`).
- **`docs/V2_V3_GLOSSARY.md`** (colonne V3 figée S25).
- **`docs/_archive/objectif-travail-v2/*`, `backlog-by-module-fige-S14-S30/*`** : périmés **par nature** (archive gelée) — à laisser, disclaimer suffit.

### 4.2 Doublons
- **Deux specs S26** : `specs/archive/2026-05-19-session-26-spec.md` (4 pages CSV) **supplantée par** `2026-05-20-session-26-spec.md` (5 pages, ADR-003) — non signalé.
- **Deux INDEX « session-26 »** : `plans/archive/2026-05-19-session-26-INDEX.md` est en réalité un **plan** (2571 lignes) ; le vrai closeout est `2026-05-20-session-26-INDEX.md`.
- **Deux « Wave 2 deviations » S13** (05-13 phase 2.B vs 05-14 phases 2.C/2.D/2.A), même titre.
- **`session-16` : INDEX + `plan.md` séparé** (seule session avec les deux, ~2500 lignes redondantes).
- **`analysis:performance-report` vs `performance-bottlenecks`** et doublons de scaffolding claude-flow.

### 4.3 Orphelins
- **6 plans standalone `2026-06-01-pos-*`** (double-print-risk, print-bridge-deploy, paymentterminal-refactor, realtime-channel-uniqueness, receipt-payment-method, refund-test-investigation) : **aucun INDEX**, jamais mergés en standalone (fondus dans S34/S35/S36).
- **`plans/archive/2026-06-23-cash-wallets-tresorerie.md`** : module Trésorerie complet **jamais implémenté/mergé** (absent de S50→S70).
- **`docs/product/DESCRIPTION.md`** : promis « à créer » depuis 2026-07-04, cité comme réf vivante dans README, **n'existe pas**.
- **Tout `.claude/commands/`** (claude-flow-*, github/*, sparc/*, hooks/*, monitoring/*, optimization/*) : scaffolding vendeur générique, non aligné au workflow Agent+SendMessage.

### 4.4 Déchets (à supprimer)
- **`.claude/commands/analysis/COMMAND_COMPLIANCE_REPORT.md`** : rapport auto-généré égaré (« Total files reviewed: 2 » faux).
- **`.claude/commands/github/release-manager.md`** (+ issue-tracker, pr-manager, multi-repo-swarm, project-board-sync) : **repo externe `ruvnet/ruv-FANN` hardcodé** — un agent le suivant ciblerait le mauvais dépôt.
- **README d'index désynchronisés** : `analysis/README` (3/9), `automation/README` (3/7), `github/README` (5/18).

### 4.5 Mal placés (rangement incohérent)
- **Audits modules** `docs/audit/2026-05-28-pos-audit.md` + `2026-06-12-stock-management-audit.md` restés à la racine alors que `2026-06-01` est déjà dans `audit/archive/`.
- **`docs/workplan/audits/2026-05-20-audit-integral-V3/`** (7 fichiers) hors `archive/` (gardé live pour ADR-003).
- **INDEX/specs S50→S70** (21 sessions mergées) dans la zone vivante `docs/workplan/{plans,specs}/`.
- **`docs/workplan/specs/2026-06-27-session-50-spec.md`** hors `specs/archive/`.

---

## 5. Liens croisés morts (familles)

> 9 familles systémiques ; réparer la **cause** (règle de réécriture) plutôt que fichier par fichier.

| # | Famille | Cible manquante | Fichiers affectés | Fix |
|---|---|---|---|---|
| L-1 | **Chapitres reference supprimés (2026-07-04)** | `01-architecture/`, `03-database/`, `07-security/`, `08-flows-end-to-end/`, `09-testing/`, `10-deployment-ops/` | `05-integrations/*`, `06-lan-architecture/*`, `11-conventions/*`, `12-appendices/*`, `04-modules/10` | Purger à la régénération Phase 3 |
| L-2 | **`backlog-by-module/` déplacé** | `docs/workplan/backlog-by-module/` → `docs/_archive/backlog-by-module-fige-S14-S30/` | `04-modules/*`, `V2_V3_GLOSSARY.md`, `session-coordinator.md`, refs archive S13, specs archive | Repointer vers `_archive/` |
| L-3 | **`/DESIGN.md` racine absent (~35 liens)** | `DESIGN.md` (racine) | tout `02-design-system/`, `04-modules/*` Partie IV | Repointer `docs/DESIGN_POS_AND_BACKOFFICE.md` / `packages/ui/src/styles/` |
| L-4 | **`docs/Design/` déplacé** | `docs/Design/{backoffice,caissapp}/*.jpg` (122) → `docs/_archive/design-screenshots-pre-code/` | `DESIGN_POS_AND_BACKOFFICE.md`, `specs/archive/2026-05-14-session-14-spec.md` | Repointer `_archive/` |
| L-5 | **`V2_V3_GLOSSARY.md` — mauvaise profondeur** | `../V2_V3_GLOSSARY.md` (résout `_archive/…`) → réel `docs/V2_V3_GLOSSARY.md` | ~15 fichiers `docs/_archive/objectif-travail-v2/*` | `../../V2_V3_GLOSSARY.md` |
| L-6 | **Régression profondeur post-archivage** | `../../README.md` → `docs/workplan/README.md` (absent) ; `../../reference/` ; `../plans/` ; `../specs/` | ~25 fichiers `plans/archive/*`, `specs/archive/*`, `refs/archive/*` | Rebaser `../../`→`../../../`, `../specs/`→`../../specs/archive/` |
| L-7 | **`CURRENT_STATE.md` racine absent** | `CURRENT_STATE.md` | `00-overview/01`, `12-appendices/05`, `_archive/backlog-by-module/*` | Repointer `remise-a-plat/00-INDEX.md` ou purger |
| L-8 | **Fichiers LAN mal nommés** | `06-lan-architecture/02-hub-client-protocol.md` (réel `01-hub-client-model.md`), `05-discovery.md` (réel `02-discovery.md`) | `05-integrations/01,02,04,06` | Corriger les noms |
| L-9 | **hrefs vivants cassés** | S69 INDEX (préfixe `../../superpowers/` oublié), S50 spec (`2026-06-27-triangulated-audit-synthesis…` inexistant), `2026-06-27-project-state-and-gaps.md`→`docs-curation-audit` daté du 28 | `plans/2026-07-08-session-69-INDEX.md`, `specs/2026-06-27-session-50-spec.md`, `audits/2026-06-27-project-state-and-gaps.md` | Fix ciblé (vivants → prioritaires) |

---

## 6. Plan de remédiation priorisé

### 🔴 P0 — Danger immédiat (agent/dev induit en erreur grave). Effort total : ~½ journée
| # | Action | Fichiers | Effort |
|---|---|---|---|
| P0-1 | **Purger les fausses dettes de sécurité** : requalifier en « corrigé S50/S56, re-vérifié 2026-06-27 » les 7 gaps, le PIN-body void/cancel (sweep S34), le `audit_log` legacy (droppé S56) | `.claude/skills/security-fraud-guard/SKILL.md`, `.claude/skills/security-auth/SKILL.md` | 1 h |
| P0-2 | **Retirer `abjabuniwkqpfsenxljp` des exemples d'env** et pointer `ikcyvlovptebroadgtvd` ; corriger `database.generated.ts`→`packages/supabase/src/types.generated.ts` | `docs/reference/12-appendices/03-environment-variables.md` | 15 min |
| P0-3 | **Corriger `README.md`** : `docs/reference` n'est plus « la source de vérité » → renvoyer `remise-a-plat/` ; supprimer liens `v2-reference/`, `Ux-reference/` ; aligner texte/href du lien Spec | `README.md` | 20 min |
| P0-4 | **Bandeau STALE en tête de CHAQUE fichier `docs/reference/`** (00, 02, 04-modules, 05, 06, 12) renvoyant à `remise-a-plat/` — l'`_AVERTISSEMENT` au niveau dossier ne protège pas la lecture directe | `docs/reference/**` (script d'injection d'en-tête) | 1,5 h |
| P0-5 | **Runbook DR** : retirer Scénario 6 (`print_queue` droppée S62) + durcissement PWA Scénario 5 ; corriger Appendix A `complete_order_v9`→`v17` | `docs/runbooks/disaster-recovery.md` | 30 min |

### 🟠 P1 — Outillage agents & réconciliation canonique. Effort : ~1 journée
| # | Action | Fichiers | Effort |
|---|---|---|---|
| P1-1 | **Aligner le préfixe MCP** `mcp__plugin_supabase_supabase__` → `mcp__claude_ai_Supabase__` (connecteur actif) | `.claude/agents/{db-engineer,edge-functions-engineer,pos-specialist,backoffice-specialist}.md`, `.claude/skills/{db-migrations,accounting,report-audit}/SKILL.md` | 45 min |
| P1-2 | **Neutraliser les versions RPC** des skills/agents : remplacer par `_vN (vérifier CLAUDE.md/migrations)` ou mettre à jour (v17/v11/v5/v3/v2, `close_shift_v5`, `_record_sale_stock_v1`, `get_trial_balance_v3`, `close_fiscal_year_v1`) | `.claude/skills/{b2b-credit,accounting,stock-management,orders,pos-flow-audit,products-catalog,reports-exports}`, `.claude/agents/{db-engineer,pos-specialist}` | 3 h |
| P1-3 | **Repointer « sources canoniques »** des skills de `04-modules` → `remise-a-plat/` | `stock-management`, `pos-flow-audit`, `session-coordinator` (backlog→`remise-a-plat/00-INDEX.md`) | 45 min |
| P1-4 | **Réconcilier `remise-a-plat` avec S69** : headers « Mise à jour S69 » sur fiches 08/09/05, passer verdicts C-B1.1/C-B1.2/C-B1.7 en ✅, mettre à jour `00-INDEX` (Vague 2/3), noter `create_b2b_order_v5` | `remise-a-plat/{08,09,05,00-INDEX}.md` | 1,5 h |
| P1-5 | **Annoter les corps figés vs headers** (rappel « tableau figé au 5b0fa92, supplanté par headers ») | `remise-a-plat/{12,14,21,10}.md` | 45 min |

### 🟡 P2 — Hygiène de rangement & liens vivants. Effort : ~1 journée
| # | Action | Fichiers | Effort |
|---|---|---|---|
| P2-1 | **Archiver en batch S50→~S67** (triplets spec/plan/INDEX) vers `{specs,plans}/archive/`, fenêtre glissante des 3-4 dernières sessions vivantes ; déplacer `2026-06-27-session-50-spec.md` | `docs/workplan/{plans,specs}/*` | 2 h |
| P2-2 | **Décider du sort de `.claude/commands/`** : purger (ou `docs/_archive/`) le scaffolding claude-flow/github/sparc non utilisé ; a minima bandeau « vendored optionnel » + supprimer `COMMAND_COMPLIANCE_REPORT.md` et regénérer les README d'index | `.claude/commands/**` | 1 h |
| P2-3 | **Corriger hrefs vivants** (S69 INDEX préfixe, S50 spec lien audit, project-state→curation daté) | 3 fichiers | 20 min |
| P2-4 | **Uniformiser audits modules** : archiver `2026-05-28-pos` + `2026-06-12-stock` sous `audit/archive/` | `docs/audit/*` | 15 min |
| P2-5 | **`DESIGN_POS_AND_BACKOFFICE.md`** : repointer `docs/Design/`→`_archive/design-screenshots-pre-code/`, marquer `_bmad`/`breakery-platform` absents | 1 fichier | 30 min |
| P2-6 | **`V2_V3_GLOSSARY.md`** : bannière de péremption (versions RPC → CLAUDE.md) + fix lien backlog | 1 fichier | 20 min |
| P2-7 | **Extraire/promouvoir la moitié V3** de `06-print-server.md` (station-routing S34, print-bridge) hors de la référence V2 | 1 fichier | 30 min |

### ⚪ P3 — Archive & cohérence de traçabilité (append-only, faible urgence). Effort : ~½ journée
- Rebaser en **lot** les profondeurs de liens d'archive (L-5, L-6) — script unique `sed`-like, pas fichier par fichier.
- Bandeaux « SUPERSEDED » : specs S26 (05-19), promotions S8→S9, `2026-05-20-audit-integral-V3-plan.md` (READY→ARCHIVE), 6 plans `2026-06-01` orphelins, `cash-wallets` (ABANDONNÉ), specs S68/S69/S70 vers `specs/archive/`.
- Renommages d'homogénéisation : `session-13-deviation-pack`→`-wave-1-deviations`, `2026-05-19-session-26-INDEX`→`-plan`.
- **Ne pas réécrire** le corps des docs datés append-only ; corriger uniquement liens/bandeaux.
- Confirmer/marquer `docs/product/DESCRIPTION.md` (créer ou noter « non matérialisé » dans README).

---

## 7. Structure pérenne + garde-fou anti-dérive

### 7.1 Hiérarchie de vérité cible (où va quoi)

```
SOURCE DE VÉRITÉ VIVANTE (fait foi, maintenue in-place)
├── CLAUDE.md ................... état projet + patterns critiques + workplan
├── MEMORY.md ................... décisions propriétaire + pièges persistants
├── docs/workplan/remise-a-plat/ . référence modules réel-vs-demandé (Phase 3 = régen depuis code)
├── docs/workplan/{plans,specs}/ . SESSION COURANTE + 3-4 précédentes uniquement
└── .claude/{skills,agents}/ .... outillage — RPC en placeholder _vN, MCP = connecteur actif

HISTOIRE APPEND-ONLY (jamais réécrite, seulement datée)
├── docs/workplan/{plans,specs,refs}/archive/  sessions mergées
├── docs/workplan/audits/  audits datés (archive/ pour les résolus)
└── docs/superpowers/{plans,specs}/  + archive/

ARCHIVE GELÉE (disclaimer en tête, liens non maintenus)
├── docs/reference/  ← À RÉGÉNÉRER (Phase 3) OU déplacer sous _archive/ ; V2 = danger
└── docs/_archive/  objectif-travail-v2, backlog-by-module-fige, design-screenshots

DÉCISION REQUISE
└── .claude/commands/  ← purger le scaffolding générique OU bannière « vendored optionnel »
```

**Règle d'or** : un lecteur qui ouvre **un fichier isolé** doit savoir en 1 seconde s'il fait foi. Donc **la bannière STALE va en tête de chaque fichier périmé**, pas seulement au niveau dossier.

### 7.2 Checklist garde-fou — fin de session (à coller dans `CLAUDE.md` § closeout)

```
FIN DE SESSION Sxx — avant merge :
□ CLAUDE.md « In flight » / « Merged (latest) » mis à jour (nouvelle session).
□ remise-a-plat : header « Mise à jour Sxx » ajouté aux fiches touchées
   (verdicts C-Bx.x réconciliés avec le header, pas seulement le header).
□ Aucune version RPC EN DUR ajoutée dans un skill/agent (utiliser « _vN — vérifier CLAUDE.md »).
□ Préfixe MCP écrit = mcp__claude_ai_Supabase__ (jamais le plugin désactivé).
□ Session S(xx-4) archivée : git mv des triplets spec/plan/INDEX vers */archive/
   (fenêtre glissante = 4 sessions vivantes max).
□ Nouveau lien inter-doc = chemin RELATIF vérifié depuis l'emplacement final
   (attention profondeur après un futur archivage).
□ Aucun nouveau fichier « à créer » cité comme source vivante s'il n'existe pas.
□ Types regen commit si migration (cause #1 de CI cassée).
□ Fichier > 500 lignes ? scinder (CLAUDE.md, PAS 300).
```

### 7.3 Contrôle périodique (trimestriel, ~2 h)
- **Grep dérive V2** : `abjabuniwkqpfsenxljp`, `AppGrav`, `breakery-platform`, `vite-plugin-pwa`, `Capacitor`, `complete_order_with_payments`, `PIN à 4`, `audit_log ` (singulier), `mcp__plugin_supabase` → toute occurrence hors `_archive/` et hors doc datée = à corriger.
- **Linkcheck** sur `docs/**/*.md` (hors `_archive/`) → 0 lien mort toléré en zone vivante.
- **Diff CLAUDE.md ↔ skills/agents** sur les versions RPC : rejeter tout numéro divergent.
- Relancer le skill `docs-curator` (audit-first) une fois par trimestre.

---

*Fin du rapport. Priorité absolue : P0-1 (fausses dettes sécurité) et P0-4 (bannières STALE reference) — ce sont les deux seuls défauts qui peuvent faire agir un agent à tort (rouvrir un chantier soldé, ou coder contre l'archi V2).*