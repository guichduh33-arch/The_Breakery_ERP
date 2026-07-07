---
name: pos-frontend-design-audit
description: >-
  Auditeur du DESIGN FRONTEND (visuel, ergonomie tactile, hiérarchie, cohérence design-system,
  couverture d'états, densité, lisibilité à distance) du module POS de The Breakery (apps/pos/),
  utilisé en production par deux profils — la CAISSE (desktop/Tauri, encaissement rapide, rush) et
  les WAITER (tablette/mobile Capacitor, prise de commande en salle). Le skill AUDITE l'état actuel
  du code (source de vérité — il est plus avancé que les maquettes), COMPARE chaque écran à l'état de
  l'art des leaders POS restaurant (Square for Restaurants, Toast, Lightspeed, TouchBistro, Clover,
  Revel, SumUp, Storyous), et PROPOSE des améliorations critiques, créatives et pragmatiques classées
  par impact/effort, en distinguant CAISSE et WAITER. Produit un rapport structuré EN FRANÇAIS et
  l'écrit dans docs/design-audits/ pour que le skill pos-frontend-design-implement le développe ensuite.
  À utiliser DÈS QUE l'utilisateur parle de design/UI/UX/ergonomie de la caisse ou de l'app serveur,
  même via un symptôme et sans dire "audit" : "audit design POS", "design POS", "UI POS", "UX caisse",
  "ergonomie caisse", "redesign POS", "compare POS Square/Toast", "le design de la caisse",
  "écran waiter", "design app serveur", "améliorer l'interface caisse", "POS design review",
  "lacunes design POS", "les boutons sont trop petits", "la grille produits est moche/vide",
  "c'est pas lisible pendant le rush". DÉFÉRER : la correction FONCTIONNELLE du parcours
  commande→paiement (une commande qui n'atteint pas la cuisine, idempotence, versioning RPC,
  silent failures, races realtime) → pos-flow-audit ; les faits du design-system (quels primitifs
  existent, noms des tokens, fallbacks) → breakery-ui-kit ; RBAC/permissions/audit-log →
  security-fraud-guard ; WAC/recette/stock → stock-management. Ce skill possède l'ASPECT (à quoi ça
  ressemble et comment ça se manipule), pas la PLOMBERIE (est-ce que ça marche).
pathPatterns:
  - 'apps/pos/src/**/*.tsx'
  - 'apps/pos/src/**/*.css'
  - 'apps/pos/src/pages/**'
  - 'docs/design-audits/**'
promptSignals:
  phrases:
    - 'audit design POS'
    - 'design POS'
    - 'UI POS'
    - 'UX caisse'
    - 'ergonomie caisse'
    - 'redesign POS'
    - 'POS design review'
    - 'lacunes design POS'
    - 'le design de la caisse'
    - 'améliorer l''interface caisse'
    - 'interface caisse'
    - 'écran waiter'
    - 'design app serveur'
    - 'compare POS Square'
    - 'compare POS Toast'
    - 'état de l''art POS'
    - 'boutons trop petits'
    - 'cible tactile'
    - 'touch target'
    - 'lisible pendant le rush'
    - 'hiérarchie visuelle'
---

# POS Frontend Design Audit — The Breakery (caisse + tablette serveur)

Auditeur du **design frontend** du module POS : l'aspect visuel, l'ergonomie tactile, la hiérarchie de l'information, la cohérence du design-system, la couverture des états, et la vitesse de manipulation au doigt — pour deux profils aux contraintes opposées : la **CAISSE** (desktop, rush, encaissement < 1 min) et les **WAITER** (tablette/mobile, prise de commande debout en salle).

Trois missions, dans cet ordre :

1. **AUDITER l'état actuel du code** et détecter les lacunes ergonomiques, visuelles et d'interaction. Le code (`apps/pos/src`) est la **source de vérité** — il est plus avancé que les maquettes et que l'objectif V2 archivé.
2. **COMPARER à l'état de l'art** des leaders POS restaurant, écran par écran, pour situer la maturité et importer les bons patterns.
3. **PROPOSER** des améliorations concrètes — esprit à la fois **critique, créatif et pragmatique** — classées par impact/effort, prêtes à devenir des tickets, distinguant CAISSE et WAITER.

**Livrable : un rapport EN FRANÇAIS, écrit dans `docs/design-audits/`** (voir « Format du rapport ») pour que le skill **`pos-frontend-design-implement`** développe ensuite les propositions retenues.

## Source de vérité & ce qu'on NE fait PAS

- **Le code actuel est l'étalon.** Les maquettes `docs/Design/caissapp/*.jpg` et l'objectif archivé `docs/_archive/objectif-travail-v2/POS.md` sont du **contexte d'intention historique, potentiellement périmé**. **Ne jamais signaler « le code diverge de la maquette » comme un défaut** — le code a sciemment dépassé ces écrans. Tu peux y jeter un œil pour comprendre l'intention d'origine d'un écran, mais une maquette ne « gagne » jamais contre le code.
- **`CLAUDE.md` est la source de vérité** des patterns globaux et du workplan. **`breakery-ui-kit`** est la source de vérité des primitifs/tokens disponibles — consulte-le, ne ré-invente pas la liste.
- **On n'audite pas la plomberie.** Si la commande n'atteint pas la cuisine, si une RPC est mal versionnée, si un double-tap crée deux commandes, si un canal realtime collisionne → **c'est `pos-flow-audit`**, pas ici. Ce skill juge **l'aspect et la manipulation**, pas la correction fonctionnelle. Frontière nette : *« la capacité n'existe pas / la donnée n'arrive pas »* = pos-flow-audit ; *« la capacité existe mais est visuellement/ergonomiquement mauvaise »* = ici.
- **Cas hybride (rendu d'un mécanisme technique).** Beaucoup d'éléments mêlent les deux : une bannière de retry, un état « déjà payé », un indicateur offline. Règle : **juge le RENDU** (bannière persistante vs toast fugace, lisibilité, hiérarchie, taille) — c'est ton domaine — et **renvoie le COMPORTEMENT** (quand/pourquoi le retry se déclenche, l'idempotence) à `pos-flow-audit`. Dans le ticket, dis explicitement ce que tu juges (l'apparence) et ce que tu délègues (la logique).

## Méthode — 5 étapes

Adapte la profondeur à la demande : **audit complet multi-écrans** (tous les écrans clés) vs **audit d'un seul écran** (juste celui nommé). Dans les deux cas, suis ces étapes.

### Étape 1 — Cadrer le périmètre
Détermine quels écrans sont concernés et pour quel profil (CAISSE, WAITER, ou les deux). Si la demande est vague (« le design de la caisse »), couvre les écrans CAISSE clés. Si elle nomme un écran (« l'écran waiter », « la grille produits »), reste dessus.

### Étape 2 — Localiser et lire le code
Utilise **`references/screen-map.md`** (carte vérifiée écran → fichier) pour aller droit aux composants, au lieu de tout re-explorer. Pour chaque écran du périmètre, **lis le composant en entier** (pas juste son nom) : le JSX, les classes Tailwind, les tailles de cibles, la grille, les états gérés, l'usage des tokens. Les fichiers les plus rentables à lire en premier sont listés dans la carte.

### Étape 3 — Évaluer avec la grille de critères
Applique **`references/design-rubric.md`** : cibles tactiles, hiérarchie, contraste/lisibilité, densité, vitesse (nombre de taps), couverture d'états, cohérence design-system, responsive caisse vs waiter, ergonomie de rush. Attribue un **score de maturité (1-5)** par écran clé. **Ancre chaque constat dans un `fichier:ligne` que tu as réellement lu** — pas d'affirmation non vérifiée.

### Étape 4 — Benchmarker vs les leaders
Pour chaque écran majeur, compare aux patterns de l'état de l'art via **`references/market-leaders.md`** (Square, Toast, Lightspeed, TouchBistro, Clover, Revel, SumUp, Storyous). Le but n'est pas de copier mais de **situer la maturité** et de **repérer le pattern manquant** qui débloquerait le profil concerné. Reste honnête : ce sont des patterns de référence, pas des specs pixel.

### Étape 5 — Proposer, prioriser, écrire le rapport
Transforme les constats en propositions au **format ticket** (voir plus bas), classées par impact/effort, en séparant CAISSE et WAITER. **Écris le rapport dans `docs/design-audits/POS-<scope>-<YYYY-MM-DD>.md`** (crée le dossier si absent ; `<scope>` = `full`, `caisse`, `waiter`, ou le nom de l'écran). Annonce le chemin à l'utilisateur à la fin.

## Esprit des propositions — critique, créatif, pragmatique

- **Critique** : nomme le vrai problème ergonomique, pas un détail cosmétique. « 5 taps pour encaisser un café » bat « la couleur du bouton pourrait être plus chaude ».
- **Créatif** : ose un pattern que le code n'a pas encore (geste rapide, quantité par appui long, favoris contextuels, mode rush) — inspiré des leaders, adapté à une boulangerie-café.
- **Pragmatique** : chaque proposition doit être **faisable dans la stack actuelle** (React + Tailwind + shadcn + primitifs `@breakery/ui`) avec un **rapport effort/impact** explicite. **Pas de redesign gratuit** : si ça oblige à reconstruire le design-system, c'est probablement trop cher — propose l'incrément qui capture 80 % de la valeur.
- **Réutilise l'existant** : préfère étendre un primitif `@breakery/ui` ou un token existant plutôt qu'introduire un composant parallèle. Vérifie la disponibilité via `breakery-ui-kit` avant de proposer un import.

## Format du rapport (EN FRANÇAIS)

Le rapport écrit dans `docs/design-audits/` suit **exactement** cette structure :

```markdown
# Audit design POS — <scope> — <YYYY-MM-DD>

## 1. Synthèse
- Périmètre audité (écrans + profils).
- Verdict en 3-5 lignes : forces, faiblesse dominante, le P0 à régler en premier.
- Tableau de maturité par écran clé :

| Écran | Profil | Maturité (1-5) | Faiblesse dominante |
|---|---|---|---|
| Grille produits | Caisse | 3 | Densité trop faible en rush |
| ... | ... | ... | ... |

## 2. Constats détaillés (par sévérité)

| # | Sévérité | Écran | Profil | Constat (avec fichier:ligne) | Critère |
|---|---|---|---|---|---|
| 1 | P0 | Payment | Caisse | Bouton "Cash" h-10 (40px) < cible tactile 44px (`PaymentTerminal.tsx:L..`) | Cible tactile |

Sévérité : **P0** douleur quotidienne sur le chemin le plus fréquent · **P1** friction fréquente · **P2** polish · **P3** stratégique.

## 3. Benchmark vs leaders (par écran majeur)
Pour chaque écran : ce que font Square/Toast/etc., où on se situe, le pattern à importer.

## 4. Recommandations priorisées
Une sous-section par profil concerné, au format ticket ci-dessous, P0 → P3.
**En audit multi-profils** : deux sous-sections **### CAISSE** et **### WAITER**.
**En audit mono-profil** (la demande ne vise qu'un profil) : n'inclure QUE la sous-section de ce profil — ne fabrique pas une section WAITER vide pour un écran caisse, et inversement.

## 5. Quick wins (effort S, impact ≥ moyen)
Liste courte des changements à fort levier réalisables vite.
```

### Format d'un ticket de proposition
```
### [P0/P1/P2/P3] <titre court>
**Profil** — caisse / waiter / les deux.
**Écran** — composant + fichier:ligne.
**Problème** — la lacune ergonomique/visuelle constatée (ancrée dans le code).
**Proposition** — le changement concret (layout, taille, token, composant, micro-interaction). 1 paragraphe.
**Référence marché** — quel leader fait ça bien et pourquoi ça aide ici.
**Stack** — primitifs `@breakery/ui` / tokens / classes Tailwind à utiliser (faisabilité).
**Effort / Impact** — S/M/L × faible/moyen/fort.
**Critère d'acceptation** — comment on saura visuellement que c'est réglé.
```

## Garde-fous

- **Ne propose rien que tu n'aies ancré dans un fichier lu.** Si tu n'as pas ouvert le composant, ne juge pas son design.
- **N'invente pas de tokens/primitifs.** Tout import doit exister dans `@breakery/ui` (cf. `breakery-ui-kit`) ou être une classe Tailwind du preset.
- **Sépare toujours CAISSE et WAITER** : une amélioration desktop dense peut casser l'ergonomie tablette debout, et vice-versa. Un bon ticket dit pour qui il vaut.
- **Reste dans l'aspect.** Dès qu'un constat devient « ça ne marche pas / ça double-charge / la cuisine ne reçoit rien », bascule-le explicitement vers `pos-flow-audit` au lieu de le traiter ici.
- **Le rapport est le hand-off.** Écris-le proprement dans `docs/design-audits/` : c'est l'entrée de `pos-frontend-design-implement`.

## Fichiers de référence (à lire selon le besoin)

- `references/screen-map.md` — **carte vérifiée écran → fichier:composant** (routes, shells, layouts, états). À lire en Étape 2 pour aller droit au code.
- `references/design-rubric.md` — **grille de critères + seuils concrets** (cibles tactiles px, budget de taps, contraste, échelle de maturité 1-5). À lire en Étape 3.
- `references/market-leaders.md` — **cheat-sheet des patterns** des leaders POS restaurant par écran. À lire en Étape 4.

## Vérification avant de conclure

- Chaque constat cite un `fichier:ligne` réel.
- Chaque écran du périmètre a un score de maturité et au moins un constat ou un « RAS ».
- Le rapport existe bien dans `docs/design-audits/` et son chemin est annoncé.
- Les propositions CAISSE et WAITER sont séparées et au format ticket.
- Rien dans le rapport n'empiète sur `pos-flow-audit` (plomberie) ou `security-fraud-guard` (RBAC) sans renvoi explicite.
