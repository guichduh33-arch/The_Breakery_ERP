---
name: breakery-design
description: >-
  Direction artistique du back-office Breakery et cohérence entre surfaces : concevoir, revoir ou polir identité, hiérarchie et ergonomie. Création POS : pos-design-craft ; primitifs/tokens : breakery-ui-kit.
---

# Breakery Design — direction artistique + ergonomie

Choisir d’abord la surface et son usage. Lire sa section d’identité avant de proposer ; conserver les arbitrages visibles ci-dessous. Une correction dans le langage existant n’exige pas un nouveau parti pris.

## Lecture proportionnée

Les règles d’CLAUDE.md restent applicables. Les liens ci-dessous sont conditionnels : ne pas charger tout le dossier ni tous les skills voisins. Réutiliser les lectures déjà faites dans la session ; rouvrir si le code ou le périmètre a changé.

| Quand lire | Ressource |
|---|---|
| Pour le contrat, le parcours ou la surface concernée ; avant toute modification de sa logique. | [modèle, contrats et repères](references/model.md) |
| Avant une modification et avant de conclure : sélectionner les contrôles du parcours, puis exécuter les tests requis par CLAUDE.md. | [contrôles et sources](references/verification.md) |

## Méthodologie — variantes avant implémentation (inspirée Stitch)

**Structurant ou pas ?** Règle : si le changement introduit un **nouveau parti pris visuel** (nouveau layout, nouvel effet, nouvelle page) → variantes requises. S'il corrige/étend dans le langage visuel existant (alignement, état manquant, colonne de table) → implémenter directement, checklist en definition of done.

Pour tout écran nouveau ou redesign structurant :

1. **Design-system-first** : lister d'abord les tokens/primitives disponibles (via `breakery-ui-kit`). La contrainte précède la créativité.
2. **2-3 variantes** avant de coder : artifact HTML self-contained (tokens copiés en variables CSS locales) ou mockup dans un outil AI externe (Stitch, etc.). Chaque variante = un parti pris nommé (« densité max », « respiration éditoriale », « urgence d'abord »). **Les deux thèmes actuels (luxe-dark et « Instrument », et l'or qui les relie) sont l'héritage, pas un carcan** : les variantes peuvent proposer des directions de palette/ambiance neuves — présentées comme telles, jamais imposées ; si la gagnante sort des thèmes existants, c'est une décision cascade-tokens (escalate).
3. **Choix argumenté** contre le job de la surface (pas « c'est joli ») — montrer les variantes à l'utilisateur si la décision est structurante.
4. **Traduction en tokens** : le gagnant s'implémente exclusivement en tokens + primitives `@breakery/ui`. Un mockup externe est une **inspiration, jamais une source de code** — on ne colle pas le CSS d'un outil AI dans le repo.
5. Nouveau token nécessaire → `colors.css` sous la bonne classe de thème (règle ui-kit), jamais dans le composant.

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

## Qualité de restitution

Répondre d’abord au problème demandé. Distinguer fait observé, intention métier et hypothèse ; ancrer les constats dans le code lu ou le résultat mesuré. Un ancien relevé n’est pas une preuve actuelle. Donner impact, correction ou décision attendue, vérification effectuée et limite éventuelle ; ne pas remplir des rubriques sans résultat utile. Une consigne de skill n’élargit pas l’autorisation donnée par Mamat.
