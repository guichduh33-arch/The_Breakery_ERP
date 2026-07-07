---
name: pos-frontend-design-implement
description: >-
  Développeur des propositions de design POS produites par le skill pos-frontend-design-audit.
  Lit un rapport d'audit dans docs/design-audits/, sélectionne un (ou plusieurs) ticket(s) de
  proposition, et l'IMPLÉMENTE dans apps/pos/ — composants React/TypeScript + Tailwind + primitifs
  @breakery/ui — en respectant le design-system (tokens, typo canonique, fallbacks natifs), les deux
  profils CAISSE (desktop/Tauri) et WAITER (tablette/mobile Capacitor), et les patterns critiques du
  projet (CLAUDE.md). Vérifie le rendu, les cibles tactiles, les états (loading/empty/erreur/offline)
  et lance les tests avant de conclure. À utiliser DÈS QUE l'utilisateur veut PASSER À L'ACTION sur le
  design POS : "implémente la proposition", "développe le ticket d'audit", "code le redesign POS",
  "applique les recos design POS", "agrandis les boutons de paiement", "refais la grille produits",
  "rends l'écran waiter plus ergonomique", "applique le quick-win du rapport". Si aucun rapport
  d'audit n'existe encore ou si la demande est "trouve les problèmes de design", c'est l'autre skill
  (pos-frontend-design-audit) qui s'exécute d'abord. DÉFÉRER : l'ajout d'un nouveau primitif PARTAGÉ
  → packages/ui + breakery-ui-kit ; la logique du parcours commande→paiement et la correction
  fonctionnelle (RPC, idempotence, realtime) → pos-flow-audit ; RBAC/permissions → security-fraud-guard ;
  concevoir un écran/composant POS entièrement NEUF sans rapport d'audit préalable (from scratch) → pos-design-craft.
  Ce skill TRANSFORME une proposition de design validée en code POS qui tient en production.
pathPatterns:
  - 'apps/pos/src/**/*.tsx'
  - 'apps/pos/src/**/*.css'
  - 'docs/design-audits/**'
promptSignals:
  phrases:
    - 'implémente la proposition'
    - 'développe le ticket'
    - 'développe les propositions'
    - 'code le redesign POS'
    - 'applique les recos design'
    - 'applique le quick-win'
    - 'rapport d''audit POS'
    - 'agrandis les boutons'
    - 'refais la grille produits'
    - 'rends l''écran waiter plus ergonomique'
    - 'implémenter le design POS'
    - 'développer le design POS'
---

# POS Frontend Design Implement — The Breakery

Bras armé de **`pos-frontend-design-audit`** : prend une proposition de design **déjà formulée** (dans un rapport `docs/design-audits/`, ou donnée inline par l'utilisateur) et la **transforme en code POS qui tient en production**. L'audit décide *quoi* et *pourquoi* ; ce skill fait *comment*, proprement.

**`CLAUDE.md` est la source de vérité** des patterns du projet. **`breakery-ui-kit`** est la source de vérité des primitifs/tokens. Ce skill ajoute la méthode d'implémentation design et les garde-fous d'exécution.

## Quand c'est ce skill (vs l'audit)

- « Trouve les problèmes / audite / compare au marché » → **pas ici**, c'est `pos-frontend-design-audit`.
- « Implémente / développe / applique / code / agrandis / refais » une proposition → **ici**.
- Si on te demande d'implémenter mais qu'**aucun rapport n'existe et que la proposition n'est pas claire**, ne devine pas le design : lance d'abord l'audit (ou demande à l'utilisateur de pointer le ticket précis).

## Méthode — 6 étapes

### Étape 1 — Récupérer la proposition
- **Cas rapport fichier** (par défaut) : lis le rapport le plus récent dans `docs/design-audits/` (`Glob docs/design-audits/*.md`). Identifie le(s) ticket(s) à développer — l'utilisateur en nomme un, sinon propose les P0/quick-wins et confirme avant de coder.
- **Cas inline** : la proposition est dans la conversation. Reformule-la en une phrase (« j'implémente : <X> pour <profil> sur <écran> ») et avance.

### Étape 2 — Lire le code cible avant de toucher
Va au composant via le `fichier:ligne` du ticket (ou via `pos-frontend-design-audit/references/screen-map.md`). **Lis-le en entier.** Repère : tokens et classes actuels, primitifs `@breakery/ui` déjà utilisés, gestion d'états existante, et si le composant est **partagé entre CAISSE et WAITER** (ex. `ProductGrid` réutilisé en tablette) — auquel cas un changement doit valoir pour les deux profils ou être conditionné.

### Étape 3 — Vérifier les moyens dans le design-system
Avant d'écrire un import ou une couleur :
- Le primitif existe-t-il dans `@breakery/ui` ? (cf. `breakery-ui-kit` — **`Select`/`RadioGroup`/`Checkbox` n'existent PAS** → fallback natif.)
- Le token couleur/espacement existe-t-il ? **Jamais de `#hex` ni `bg-white` en dur** — utilise `text-text-*`, `bg-bg-*`, `text-gold`, `var(--success/warning/danger)`.
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

## Garde-fous

- **N'invente pas de design.** Tu exécutes une proposition validée. Si elle est ambiguë, demande/relis l'audit ; ne « complète » pas avec un parti pris non discuté.
- **Tokens et primitifs only.** Toute couleur en dur ou tout primitif inexistant = build cassé ou dette — vérifie avant d'écrire.
- **Deux profils, toujours.** Un changement sur un composant partagé doit être jugé pour CAISSE *et* WAITER. Un gain desktop ne doit pas dégrader la tablette debout.
- **Aspect, pas plomberie.** Tu changes l'apparence/manipulation. Tu ne réécris pas la logique commande→paiement pour faire joli — ça appartient à `pos-flow-audit`.
- **Pas de fichier hors structure** (règle CLAUDE.md) : code dans `apps/pos/src/...`, tests co-localisés en `__tests__/`.

## Vérification (avant de dire que c'est fait)

```bash
# Cheap d'abord
pnpm typecheck

# Smoke/unit POS de la feature touchée (adapter le filtre)
pnpm --filter @breakery/app-pos test products
pnpm --filter @breakery/app-pos test cart
pnpm --filter @breakery/app-pos test payment
pnpm --filter @breakery/app-pos test tablet

# Si un primitif partagé a bougé
pnpm --filter @breakery/ui test

# Build de non-régression
pnpm build
```

- Le typecheck passe, les tests de la feature touchée passent (distinguer une vraie régression du baseline env-gated connu — cf. CLAUDE.md / `test-engineer`).
- Le rendu a été vérifié pour le(s) profil(s) ciblé(s) ; idéalement un viewport caisse large ET une tablette portrait pour tout composant WAITER.
- Aucune couleur en dur introduite, aucun import de primitif inexistant.

## Quand escalader / flaguer

- Le ticket exige un **nouveau primitif partagé** POS+BO → `packages/ui` + breakery-ui-kit + PR dédiée, pas un composant local dupliqué.
- Le ticket implique de **modifier la logique commande/paiement/cuisine/realtime** → renvoie à `pos-flow-audit` ; ne mélange pas un changement visuel et une mutation de flux sans validation.
- Le ticket touche **permissions/visibilité par rôle** → `security-fraud-guard`.
- La proposition s'avère **infaisable proprement dans la stack** (oblige à casser le design-system) → ne force pas : remonte à l'audit pour ré-arbitrer l'effort/impact.
