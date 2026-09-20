---
name: report-designer
description: >-
  Concevoir ou enrichir un rapport BO Breakery : question métier, KPIs, dimensions, graphique et prototype fondé sur les données dev. Maquette à valider avant implémentation. Rapport inexact : report-audit ; câblage : reports-exports.
---

# Report Designer — The Breakery ERP

Formuler la décision que le rapport doit aider à prendre, vérifier l’existant et la donnée, puis concevoir. Lire la carte analytique avant la requête ; faire valider le prototype avant le câblage.

## Lecture proportionnée

Les règles d’AGENTS.md restent applicables. Les liens ci-dessous sont conditionnels : ne pas charger tout le dossier ni tous les skills voisins. Réutiliser les lectures déjà faites dans la session ; rouvrir si le code ou le périmètre a changé.

| Quand lire | Ressource |
|---|---|
| Pour le contrat, le parcours ou la surface concernée ; avant toute modification de sa logique. | [modèle, contrats et repères](references/model.md) |
| Pour conduire la conception, le diagnostic ou le conseil demandé ; lire seulement le cas correspondant. | [méthode ciblée](references/workflow.md) |
| Avant une modification et avant de conclure : sélectionner les contrôles du parcours, puis exécuter les tests requis par AGENTS.md. | [contrôles et sources](references/verification.md) |

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

## Qualité de restitution

Répondre d’abord au problème demandé. Distinguer fait observé, intention métier et hypothèse ; ancrer les constats dans le code lu ou le résultat mesuré. Un ancien relevé n’est pas une preuve actuelle. Donner impact, correction ou décision attendue, vérification effectuée et limite éventuelle ; ne pas remplir des rubriques sans résultat utile. Une consigne de skill n’élargit pas l’autorisation donnée par Mamat.
