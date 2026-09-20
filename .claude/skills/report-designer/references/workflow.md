# report-designer — méthode ciblée

Complément de [SKILL.md](../SKILL.md). Lire les sections nécessaires au parcours indiqué dans l’entrée ; les contrôles applicables restent obligatoires. Les relevés datés sont des points de départ à recouper, pas une certification du code actuel. Les chemins de code sont relatifs au dépôt ; les chemins nus `references/` désignent le dossier du skill. Les liens Markdown sont relatifs à ce fichier.

## Repères

- Workflow en 5 étapes
- Choisir les KPIs
- Choisir le graphique — la stack existante d'abord
- Cas type — gap analysis (« il manque des rapports sur X »)

## Workflow en 5 étapes

### 1. Cadrage
Question métier, décision supportée, audience (manager ? comptable ? production ?),
période et granularité naturelles (jour ? semaine ? par fournisseur ?).

### 2. État des lieux — ne jamais doublonner
Inventorier ce qui existe avant de concevoir :
```
rg -n -F "supabase.rpc(" apps/backoffice/src/features/reports/hooks/
```
et la liste des pages dans `apps/backoffice/src/pages/reports/`. Si un rapport voisin
existe, la bonne réponse est parfois de l'ENRICHIR (une colonne, un graphique, un KPI)
plutôt que d'en créer un nouveau — proposer les deux options à Mamat avec un avis.

### 3. Ancrage données — le schéma réel, les données réelles
Explorer via MCP `execute_sql` sur la base dev (`ikcyvlovptebroadgtvd`), **SELECT
uniquement** — la base est partagée, aucune écriture, jamais. Lire
`references/schema-analytics-map.md` pour la carte des tables par domaine, puis :

- **Vérifier les colonnes réelles** avant de concevoir (`information_schema.columns`
  ou un `SELECT * … LIMIT 3`) — ne jamais supposer un nom de colonne.
- **Volumes et distributions** : `COUNT(*)`, min/max de dates, cardinalité des
  dimensions. La dev a des volumes faibles — concevoir pour la FORME des données
  (croissance, saisonnalité, concentration), pas pour les quelques lignes visibles.
- **Pièges** (détail dans la carte) : fuseau session `Asia/Makassar` (`::date` rend
  déjà le bon jour métier) ; ventes = statuts payés (vérifier le filtre de la RPC de
  référence du moment, les versions bumpent) ; le MCP contourne la RLS — ce que tu
  vois n'est pas ce que l'app verra.

### 4. Conception + prototype — validation AVANT le code
Choisir KPIs et graphiques (voir les deux sections suivantes), puis produire un
**prototype HTML alimenté par les vraies données dev** (Artifact ou fichier envoyé à
Mamat) : KpiBand simulée, graphiques proposés avec les vrais chiffres, table d'exemple.
Appliquer les consignes de choix des graphiques ci-dessous, et reprendre le
langage visuel du module (couleurs de `chartColors.ts`, comparaison en pointillé pâle).

**Mamat valide la maquette avant toute implémentation** — c'est la méthodologie
variantes-avant-implémentation du projet, et ça coûte dix fois moins cher de jeter
une maquette qu'une page câblée.

### 5. Implémentation — handoff outillé
Une fois validé : la spec analytique (métriques, agrégations SQL, choix de graphiques)
part vers `reports-exports` pour le câblage (RPC via `db-migrations`, hook TanStack
Query, page ReportShell, ExportMenu). Ce skill reste dans la boucle pour
vérifier que l'implémentation rend fidèlement la maquette validée.

---

## Choisir les KPIs

3 à 5, jamais plus — c'est une bande, pas un tableau de bord. Si un 6ᵉ indicateur
semble indispensable, c'est qu'un des cinq ne l'est pas : trancher, ou le descendre
dans un graphique/la table. Pour chacun :

- **Un niveau + une direction** : la valeur de la période ET son delta vs la période
  de comparaison (`DeltaPct` existe pour ça). Un chiffre seul ne dit pas s'il est bon.
  Seule exception : une métrique **instantanée** (encours, passif, position de stock)
  n'a pas de delta de période — elle porte alors une étiquette explicite « snapshot ».
- **Actionnable** : si aucune décision ne change quand le chiffre bouge, ce n'est pas
  un KPI de ce rapport.
- **Cohérent avec la table** : le total de la bande doit se recalculer depuis les
  lignes affichées (même filtre, même période) — un écart détruit la confiance.

## Choisir le graphique — la stack existante d'abord

Le module a déjà une bibliothèque cohérente (`features/reports/components/charts/`).
**Réutiliser avant d'inventer** : quand une forme existe, la spec NOMME le composant
(reprendre les couleurs ne suffit pas — proposer de reconstruire une heatmap alors
que `HeatmapGrid` existe est un échec de conception). Ne créer un nouveau composant
que si aucune forme existante ne porte la donnée, et alors le concevoir réutilisable
et conforme aux consignes graphiques de ce skill.

| Forme de la donnée | Composant | Exemple |
|---|---|---|
| Évolution dans le temps (+ comparaison) | `TrendLineChart` | CA journalier, prix d'achat d'un article |
| Série d'événements datés (peu de points) | `TrendLineChart` `dots` | versions de recette, changements de prix |
| Classement + concentration (80/20) | `ParetoChart` | top produits, top fournisseurs |
| Composition qui évolue | `StackedBarsChart` | CA par catégorie par semaine |
| Deux mesures côte à côte par catégorie | `PairedBarsChart` | budget vs réel, période N vs N-1 |
| Intensité sur deux dimensions | `HeatmapGrid` | ventes heure × jour |
| Ventilation simple, peu de catégories | `BreakdownCard` | paiements par méthode |

Règles du langage visuel (gravées dans `chartColors.ts`, ne pas les contourner) :

- **Toute couleur vient de `chartColors.ts`** — seul endroit où le thème est recopié
  côté Recharts. Jamais de hex ad-hoc dans une page.
- **Deux familles de coût** : COGS/achats = bleus, OpEx = ambres — constant sur tous
  les graphes de coût. Séries catégorielles génériques → `CATEGORICAL_SERIES`.
- **L'or (accent) n'est jamais une série ; vert/rouge = vocabulaire d'état** (bon/
  mauvais), jamais une identité de catégorie.
- **Chaque graphe porte sa comparaison** : série précédente en pointillé
  `CHART_SERIES_OFF` (ligne) ou `CHART_SERIES_COMPARE` (barres), jamais de points.
- **Montants IDR** : `formatIdrCompact` (axes) / `formatIdrFull` (tooltips) /
  `formatIdrPrecise` (coûts unitaires où les décimales portent du sens).
- Un graphe reste lisible sans son tooltip : étiquettes directes + table en dessous.

---

## Cas type — gap analysis (« il manque des rapports sur X »)

1. Lister l'existant du domaine (étape 2) et la donnée disponible (étape 3), puis
   confronter au catalogue cible de Mamat :
   `references/report-catalog-benchmark.md` — la liste des rapports attendus par
   domaine. Un rapport du catalogue absent du module est un candidat ; il ne
   devient une proposition que si le schéma porte la donnée.
2. Nommer le TROU précisément : ce que la donnée sait dire que le module ne montre
   pas. Ex. achats (constat 2026-08-16) : `get_purchase_by_date` / `by_supplier` /
   `purchase_items` existent, mais ni l'évolution du prix d'achat unitaire par
   article/fournisseur ni l'analyse des quantités achetées dans le temps.
3. Proposer 1 à 3 rapports candidats, chacun avec sa question métier, ses KPIs, ses
   graphiques — et un ordre de priorité argumenté.
4. Maquetter le premier avec les vraies données ; Mamat arbitre.

---
