---
name: breakery-design
description: 'Direction artistique + ergonomie The Breakery — identité visuelle par surface (POS luxe-dark, BO « Instrument » clair, KDS, Customer Display, tablette serveur), trends UI applicables vs gadgets, méthodologie variantes-avant-implémentation, checklist audit esthétique/pratique (WCAG, touch 44px, états, motion). Use when designing, redesigning, polishing or auditing any screen/component look & feel. Frontière : ce skill porte la DA TRANSVERSE et les surfaces non-POS (back-office, KDS, Customer Display, dashboard). Pour le POS spécifiquement (apps/pos, CAISSE/WAITER), préférer pos-design-craft (créer un écran/composant neuf) ou pos-frontend-design-audit / pos-frontend-design-implement (auditer puis coder l''existant) ; pour les faits du design-system (primitifs, tokens) → breakery-ui-kit.'
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
    - 'moderne'
---

# Breakery Design — direction artistique + ergonomie

> **Re-vérifié le 2026-08-31** contre le code et `docs/objectifs/` : job des 5 surfaces,
> doctrine or/vert, tokens du thème back-office. Les valeurs de tokens citées ici sont
> des **repères de lecture** ; la source est `packages/ui/src/tokens/colors.css`, et une
> valeur qui diverge se corrige contre elle. Les énoncés d'**intention** de direction
> artistique (ce qu'une surface doit donner à ressentir) ne se réalignent jamais sur le
> code : un écart entre l'intention et le rendu est un constat à remonter, pas une ligne
> à réécrire.

**Carte des 3 couches design (complémentaires, pas concurrentes)** :
1. `breakery-design` (ici) — direction artistique + ergonomie **transversale** aux 5 surfaces, et audit.
2. `pos-design-craft` — spécialiste **génératif POS** : pour concevoir/refondre un écran, composant ou flux d'`apps/pos`, c'est LUI qui mène (règles chiffrées Fitts/cibles rush/OKLCH/Playwright) ; ce skill fournit alors le cadre identitaire, pas le détail d'exécution.
3. `breakery-ui-kit` — surface map factuelle de `@breakery/ui` (exports réels, tokens, fallbacks) : source de vérité d'implémentation pour les deux autres.

**Couche AU-DESSUS de `breakery-ui-kit`** : ce skill dit *quoi viser* esthétiquement et ergonomiquement ; `breakery-ui-kit` reste la source de vérité pour *avec quoi* (exports réels, tokens, fallbacks — y compris le contenu réel de `typography.css`/`motion.css`/`colors.css`). CLAUDE.md reste la source des patterns globaux. **Hors scope ici** : l'emplacement des fichiers, les routes et les conventions feature-folder (voir CLAUDE.md + l'app concernée). Ne jamais contourner : tout choix esthétique s'implémente en tokens `@breakery/ui/tokens.css`, jamais en hex.

> Digest trends daté dans [`references/trends.md`](references/trends.md) (2026-07). **Protocole refresh** : si décision esthétique structurante (nouveau module, redesign de page, nouveau composant partagé) ET digest vieux de plus de ~6 mois → WebSearch d'abord, mettre à jour le digest ensuite.

---

## Identité par surface (5 surfaces, 2 thèmes)

L'esthétique n'est jamais décorative : chaque surface a un **job** et son design sert ce job.

### POS (`.theme-pos` / `:root` luxe-dark)
- **Job** : encaisser vite, sans erreur, au doigt, en heure de pointe.
- **Esthétique** : luxe-dark charcoal (`--surface-0..4`), or (`--gold-base`) **parcimonieux** — accents de marque et conduite du regard. **L'or MÈNE, le vert ENGAGE** (arbitrage gravé 2026-08-24) : l'or dirige l'œil et signe la marque, il ne remplit pas l'action ; le bouton qui engage est vert — c'est le variant `primary` de `Button`, et `gold` est un variant distinct qu'on choisit exprès (`packages/ui/src/primitives/Button.tsx`). L'or partout = bruit, et un or qui remplit une action primaire est une faute de doctrine, pas un goût.
- **Pratique** : touch targets **≥ 44 px** (règle dure — plancher `--touch-min`), feedback immédiat sur chaque tap (état pressed visible), zéro hover-only, hiérarchie = taille + surface, pas couleur seule. Glass/translucidité : tolérée uniquement sur les backdrops d'overlay (modal, sheet), jamais sur le contenu.
- **Money-path** : aucune animation décorative sur le flux de paiement. Le seul motion autorisé y est du feedback fonctionnel (confirmation, erreur).

### Backoffice (`.theme-backoffice`, direction « Instrument »)
- **Job** : lire de la donnée dense, décider, exporter. **Desktop + souris uniquement** — il n'y a pas de tablette au back-office : ne jamais compter une cible sous 44 px ni un palier sous 1024 px comme un défaut sur cette surface.
- **Esthétique** : gris chaud **désaturé**, pas d'ivoire — la refonte du 2026-08-05 a retiré la crème, qui était le signal « site de boulangerie » le plus fort dans un outil de gestion. Repères de la rampe : `--surface-0`/`-1` au même gris de fond, `-2`/`-3` en blanc pur pour les cartes, `-4` plus **sombre** qu'elles pour marquer le survol au-dessus du blanc. Coins serrés, filet or sous la top bar, grille de mesure en fond de page. Calme, éditorial : le contraste se joue en typo et espacement, pas en couleurs vives. **L'or y est une ENCRE de sens** (nav active, liens, prix retail), il ne remplit plus rien ; l'action primaire du back-office est **encre** (variant `ink`). Valeurs exactes et commentaires de direction : bloc `.theme-backoffice` de `packages/ui/src/tokens/colors.css` — tout est scopé au thème pour que la direction reste commutable, et **le POS n'en hérite rien**.
- **Pratique** : densité assumée sur les tables (DataTable), mais **une seule hiérarchie par page** — un KPI row, un contenu principal, des actions secondaires en retrait. Bento grid OK pour les dashboards (cf. trends). États vides expressifs (`EmptyState` avec action), jamais une table blanche muette.

### KDS (luxe-dark)
- **Job** : lisible à 2-3 mètres, en cuisine, mains occupées.
- **Esthétique** : quasi rien — la couleur est un **code d'urgence** (temps d'attente), pas une décoration. Typo grosse, poids fort.
- **Pratique** : zéro ornement, zéro glassmorphism, contrastes maximaux, cibles bump énormes (le doigt est pressé/mouillé). L'alarme sonore + bandeau > toute subtilité visuelle.

### Customer Display (luxe-dark)
- **Job** : rassurer le client (total juste, merci) — c'est LE brand moment.
- **Esthétique** : la surface la plus « luxe » du système : logo, gold, respiration, grandes tailles. Lisible à 1-2 m sans effort.
- **Pratique** : aucune interaction ; toute l'attention sur total → paiement → merci/monnaie (broadcast `payment_complete`, maintenu le temps de `PAYMENT_COMPLETE_DISPLAY_MS` — lire la constante dans `apps/pos/src/features/display/hooks/useCartBroadcast.ts`, ne jamais graver la durée dans une maquette). Pas de carrousel anxiogène pendant l'encaissement.

### Tablette de salle — outil SERVEUR (`/tablet`, luxe-dark)
- **Utilisateur** : un **serveur formé**, debout, en plein service, une main sur la tablette. Ce n'est **pas** une borne self-service : le client n'y touche pas (donner la tablette au client est un item de backlog du module, pas l'existant). Le job de la surface se lit dans `docs/objectifs/TABLET_ORDERING.md`.
- **Job** : transformer un serveur en salle en **noyau mobile du POS** — saisir la commande à la table et l'envoyer en cuisine avant de quitter la table, plutôt que quatre allers-retours au comptoir avec un carnet.
- **Esthétique** : mêmes tokens que le POS, **volontairement épurée** — la tablette est délibérément plus pauvre que la caisse, pas une caisse rétrécie qu'on aurait le devoir de compléter. Ce qu'elle n'a pas (pas d'encaissement, pas de modifier complexe, pas de promo manuelle, pas de combo) est du design, pas un manque à combler par l'UI.
- **Pratique** : le **plan de salle** est le point d'entrée du geste (une commande sur place a toujours une table, et c'est par la table qu'on complète une tournée) ; grille produits avec recherche, panier en rail latéral repliable en portrait, bouton d'envoi toujours visible ; cibles tactiles généreuses (≥ 44 px), textes courts.
- **Les deux moments à ne jamais rater visuellement** : (1) l'**envoi** est un point de non-retour — la confirmation ne s'affiche qu'adossée à une écriture réelle, jamais sur un simple geste d'interface ; (2) **compléter** une table déjà servie doit se distinguer d'un doublon — un bandeau nomme la commande complétée pendant toute la saisie. L'état des liaisons (en ligne / hors ligne) est visible en permanence dans l'en-tête : un serveur ne doit jamais croire qu'il a envoyé dans le vide.

---

## Méthodologie — variantes avant implémentation (inspirée Stitch)

**Structurant ou pas ?** Règle : si le changement introduit un **nouveau parti pris visuel** (nouveau layout, nouvel effet, nouvelle page) → variantes requises. S'il corrige/étend dans le langage visuel existant (alignement, état manquant, colonne de table) → implémenter directement, checklist en definition of done.

Pour tout écran nouveau ou redesign structurant :

1. **Design-system-first** : lister d'abord les tokens/primitives disponibles (via `breakery-ui-kit`). La contrainte précède la créativité.
2. **2-3 variantes** avant de coder : artifact HTML self-contained (tokens copiés en variables CSS locales) ou mockup dans un outil AI externe (Stitch, etc.). Chaque variante = un parti pris nommé (« densité max », « respiration éditoriale », « urgence d'abord »). **Les deux thèmes actuels (luxe-dark et « Instrument », et l'or qui les relie) sont l'héritage, pas un carcan** : les variantes peuvent proposer des directions de palette/ambiance neuves — présentées comme telles, jamais imposées ; si la gagnante sort des thèmes existants, c'est une décision cascade-tokens (escalate).
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
| 3 | Touch targets | ≥ 44 px sur POS/KDS/tablette serveur (plancher) ; sur le POS, les actions de rush visent 56-72 px — barème détaillé dans `pos-design-craft` ; espacement suffisant entre cibles adjacentes. **Ne s'applique pas au back-office** (desktop + souris, pas de tablette) |
| 4 | Densité | Adaptée à la surface (dense en BO tables, aérée en Customer Display) |
| 5 | États | loading / empty / error / success TOUS designés — jamais d'écran blanc muet |
| 6 | Motion | Fonctionnel (feedback, transition d'état), durées/easings via `motion.css`, respecte `prefers-reduced-motion` |
| 7 | Tokens | Zéro hex hardcodé ; les 2 thèmes rendus correctement (tester `.theme-backoffice` ET luxe-dark) |
| 8 | Cohérence | Composant identique = apparence identique partout (pas de Badge réinventé) |
| 9 | Typo | Échelle de `typography.css` uniquement ; pas de taille arbitraire |
| 10 | Glanceabilité | KDS/Customer Display : test « lisible à 2 m » (taille + poids + contraste) |
| 11 | Performance perçue | Feedback < 100 ms après tap/clic ; opération longue = skeleton/spinner + bouton désactivé (pas d'UI muette) |

Restituer un audit sous forme de findings par sévérité (bloquant a11y / incohérence / polish), avec le token ou primitive de correction proposé.

**Vérifier au navigateur, pas à l'œil (MCP Playwright)** : les checks mesurables (contraste, tailles de cibles, rendu des 2 thèmes, lisibilité à distance) se vérifient sur le rendu réel via les outils `mcp__plugin_playwright_playwright__browser_*` — naviguer vers le dev server ou un mockup HTML, mesurer par `browser_evaluate` (`getBoundingClientRect`, `getComputedStyle`, ratio WCAG calculé sur les couleurs computed), capturer par `browser_take_screenshot` aux dimensions des devices cibles. Protocole détaillé et chiffré : skill `pos-design-craft` (section Playwright) — même méthode pour toutes les surfaces. Pour l'état de l'art au-delà du digest trends : WebSearch + navigation Playwright sur des références publiques, en extraire des principes mesurés, jamais du code copié.

---

## Anti-patterns

- **Trend plaqué sans usage** — un effet (glass, glow, 3D) qui ne sert pas le job de la surface est du bruit. Vérifier le verdict dans `references/trends.md` avant d'introduire un trend.
- **Hex hardcodé** ou couleur Tailwind brute (`bg-white`, `#c9a557`) → tokens, toujours.
- **Animation décorative sur la money-path** (checkout, paiement, void) — feedback fonctionnel seulement.
- **Rupture de thème** — un composant qui ne rend bien que dans un des deux thèmes est un bug.
- **Couleur comme seul signal** (statut uniquement par le fond) — toujours doubler d'un texte/icône (daltonisme + KDS à distance).
- **Importer un primitif inexistant** (`Select`, `RadioGroup`…) — vérifier la liste `breakery-ui-kit` d'abord.
- **Copier le code d'un mockup AI** dans le repo — traduire en tokens/primitives.
- **Remplir une action primaire en or** — l'or mène, le vert engage (voir la carte POS).

---

## Exceptions gravées — ne JAMAIS les remonter comme défauts

Arbitrages déjà pris par le propriétaire. Un audit qui les re-signale fait perdre le temps
qu'il prétend faire gagner. Les rouvrir demande une nouvelle décision, pas un constat.

- **Or MÈNE / vert ENGAGE** (2026-08-24) — un or qui dirige le regard sans remplir l'action n'est pas une timidité à corriger.
- **Serif dans les titres de modales** — accepté.
- **Numéro de commande en mono, partout** — c'est la règle, pas une incohérence.
- **Playfair via `/display`** — exception assumée de la pile typographique.
- **Le croissant de l'écran de connexion** — décoratif et voulu.
- **Pas de tablette au back-office** — cibles < 44 px et paliers sous 1024 px n'y sont pas des défauts.
- **Le POS ne va JAMAIS sur Vercel** ; le back-office, oui. Ne pas proposer l'inverse.

---

## When to escalate

- Direction esthétique qui exigerait de **modifier la cascade de tokens** (nouvelle couche, nouveau thème) → décision utilisateur, PR dédiée.
- Trend structurant absent du digest et digest récent → WebSearch ponctuel, puis proposer la mise à jour du digest.
- Conflit entre esthétique et un pattern critique CLAUDE.md (ex. motion sur money-path) → CLAUDE.md gagne, toujours.
