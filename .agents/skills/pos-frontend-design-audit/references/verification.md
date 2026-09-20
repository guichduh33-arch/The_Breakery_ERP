# pos-frontend-design-audit — contrôles et sources

Complément de [SKILL.md](../SKILL.md). Lire les sections nécessaires au parcours indiqué dans l’entrée ; les contrôles applicables restent obligatoires. Les relevés datés sont des points de départ à recouper, pas une certification du code actuel. Les chemins de code sont relatifs au dépôt ; les chemins nus `references/` désignent le dossier du skill. Les liens Markdown sont relatifs à ce fichier.

## Repères

- Fichiers de référence (à lire selon le besoin)
- Vérification avant de conclure

## Fichiers de référence (à lire selon le besoin)

- `references/screen-map.md` — **photo datée écran → fichier/composant** (routes, shells, layouts, états). À lire en Étape 2 pour aller droit au code. **Elle vieillit ; le code non** — toute dimension ou grille qu'elle cite se relit dans le fichier.
- `references/design-rubric.md` — **grille de critères + seuils concrets** (cibles tactiles px, budget de taps, contraste, échelle de maturité 1-5). À lire en Étape 3.
- `references/market-leaders.md` — **cheat-sheet des patterns** des leaders POS restaurant par écran. À lire en Étape 4.

## Vérification avant de conclure

- Chaque constat cite un **fichier réellement ouvert**, en `fichier:ligne` + l'ancre stable qui le porte (classe, libellé, bloc).
- Aucun constat ne porte sur un composant sans importeur, ni sur un chemin que tu n'as pas confirmé.
- Aucun constat ne rejoue un **arbitrage gravé**.
- Les **dérives de la carte des écrans** rencontrées pendant l'audit sont signalées en fin de rapport (chemin annoncé → chemin réel), pour recorrection hors session.
- Chaque écran du périmètre a un score de maturité et au moins un constat ou un « RAS ».
- Le rapport est rendu **en conversation**, en entier — aucun fichier créé, aucun chemin annoncé.
- Le **résidu durable est proposé** (Étape 6) : lignes de backlog + fiche `docs/objectifs/` cible, et le cas échéant la décision qui mérite un ADR.
- Les propositions CAISSE et WAITER sont séparées et au format ticket.
- Rien dans le rapport n'empiète sur `pos-flow-audit` (plomberie) ou `security-fraud-guard` (RBAC) sans renvoi explicite.
