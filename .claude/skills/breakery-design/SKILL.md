---
name: breakery-design
description: 'Direction artistique + ergonomie The Breakery — identité visuelle par surface (POS luxe-dark, BO ivoire, KDS, Customer Display, Tablet), trends UI applicables vs gadgets, méthodologie variantes-avant-implémentation, checklist audit esthétique/pratique (WCAG, touch 44px, états, motion). Use when designing, redesigning, polishing or auditing any screen/component look & feel.'
pathPatterns:
  - 'apps/*/src/**/components/**'
  - 'apps/*/src/**/pages/**'
  - 'packages/ui/**'
promptSignals:
  phrases:
    - 'design'
    - 'esthétique'
    - 'esthetique'
    - 'redesign'
    - 'mockup'
    - 'maquette'
    - 'polish'
    - 'look and feel'
    - 'apparence'
    - 'moderniser'
    - 'trend'
    - 'micro-interaction'
    - 'animation'
    - 'audit visuel'
    - 'glassmorphism'
    - 'glass'
    - 'dashboard'
    - 'nouvelle page'
    - 'nouvel écran'
    - 'moderne'
---

# Breakery Design — direction artistique + ergonomie

**Couche AU-DESSUS de `breakery-ui-kit`** : ce skill dit *quoi viser* esthétiquement et ergonomiquement ; `breakery-ui-kit` reste la source de vérité pour *avec quoi* (exports réels, tokens, fallbacks — y compris le contenu réel de `typography.css`/`motion.css`/`colors.css`). CLAUDE.md reste la source des patterns globaux. **Hors scope ici** : l'emplacement des fichiers, les routes et les conventions feature-folder (voir CLAUDE.md + l'app concernée). Ne jamais contourner : tout choix esthétique s'implémente en tokens `@breakery/ui/tokens.css`, jamais en hex.

> Digest trends daté dans [`references/trends.md`](references/trends.md) (2026-07). **Protocole refresh** : si décision esthétique structurante (nouveau module, redesign de page, nouveau composant partagé) ET digest vieux de plus de ~6 mois → WebSearch d'abord, mettre à jour le digest ensuite.

---

## Identité par surface (5 surfaces, 2 thèmes)

L'esthétique n'est jamais décorative : chaque surface a un **job** et son design sert ce job.

### POS (`.theme-pos` / `:root` luxe-dark)
- **Job** : encaisser vite, sans erreur, au doigt, en heure de pointe.
- **Esthétique** : luxe-dark charcoal (`--surface-0..4`), gold (`--gold-base`) **parcimonieux** — accents de marque et actions primaires seulement. Le gold partout = bruit.
- **Pratique** : touch targets **≥ 44 px** (règle dure, cf. S60 bouton Ardoise), feedback immédiat sur chaque tap (état pressed visible), zéro hover-only, hiérarchie = taille + surface, pas couleur seule. Glass/translucidité : tolérée uniquement sur les backdrops d'overlay (modal, sheet), jamais sur le contenu.
- **Money-path** : aucune animation décorative sur le flux de paiement. Le seul motion autorisé y est du feedback fonctionnel (confirmation, erreur).

### Backoffice (`.theme-backoffice` ivoire)
- **Job** : lire de la donnée dense, décider, exporter. Desktop + souris.
- **Esthétique** : crème/ivoire (`#f7f3ec..#fff` via tokens), calme, éditorial. Le contraste se joue en typo et espacement, pas en couleurs vives.
- **Pratique** : densité assumée sur les tables (DataTable), mais **une seule hiérarchie par page** — un KPI row, un contenu principal, des actions secondaires en retrait. Bento grid OK pour les dashboards (cf. trends). États vides expressifs (`EmptyState` avec action), jamais une table blanche muette.

### KDS (luxe-dark)
- **Job** : lisible à 2-3 mètres, en cuisine, mains occupées.
- **Esthétique** : quasi rien — la couleur est un **code d'urgence** (temps d'attente), pas une décoration. Typo grosse, poids fort.
- **Pratique** : zéro ornement, zéro glassmorphism, contrastes maximaux, cibles bump énormes (le doigt est pressé/mouillé). L'alarme sonore + bandeau > toute subtilité visuelle.

### Customer Display (luxe-dark)
- **Job** : rassurer le client (total juste, merci) — c'est LE brand moment.
- **Esthétique** : la surface la plus « luxe » du système : logo, gold, respiration, grandes tailles. Lisible à 1-2 m sans effort.
- **Pratique** : aucune interaction ; toute l'attention sur total → paiement → merci/monnaie (broadcast `payment_complete`, 8 s). Pas de carrousel anxiogène pendant l'encaissement.

### Tablet self-service (luxe-dark)
- **Job** : commander seul sans formation.
- **Esthétique** : POS simplifié — mêmes tokens, imagerie produit plus généreuse.
- **Pratique** : parcours linéaire, progressive disclosure (options/modifiers révélés au besoin), touch ≥ 44 px, textes courts. Un client perdu = une commande perdue.

---

## Méthodologie — variantes avant implémentation (inspirée Stitch)

**Structurant ou pas ?** Règle : si le changement introduit un **nouveau parti pris visuel** (nouveau layout, nouvel effet, nouvelle page) → variantes requises. S'il corrige/étend dans le langage visuel existant (alignement, état manquant, colonne de table) → implémenter directement, checklist en definition of done.

Pour tout écran nouveau ou redesign structurant :

1. **Design-system-first** : lister d'abord les tokens/primitives disponibles (via `breakery-ui-kit`). La contrainte précède la créativité.
2. **2-3 variantes** avant de coder : artifact HTML self-contained (tokens copiés en variables CSS locales) ou mockup dans un outil AI externe (Stitch, etc.). Chaque variante = un parti pris nommé (« densité max », « respiration éditoriale », « urgence d'abord »).
3. **Choix argumenté** contre le job de la surface (pas « c'est joli ») — montrer les variantes à l'utilisateur si la décision est structurante.
4. **Traduction en tokens** : le gagnant s'implémente exclusivement en tokens + primitives `@breakery/ui`. Un mockup externe est une **inspiration, jamais une source de code** — on ne colle pas le CSS d'un outil AI dans le repo.
5. Nouveau token nécessaire → `colors.css` sous la bonne classe de thème (règle ui-kit), jamais dans le composant.

---

## Checklist audit esthétique + pratique

Applicable à tout écran existant (posture audit) comme à toute création (definition of done) :

| # | Check | Critère |
|---|-------|---------|
| 1 | Hiérarchie visuelle | 1 seul point focal par écran ; l'œil trouve l'action primaire en < 1 s |
| 2 | Contraste | WCAG AA : 4.5:1 texte normal, 3:1 grand texte/UI — vérifier les deux thèmes |
| 3 | Touch targets | ≥ 44 px sur POS/KDS/Tablet ; espacement suffisant entre cibles adjacentes |
| 4 | Densité | Adaptée à la surface (dense en BO tables, aérée en Customer Display) |
| 5 | États | loading / empty / error / success TOUS designés — jamais d'écran blanc muet |
| 6 | Motion | Fonctionnel (feedback, transition d'état), durées/easings via `motion.css`, respecte `prefers-reduced-motion` |
| 7 | Tokens | Zéro hex hardcodé ; les 2 thèmes rendus correctement (tester `.theme-backoffice` ET luxe-dark) |
| 8 | Cohérence | Composant identique = apparence identique partout (pas de Badge réinventé) |
| 9 | Typo | Échelle de `typography.css` uniquement ; pas de taille arbitraire |
| 10 | Glanceabilité | KDS/Customer Display : test « lisible à 2 m » (taille + poids + contraste) |
| 11 | Performance perçue | Feedback < 100 ms après tap/clic ; opération longue = skeleton/spinner + bouton désactivé (pas d'UI muette) |

Restituer un audit sous forme de findings par sévérité (bloquant a11y / incohérence / polish), avec le token ou primitive de correction proposé.

---

## Anti-patterns

- **Trend plaqué sans usage** — un effet (glass, glow, 3D) qui ne sert pas le job de la surface est du bruit. Vérifier le verdict dans `references/trends.md` avant d'introduire un trend.
- **Hex hardcodé** ou couleur Tailwind brute (`bg-white`, `#c9a557`) → tokens, toujours.
- **Animation décorative sur la money-path** (checkout, paiement, void) — feedback fonctionnel seulement.
- **Rupture de thème** — un composant qui ne rend bien que dans un des deux thèmes est un bug.
- **Couleur comme seul signal** (statut uniquement par le fond) — toujours doubler d'un texte/icône (daltonisme + KDS à distance).
- **Importer un primitif inexistant** (`Select`, `RadioGroup`…) — vérifier la liste `breakery-ui-kit` d'abord.
- **Copier le code d'un mockup AI** dans le repo — traduire en tokens/primitives.

---

## When to escalate

- Direction esthétique qui exigerait de **modifier la cascade de tokens** (nouvelle couche, nouveau thème) → décision utilisateur, PR dédiée.
- Trend structurant absent du digest et digest récent → WebSearch ponctuel, puis proposer la mise à jour du digest.
- Conflit entre esthétique et un pattern critique CLAUDE.md (ex. motion sur money-path) → CLAUDE.md gagne, toujours.
