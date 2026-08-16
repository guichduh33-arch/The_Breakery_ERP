---
name: report-designer
description: >-
  Concepteur analytique de rapports — décide QUOI montrer et COMMENT le visualiser quand on
  crée ou améliore un rapport du module reports (apps/backoffice). Choisit les métriques et
  dimensions pertinentes depuis le schéma réel, valide contre les données de la base dev,
  conçoit des graphiques de qualité avec la stack Recharts existante, et livre un prototype
  HTML validé par Mamat AVANT toute implémentation. Use this skill whenever the task is to
  design / concevoir / imaginer / proposer a NEW report, add analytics to an existing one,
  choose KPIs / métriques / indicateurs, pick or improve a chart / graphique / visualisation,
  do a gap analysis (« il manque un rapport sur… », « quels rapports manquent ? »), analyze
  quantités achetées, évolution des prix, tendances, marges, top produits, saisonnalité — or
  any « quel graphique pour… » question. Boundary: THIS skill owns analytical pertinence and
  chart design; the wiring (RPC, hook, PDF, CSV, drill-down mechanics) → reports-exports;
  diagnosing a BROKEN existing report → report-audit; generic chart craft rules (palettes,
  accessibility) → dataviz, que ce skill applique. Invoke it BEFORE sketching any new report
  or picking any chart type.
pathPatterns:
  - 'apps/backoffice/src/features/reports/components/charts/**'
  - 'apps/backoffice/src/features/reports/utils/chartColors.ts'
  - 'apps/backoffice/src/features/reports/components/KpiBand.tsx'
  - 'apps/backoffice/src/features/reports/components/BreakdownCard.tsx'
promptSignals:
  phrases:
    - 'concevoir un rapport'
    - 'nouveau rapport'
    - 'il manque un rapport'
    - 'quel graphique'
    - 'quels KPIs'
    - 'métriques'
    - 'visualisation'
    - 'chart'
    - 'graphique de qualité'
    - 'évolution des prix'
    - 'quantité achetée'
    - 'gap analysis'
    - 'top produits'
    - 'tendance'
    - 'saisonnalité'
---

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
| Règles génériques de data-viz (palette, formes, a11y) | `dataviz` — **à charger avant tout graphique** |
| Migration SQL de la RPC de rapport | `db-migrations` |

Les deux skills reports se composent : report-designer produit la spec analytique
(métriques + graphiques + maquette validée), reports-exports la câble.

---

## Mental model — un rapport répond à UNE question

Un rapport n'est pas « des données affichées » : c'est une **décision outillée**.
Avant toute conception, formuler en une phrase : *quelle question métier ce rapport
permet-il de trancher, et pour qui ?* (« Dois-je renégocier avec ce fournisseur ? » →
évolution des prix d'achat. « Quoi produire demain matin ? » → ventes par heure/jour.)
Si la question n'est pas claire, **demander à Mamat — ne pas inventer** (règle 6).

L'archétype du module (Report shell v2) a trois étages, du plus dense au plus fin :

```
KpiBand          → l'ÉTAT : 3-5 chiffres qui répondent à la question en un regard
Graphiques       → la STRUCTURE : tendance, concentration, composition, saisonnalité
Table triable    → le DÉTAIL : chaque ligne, export CSV/PDF, drill-down vers l'entité
```

Chaque étage doit mériter sa place. Un KPI sans décision derrière est du bruit ;
un graphique qui répète la table est de la décoration.

---

## Workflow en 5 étapes

### 1. Cadrage
Question métier, décision supportée, audience (manager ? comptable ? production ?),
période et granularité naturelles (jour ? semaine ? par fournisseur ?).

### 2. État des lieux — ne jamais doublonner
Inventorier ce qui existe avant de concevoir :
```
grep "supabase.rpc(" apps/backoffice/src/features/reports/hooks/
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
Charger `dataviz` avant d'écrire le premier graphique du prototype, et reprendre le
langage visuel du module (couleurs de `chartColors.ts`, comparaison en pointillé pâle).

**Mamat valide la maquette avant toute implémentation** — c'est la méthodologie
variantes-avant-implémentation du projet, et ça coûte dix fois moins cher de jeter
une maquette qu'une page câblée.

### 5. Implémentation — handoff outillé
Une fois validé : la spec analytique (métriques, agrégations SQL, choix de graphiques)
part vers `reports-exports` pour le câblage (RPC via `db-migrations`, hook TanStack
Query, page Report shell v2, ExportButtons). Ce skill reste dans la boucle pour
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

## Intégrité des chiffres — un rapport faux est pire que pas de rapport

Trois disciplines, nées de vraies dérives observées :

- **Les constantes métier viennent du code, jamais des données.** Taux de fidélité,
  seuils de palier, taux de taxe, barèmes : la source est `packages/domain` (ou
  `business_config`), pas une régression sur l'échantillon dev. Déduire un taux de
  16 lignes de fixtures produit un chiffre plausible et faux — citer le fichier de
  constante à côté de la valeur utilisée.
- **La maquette se recoupe elle-même.** Avant de livrer : chaque série de graphique
  somme exactement au KPI qu'elle illustre, la table recoupe la bande, les
  pourcentages somment à 100. Un lecteur qui trouve UNE incohérence jettera tout le
  rapport — recompter mécaniquement (petit script), pas à l'œil.
- **Chaque chiffre réel est re-vérifiable.** Un chiffre présenté comme issu de la
  base est accompagné de la requête SQL exécutée (dans la spec) ; un comptage se
  recompte avant publication. Ce qui n'est pas re-vérifiable est marqué synthétique.

---

## Choisir le graphique — la stack existante d'abord

Le module a déjà une bibliothèque cohérente (`features/reports/components/charts/`).
**Réutiliser avant d'inventer** : quand une forme existe, la spec NOMME le composant
(reprendre les couleurs ne suffit pas — proposer de reconstruire une heatmap alors
que `HeatmapGrid` existe est un échec de conception). Ne créer un nouveau composant
que si aucune forme existante ne porte la donnée, et alors le concevoir réutilisable
et conforme à `dataviz`.

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

## Références

- `references/schema-analytics-map.md` — carte analytique des tables par domaine
  (ventes, achats, stock, production, finance, clients) avec les pièges de lecture.
  À lire à l'étape 3 avant d'écrire la première requête.
- `references/report-catalog-benchmark.md` — catalogue cible des rapports attendus
  par Mamat, organisé par domaine. À confronter à l'existant dans toute gap
  analysis (étape 2 / cas type ci-dessus).
