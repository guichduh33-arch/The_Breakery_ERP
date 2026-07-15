# Spec — Remédiation de gouvernance documentaire (S71)

> Date : 2026-07-09 · Session : S71 · Statut : **READY**
> Source : [`docs/workplan/audits/2026-07-09-audit-general-gouvernance.md`](../audits/2026-07-09-audit-general-gouvernance.md) (591/607 fichiers, 263 findings)
> Findings machine-actionnables : [`…-findings.json`](../audits/2026-07-09-audit-general-gouvernance-findings.json)
> Plan d'exécution : [`../plans/2026-07-09-session-71-audit-remediation-plan.md`](../plans/2026-07-09-session-71-audit-remediation-plan.md)

## 1. Problème

L'audit général de gouvernance (docs-only, `/sparc:orchestrator` + fan-out `Workflow`) révèle une **fracture en trois strates** :

1. **Strate vivante saine** (`CLAUDE.md`, `MEMORY.md`, `remise-a-plat/`, config racine, CI) — fait autorité, aucun défaut structurel.
2. **Strate de référence (`docs/reference/`) — CRITIQUE** : ~90 % décrit l'architecture **V2 mono-app** (mauvais projet Supabase `abjabuniwkqpfsenxljp` = **prod incompatible**, npm/Vercel, PWA/Capacitor, RPC morts). La bannière STALE n'existe qu'au niveau **dossier** → la lecture directe d'un fichier trompe.
3. **Strate d'outillage agents (`.claude/skills` + `.claude/agents`) — à risque** : versions RPC périmées en dur, préfixe MCP d'un connecteur **désactivé**, et surtout **fausses dettes de sécurité** (skill `security-fraud-guard` présente 7 failles **déjà corrigées** comme « ouvertes »).

**Deux défauts peuvent faire agir un agent à tort** : rouvrir un chantier sécurité soldé (P0-1), ou coder/migrer contre l'archi V2 (P0-2/P0-4).

## 2. Objectif

Rendre le corpus documentaire **logique, solide, compréhensible et pérenne** : qu'un lecteur (humain **ou** agent) ouvrant **un fichier isolé** sache en 1 seconde s'il fait foi, et que l'outillage agents reflète l'état réel du code (S71).

**Non-objectif** : régénérer le contenu V2 de `docs/reference/` depuis le code (= Phase 3, chantier séparé). Ici on **neutralise le danger** par bannières + repointage, on ne réécrit pas l'archi.

## 3. Périmètre & critères d'acceptation

### En périmètre (cette session)

| Bande | Intention | Critère d'acceptation |
|---|---|---|
| **P0** | Neutraliser le danger immédiat | Aucune fausse dette sécurité « ouverte » ; aucun `abjabuniwkqpfsenxljp` en exemple d'env vivant ; `README.md` pointe `remise-a-plat/` ; **chaque** fichier `docs/reference/**` porte un bandeau STALE en tête ; runbook DR sans `print_queue`/`complete_order_v9`. |
| **P1** | Aligner l'outillage agents sur le réel S71 | Préfixe MCP = `mcp__claude_ai_Supabase__` partout ; zéro version RPC divergente de CLAUDE.md dans skills/agents ; skills pointant `04-modules` repointés `remise-a-plat/` ; `remise-a-plat/{08,09,05,00-INDEX}` réconciliés S69. |
| **P2 (sous-ensemble sûr)** | Hygiène liens vivants + mono-fichier | hrefs vivants cassés corrigés (S69 INDEX, S50 spec, project-state) ; audits modules archivés ; `DESIGN_POS_AND_BACKOFFICE.md`, `V2_V3_GLOSSARY.md`, `06-print-server.md` traités. |

### Hors périmètre (documenté, non exécuté sans aval propriétaire)

- **P2-1** — archivage en batch S50→~S67 (déplacement de ~21 triplets spec/plan/INDEX) : réorganisation structurelle, à valider.
- **P2-2** — sort de `.claude/commands/` (88 fichiers scaffolding claude-flow/sparc) : **décision propriétaire** (purger vs bannière « vendored optionnel »).
- **P3** — rebase en lot des profondeurs de liens d'archive + bandeaux SUPERSEDED : append-only, faible urgence.
- **Axe E** — cohérence doc↔schéma Supabase **live** : explicitement exclu par le demandeur (docs-only).

## 4. Contraintes

- **Append-only** : ne jamais réécrire le corps d'un doc daté (plan/spec/INDEX/audit). On ajoute des bandeaux et on corrige des liens, on ne récrit pas l'histoire.
- **Versions RPC canoniques (CLAUDE.md, S71)** : `complete_order_with_payment_v17`, `pay_existing_order_v11`, `create_b2b_order_v5`, `fire_counter_order_v4`, `create_tablet_order_v3`, `close_shift_v5`, `void_order_rpc_v4`, `cancel_order_item_rpc_v3`, `get_trial_balance_v3`, `close_fiscal_year_v1`, `get_cashier_variance_v1`, helper `_record_sale_stock_v1`. **Préférer le placeholder `_vN (vérifier CLAUDE.md/migrations)`** plutôt que figer un numéro qui périmera.
- **Projet DB** : cible = `ikcyvlovptebroadgtvd` (V3 dev). `abjabuniwkqpfsenxljp` = V2 prod incompatible — ne jamais présenter comme cible de migration.
- **Aucune modification de code applicatif, migration, ou money-path** — remédiation **documentaire pure**.
- Langue FR, accents corrects.

## 5. Livrables

1. Spec (ce fichier) + plan daté.
2. Corpus P0/P1 corrigé + sous-ensemble P2 sûr.
3. **Garde-fou anti-dérive** : checklist « fin de session » collée dans `CLAUDE.md` (§ closeout) + liste de grep de dérive V2 (audit §7.2/7.3).
4. INDEX de closeout S71-remediation (déviations + reste-à-faire P2-1/P2-2/P3).

## 6. Risques

| Risque | Mitigation |
|---|---|
| Casser un lien canonique vivant en corrigeant un autre | Vérifier chaque href relatif depuis l'emplacement final. |
| Requalifier une dette sécurité à tort (dire « corrigé » alors qu'ouvert) | S'appuyer sur `MEMORY.md` (re-vérifié live 2026-06-27) + INDEX S50/S56 — ne requalifier que les gaps explicitement tracés fermés. |
| Injection de bandeau qui duplique un bandeau existant | Script idempotent : ne pas ré-injecter si marqueur déjà présent. |
| Figer une version RPC qui périmera la session suivante | Placeholder `_vN` privilégié ; checklist garde-fou l'interdit désormais. |
