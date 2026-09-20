# pos-frontend-design-implement — méthode ciblée

Complément de [SKILL.md](../SKILL.md). Lire les sections nécessaires au parcours indiqué dans l’entrée ; les contrôles applicables restent obligatoires. Les relevés datés sont des points de départ à recouper, pas une certification du code actuel. Les chemins de code sont relatifs au dépôt ; les chemins nus `references/` désignent le dossier du skill. Les liens Markdown sont relatifs à ce fichier.

## Repères

- Méthode — 6 étapes

## Méthode — 6 étapes

### Étape 1 — Récupérer la proposition
- **Cas conversation** (par défaut, et seul cas normal) : la proposition est dans la session — rapport rendu par `pos-frontend-design-audit`, ou demande directe de l'utilisateur. Identifie le(s) ticket(s) à développer : l'utilisateur en nomme un, sinon propose les P0/quick-wins et confirme avant de coder. Reformule en une phrase (« j'implémente : <X> pour <profil> sur <écran> ») et avance.
- **Aucune proposition en session** : ne devine pas le design. Lance `pos-frontend-design-audit` sur la zone concernée, ou demande le ticket précis. **Il n'y a rien à rattraper sur disque** — un audit non consommé dans sa session se refait.

### Étape 2 — Lire le code cible avant de toucher
Va au composant via le `fichier:ligne` du ticket (ou via `pos-frontend-design-audit/references/screen-map.md`). **Lis-le en entier.** Repère : tokens et classes actuels, primitifs `@breakery/ui` déjà utilisés, gestion d'états existante, et si le composant est **partagé entre CAISSE et WAITER** (ex. `ProductGrid` réutilisé en tablette) — auquel cas un changement doit valoir pour les deux profils ou être conditionné.

### Étape 3 — Vérifier les moyens dans le design-system
Avant d'écrire un import ou une couleur :
- Le primitif existe-t-il dans `@breakery/ui` ? L'inventaire fait foi (cf. `breakery-ui-kit`), pas la mémoire de session :
  - **`Select` EXISTE** — un `<select>` **natif stylé** (même surface, hauteur et anneau de focus qu'`Input`) ; ses enfants sont des `<option>`, pas des `SelectItem`. `selectClassName` s'exporte seul pour un call-site qui garde son propre `<select>`. **Ne re-style jamais un `<select>` à la main** : c'est la dette de call-sites divergents que ce primitif a précisément résorbée.
  - **`RadioGroup` / `Checkbox` / `Popover` / `Tooltip` n'existent PAS** → fallback natif (`<input type="radio">`, `<input type="checkbox">`, Radix direct, attribut `title`). Les importer casse le build.
- Le token couleur/espacement existe-t-il ? **Jamais de `#hex` ni `bg-white` en dur** — utilise `text-text-*`, `bg-bg-*` (`base`/`elevated`/`overlay`/`input`), `text-gold`, `var(--success/warning/danger)`.
- **Pas d'alpha sur un token de couleur `var()` nu** (`bg-danger/15`, `bg-gold/5`, `border-border-strong/40`) : Tailwind supprime la déclaration **EN SILENCE** — la couleur n'apparaît jamais, et rien ne le signale. Seule la famille `cat-*` est déclarée `rgb(var(--x) / <alpha-value>)` et accepte l'alpha. Même mort silencieux pour un nom hors famille (`bg-bg-card` n'existe pas). Le preset tranche, pas le sondage navigateur ; la garde CI `tailwind-dead-classes.mjs` attrape le reste.
- Le besoin est-il **partagé POS+BO** ? Si oui et qu'il faut un nouveau primitif, **ne le crée pas ici** — `packages/ui` + PR dédiée (escalade, cf. `breakery-ui-kit`). Reste co-localisé dans `apps/pos/` tant que c'est POS-only.

### Étape 4 — Implémenter
- Applique le changement au plus petit périmètre qui capture la valeur du ticket. **Pas de redesign opportuniste** non demandé.
- Respecte la **typo canonique** (`font-mono` pour prix/montants/timestamps, `font-display` pour titres) et l'**échelle de cibles tactiles** : action primaire WAITER ≥ `h-12` (48px), action fréquente CAISSE ≥ `h-11`/`h-12` (cf. `pos-frontend-design-audit/references/design-rubric.md`).
- Préserve/complète les **états** : si tu touches une grille/liste, garde skeleton + empty + erreur ; sur tablette, garde le comportement offline.
- Garde les **focus visibles** (`focus-visible:outline-gold`) et les `aria-*`/labels existants.
- Fichiers **< 500 lignes** (règle projet) ; co-localise un nouveau composant POS dans `apps/pos/src/features/<domaine>/components/`.

### Étape 5 — Vérifier le rendu et les invariants
- **Typecheck + tests** ciblés (voir « Vérification »).
- **Ne casse pas la plomberie** : si ton changement touche un handler de panier/paiement/cuisine/realtime, c'est le domaine de `pos-flow-audit` — ne modifie pas la logique de flux/RPC pour un changement purement visuel ; si c'est inévitable, **flag-le** et applique les patterns critiques (idempotence, versioning RPC, canal realtime unique, PIN en header) ou délègue.
- Re-passe le ticket sur la **grille de critères** : la cible tactile est-elle au seuil ? l'info critique est-elle hors `muted` ? le CTA domine-t-il ? le profil ciblé est-il réellement servi ?

### Étape 6 — Boucler
- Coche le ticket comme fait (dans ta réponse ; et si pertinent, note l'état dans le rapport).
- Si tu as développé une partie d'un lot, dis ce qui reste.
- Propose une vérification visuelle réelle (deux profils : un écran caisse large + une tablette portrait) — un seul viewport ne prouve pas le responsive.
