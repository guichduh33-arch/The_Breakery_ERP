# pos-design-craft — méthode ciblée

Complément de [SKILL.md](../SKILL.md). Lire les sections nécessaires au parcours indiqué dans l’entrée ; les contrôles applicables restent obligatoires. Les relevés datés sont des points de départ à recouper, pas une certification du code actuel. Les chemins de code sont relatifs au dépôt ; les chemins nus `references/` désignent le dossier du skill. Les liens Markdown sont relatifs à ce fichier.

## Repères

- Checklist de conception (definition of done d'un livrable)

## Checklist de conception (definition of done d'un livrable)

| ✓ | Critère |
|---|---------|
| ☐ | Versions package.json vérifiées, patterns du bon chemin (actuel vs cible) |
| ☐ | Cibles : rush 56-72 px, plancher 44/48 px, espacement ≥ 8 px — mesures annoncées |
| ☐ | Compte de taps du flux annoncé (et comparé à l'existant si refonte) |
| ☐ | Contraste : AAA sur chiffres, AA partout — **mesuré dans le navigateur** (protocole Playwright), pas estimé |
| ☐ | Cibles/espacements **mesurés** au `getBoundingClientRect` sur le rendu réel + screenshots des variantes joints |
| ☐ | Feedback < 100 ms sur chaque interaction (pressed + optimistic + toast undo) |
| ☐ | Chiffres en tabular-nums ; total = élément dominant |
| ☐ | Tokens : zéro hex en dur, OKLCH pour le neuf, cascade `@breakery/ui` respectée |
| ☐ | États réseau dégradé designés (pending/failed visibles, pas d'UI muette) |
| ☐ | Destructif hors zone de réflexe + confirmation seulement si irréversible |
| ☐ | `prefers-reduced-motion` respecté ; aucune animation décorative money-path |
| ☐ | Profil précisé (CAISSE/WAITER/les deux) et densité adaptée |
| ☐ | Chaque choix justifié par un principe (Fitts, contraste, densité, tolérance erreur) |

**Format de sortie** : rapport en français ; livrable = code `.tsx`/tokens CSS **ou** spec de design chiffrée selon la demande ; profondeur adaptée au scope (un token isolé ne déclenche pas une refonte).

---
