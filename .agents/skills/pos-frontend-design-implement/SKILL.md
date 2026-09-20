---
name: pos-frontend-design-implement
description: >-
  Appliquer une recommandation de design POS Breakery choisie par Mamat, issue d’un audit ou d’une demande directe précise. Préserver tokens, états, accessibilité et profils caisse/tablette. Création non cadrée : pos-design-craft.
---

# POS Frontend Design Implement — The Breakery

Retrouver la proposition et l’autorisation dans la session. Une demande directe suffisamment précise vaut cadrage ; ne pas exiger un audit supplémentaire. Ne pas inventer une validation absente.

## Lecture proportionnée

Les règles d’AGENTS.md restent applicables. Les liens ci-dessous sont conditionnels : ne pas charger tout le dossier ni tous les skills voisins. Réutiliser les lectures déjà faites dans la session ; rouvrir si le code ou le périmètre a changé.

| Quand lire | Ressource |
|---|---|
| Pour le contrat, le parcours ou la surface concernée ; avant toute modification de sa logique. | [modèle, contrats et repères](references/model.md) |
| Pour conduire la conception, le diagnostic ou le conseil demandé ; lire seulement le cas correspondant. | [méthode ciblée](references/workflow.md) |
| Avant une modification et avant de conclure : sélectionner les contrôles du parcours, puis exécuter les tests requis par AGENTS.md. | [contrôles et sources](references/verification.md) |

## Garde-fous

- **N'invente pas de design.** Tu exécutes une proposition validée. Si elle est ambiguë, demande/relis l'audit ; ne « complète » pas avec un parti pris non discuté.
- **Tokens et primitifs only.** Toute couleur en dur ou tout primitif inexistant = build cassé ou dette — vérifie avant d'écrire.
- **Deux profils, toujours.** Un changement sur un composant partagé doit être jugé pour CAISSE *et* WAITER. Un gain desktop ne doit pas dégrader la tablette debout. Les deux tournent le **même code web Vite** : la CAISSE dans un navigateur plein écran (aucune coque native), le WAITER dans une coque **Capacitor Android** (ADR-029). Aucune API native ne se suppose disponible sans l'avoir vérifiée.
- **Aspect, pas plomberie.** Tu changes l'apparence/manipulation. Tu ne réécris pas la logique commande→paiement pour faire joli — ça appartient à `pos-flow-audit`.
- **Pas de fichier hors structure** (règle AGENTS.md) : code dans `apps/pos/src/...`, tests co-localisés en `__tests__/`.

## Qualité de restitution

Répondre d’abord au problème demandé. Distinguer fait observé, intention métier et hypothèse ; ancrer les constats dans le code lu ou le résultat mesuré. Un ancien relevé n’est pas une preuve actuelle. Donner impact, correction ou décision attendue, vérification effectuée et limite éventuelle ; ne pas remplir des rubriques sans résultat utile. Une consigne de skill n’élargit pas l’autorisation donnée par Mamat.
