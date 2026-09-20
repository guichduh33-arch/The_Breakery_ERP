---
name: report-audit
description: >-
  Diagnostiquer un rapport BO Breakery incorrect : chiffres, dates, RPC/payload, graphiques, états ou export. Suivre données → affichage sur le périmètre demandé. Nouveau rapport/KPIs : report-designer ; câblage : reports-exports.
---

# Report Audit — The Breakery V3 (apps/backoffice)

Une plainte sur un rapport commence en mode rapport unique, pas par l’inventaire du module. Lire la phase données/payload et les contrôles de graphes nécessaires ; réserver la gap analysis à une demande de couverture.

## Lecture proportionnée

Les règles d’AGENTS.md restent applicables. Les liens ci-dessous sont conditionnels : ne pas charger tout le dossier ni tous les skills voisins. Réutiliser les lectures déjà faites dans la session ; rouvrir si le code ou le périmètre a changé.

| Quand lire | Ressource |
|---|---|
| Pour le contrat, le parcours ou la surface concernée ; avant toute modification de sa logique. | [modèle, contrats et repères](references/model.md) |
| Pour conduire la conception, le diagnostic ou le conseil demandé ; lire seulement le cas correspondant. | [méthode ciblée](references/workflow.md) |

## Single-Report Mode

When the user names one report (or complains it "looks wrong"):
1. Locate its three artifacts: `pages/reports/<Name>Page.tsx`, `features/reports/hooks/use<Name>.ts`, and the backing RPC of the `get_<name>` family in migrations. **La version live se lit au call-site, jamais devinée** — le module fait cohabiter plusieurs générations de `_vN`, et un numéro se périme entre deux sessions.
2. Lire les phases 2 (hook→RPC→interface) et 3 du [workflow](references/workflow.md), puis les appliquer à ce seul rapport.
3. Run Phase 4 on every chart in the page — this is where most "it looks wrong" bugs live.
4. Skip Phases 1/5/6 unless asked.

Most common chart root causes: **wrapper à la sémantique fausse (apparié là où c'est additif)**, **dual
Y-axis with independent scales** sur une page qui appelle Recharts en direct, **missing `stackId`**, **chart
vs table ordering**, **duplicate Bar+Line on one dataKey**.

## Known baseline (don't flag as new)

- Env-gated live tests (`generate-pdf`, Vitest live RPC) **fail without `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`** exported — that's the known baseline, not a report bug.
- DB is cloud-only (Docker retired). Verify RPC/view existence by reading migrations or MCP `execute_sql`, never `supabase db reset`.
- **Les commentaires et en-têtes de fichier en français sont la RÈGLE**, pas une dette : ne jamais les compter comme `FRENCH_IN_UI`.
- **Deux conventions de nommage des bornes de date** (`p_date_start`/`p_date_end` et `p_start_date`/`p_end_date`) coexistent volontairement dans les signatures existantes. Ce n'est pas un finding en soi — seul un hook qui passe la MAUVAISE des deux en est un.
- **Le hub montre les tuiles de rapports que l'utilisateur ne peut pas ouvrir** — décision assumée, la `PermissionGate` refuse à l'entrée de la route.
- **`ReportPage` cohabite encore avec `ReportShell`** : la migration vers l'archétype s'est faite par vagues et n'est pas soldée. C'est de la dette connue (`LEGACY_SHELL`, P3), pas une régression.
- Les filtres vitest matchent le **nom de fichier**, pas le `describe`, et beaucoup de tests du BO sont en **kebab-case** — localiser par glob, jamais par nom de composant, sinon un filtre vert ne prouve rien.

## Qualité de restitution

Répondre d’abord au problème demandé. Distinguer fait observé, intention métier et hypothèse ; ancrer les constats dans le code lu ou le résultat mesuré. Un ancien relevé n’est pas une preuve actuelle. Donner impact, correction ou décision attendue, vérification effectuée et limite éventuelle ; ne pas remplir des rubriques sans résultat utile. Une consigne de skill n’élargit pas l’autorisation donnée par Mamat.
