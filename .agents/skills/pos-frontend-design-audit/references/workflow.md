# pos-frontend-design-audit — méthode ciblée

Complément de [SKILL.md](../SKILL.md). Lire les sections nécessaires au parcours indiqué dans l’entrée ; les contrôles applicables restent obligatoires. Les relevés datés sont des points de départ à recouper, pas une certification du code actuel. Les chemins de code sont relatifs au dépôt ; les chemins nus `references/` désignent le dossier du skill. Les liens Markdown sont relatifs à ce fichier.

## Repères

- Méthode — 6 étapes
- Esprit des propositions — critique, créatif, pragmatique
- Format du rapport (EN FRANÇAIS)

## Méthode — 6 étapes

Adapte la profondeur à la demande : **audit complet multi-écrans** (tous les écrans clés) vs **audit d'un seul écran** (juste celui nommé). Dans les deux cas, suis ces étapes.

### Étape 1 — Cadrer le périmètre
Détermine quels écrans sont concernés et pour quel profil (CAISSE, WAITER, ou les deux). Si la demande est vague (« le design de la caisse »), couvre les écrans CAISSE clés. Si elle nomme un écran (« l'écran waiter », « la grille produits »), reste dessus.

### Étape 2 — Localiser et lire le code
Utilise **`references/screen-map.md`** — une **photo datée** écran → fichier — pour aller droit aux composants au lieu de tout re-explorer. Elle t'ouvre la bonne porte ; elle ne te dit pas ce qu'il y a derrière.

Pour chaque écran du périmètre : **lis le composant en entier** (pas juste son nom) — le JSX, les classes Tailwind, les tailles de cibles, la grille, les états gérés, l'usage des tokens. Trois réflexes qui sauvent un audit d'une carte périmée :

- **Un chemin qui n'existe pas n'est pas une erreur d'audit, c'est une dérive de carte** : retrouve le composant vivant (par son nom, par son import depuis le shell ou la route) et note la dérive pour le rapport.
- **Suis les imports depuis la route.** Un conteneur (`PaymentTerminal`, `ProductGrid`, `TabletOrderPage`) délègue son rendu réel à des sous-composants ; juger le conteneur seul, c'est juger un fichier de câblage.
- **Vérifie qu'un composant a un importeur avant de le juger.** Le dépôt contient des fichiers sans site d'appel (la carte en nomme deux, relevés le 2026-08-31) : un constat posé dessus produit un correctif mort-né, invisible à l'écran.

Toute dimension, tout nombre de colonnes, toute hauteur cités dans la carte se **relisent dans le fichier** avant d'entrer dans un constat.

### Étape 3 — Évaluer avec la grille de critères
Applique **`references/design-rubric.md`** : cibles tactiles, hiérarchie, contraste/lisibilité, densité, vitesse (nombre de taps), couverture d'états, cohérence design-system, responsive caisse vs waiter, ergonomie de rush. Attribue un **score de maturité (1-5)** par écran clé.

**Ancre chaque constat sur ce que tu viens de lire** : `fichier:ligne` **plus** la chose exacte qui le porte (la classe Tailwind citée, le libellé, le nom du bloc). Ton rapport est un livrable de session, pas un document évergreen : AGENTS.md exige que les rapports de sous-agents citent `fichier:ligne`, et Mamat doit pouvoir sauter au bon endroit d'un clic. La ligne seule ne suffit pas — elle bouge à la première édition, alors que la classe citée reste vérifiable ; les deux ensemble sont précis ET recoupables.

(La règle inverse vaut pour les **fiches** de `references/` : une carte d'écrans est évergreen, elle s'ancre par chemin + classe, jamais par numéro de ligne.)

Puis applique le filtre anti-faux-positif « Arbitrages gravés » de [l’entrée du skill](../SKILL.md) avant d'écrire le constat.

### Étape 4 — Benchmarker vs les leaders
Pour chaque écran majeur, compare aux patterns de l'état de l'art via **`references/market-leaders.md`** (Square, Toast, Lightspeed, TouchBistro, Clover, Revel, SumUp, Storyous). Le but n'est pas de copier mais de **situer la maturité** et de **repérer le pattern manquant** qui débloquerait le profil concerné. Reste honnête : ce sont des patterns de référence, pas des specs pixel.

### Étape 5 — Proposer, prioriser, rendre le rapport
Transforme les constats en propositions au **format ticket** (voir plus bas), classées par impact/effort, en séparant CAISSE et WAITER. **Rends le rapport DANS LA CONVERSATION** : tu ne crées aucun fichier, tu n'annonces aucun chemin. Il est consommé dans la même session par `pos-frontend-design-implement`.

### Étape 6 — Proposer le résidu durable
Le rapport est un **artefact intermédiaire** : c'est l'échafaudage du raisonnement, il meurt avec la session. Ce qui doit survivre a **déjà** un domicile gouverné. Termine toujours en **proposant**, explicitement :

- **les tickets non implémentés → backlog d'une fiche `docs/objectifs/`** : nomme la fiche (`POS.md`, `ORDERS.md`, `KDS.md`, `CUSTOMER_DISPLAY.md`, `TABLET_ORDERING.md`, `CASH_REGISTER.md`…) et rédige les lignes telles qu'elles doivent y figurer, avec le marqueur de priorité que ces fiches portent déjà (🔴🟠🟡🟢) ;
- **une décision de design arbitrée → un ADR**, si l'audit en a produit une — un arbitrage de fond, pas une préférence ;
- **une intention de design → la fiche objectif** du module concerné.

Tu **proposes** la rédaction en conversation. **Mamat écrit et commite** : tu ne crées ni ne modifies aucun fichier de `docs/` (règle 1 de `AGENTS.md`).

## Esprit des propositions — critique, créatif, pragmatique

- **Critique** : nomme le vrai problème ergonomique, pas un détail cosmétique. « 5 taps pour encaisser un café » bat « la couleur du bouton pourrait être plus chaude ».
- **Créatif** : ose un pattern que le code n'a pas encore (geste rapide, quantité par appui long, favoris contextuels, mode rush) — inspiré des leaders, adapté à une boulangerie-café.
- **Pragmatique** : chaque proposition doit être **faisable dans la stack actuelle** (React + Tailwind + shadcn + primitifs `@breakery/ui`) avec un **rapport effort/impact** explicite. **Pas de redesign gratuit** : si ça oblige à reconstruire le design-system, c'est probablement trop cher — propose l'incrément qui capture 80 % de la valeur.
- **Réutilise l'existant** : préfère étendre un primitif `@breakery/ui` ou un token existant plutôt qu'introduire un composant parallèle. Vérifie la disponibilité via `breakery-ui-kit` avant de proposer un import. Deux faits qui reviennent : **`Select` existe** (un `<select>` natif stylé, exporté par `@breakery/ui`) ; **`RadioGroup`, `Checkbox`, `Popover` et `Tooltip` n'existent pas** — une proposition qui en dépend doit nommer son fallback natif, sinon elle n'est pas faisable.

## Format du rapport (EN FRANÇAIS)

Le rapport rendu en conversation suit **exactement** cette structure :

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

| # | Sévérité | Écran | Profil | Constat (fichier + ancre lue) | Critère |
|---|---|---|---|---|---|
| 1 | P0 | Payment | Caisse | Bouton « Cash » en `h-10` (40 px) < plancher tactile 44 px (`features/payment/components/PaymentMethodGrid.tsx`) | Cible tactile |

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
**Écran** — composant + chemin du fichier (+ la classe ou le libellé exact qui porte le problème).
**Problème** — la lacune ergonomique/visuelle constatée (ancrée dans le code).
**Proposition** — le changement concret (layout, taille, token, composant, micro-interaction). 1 paragraphe.
**Référence marché** — quel leader fait ça bien et pourquoi ça aide ici.
**Stack** — primitifs `@breakery/ui` / tokens / classes Tailwind à utiliser (faisabilité).
**Effort / Impact** — S/M/L × faible/moyen/fort.
**Critère d'acceptation** — comment on saura visuellement que c'est réglé.
```
