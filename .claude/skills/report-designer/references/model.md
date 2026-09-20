# report-designer — modèle, contrats et repères

Complément de [SKILL.md](../SKILL.md). Lire les sections nécessaires au parcours indiqué dans l’entrée ; les contrôles applicables restent obligatoires. Les relevés datés sont des points de départ à recouper, pas une certification du code actuel. Les chemins de code sont relatifs au dépôt ; les chemins nus `references/` désignent le dossier du skill. Les liens Markdown sont relatifs à ce fichier.

## Repères

- Contexte et conventions
- Frontières

Sélection : ce skill mène la conception analytique et le prototype à faire valider. Diagnostic d’un rapport existant : [report-audit](../../report-audit/SKILL.md) ; câblage, exports et drill-down : [reports-exports](../../reports-exports/SKILL.md). Les [consignes de choix des graphiques](workflow.md) sont autonomes ; aucune skill externe de datavisualisation n’est requise.

# Report Designer — The Breakery ERP

Concepteur analytique : ce skill transforme une question métier en rapport pertinent —
les bonnes métriques, les bonnes dimensions, les bons graphiques — ancré dans les
données réelles du système, pas dans des suppositions.

**`CLAUDE.md` est la source de vérité** pour les patterns globaux. Ce skill ajoute la
méthode de conception, la carte analytique du schéma, et la connaissance de la stack
graphique du module.

## Frontières

| Sujet | Skill |
|---|---|
| QUOI montrer, COMMENT le visualiser, prototype | **report-designer** (ici) |
| Câbler la RPC, le hook, PDF/CSV, drill-down | `reports-exports` |
| Diagnostiquer un rapport existant cassé/inexact | `report-audit` |
| Règles génériques de data-viz (palette, formes, a11y) | [Consignes « Choisir le graphique »](workflow.md) |
| Migration SQL de la RPC de rapport | `db-migrations` |

Les deux skills reports se composent : report-designer produit la spec analytique
(métriques + graphiques + maquette validée), reports-exports la câble.

---
