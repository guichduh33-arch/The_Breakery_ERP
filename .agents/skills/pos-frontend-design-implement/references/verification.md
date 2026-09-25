# pos-frontend-design-implement — contrôles et sources

Complément de [SKILL.md](../SKILL.md). Lire les sections nécessaires au parcours indiqué dans l’entrée ; les contrôles applicables restent obligatoires. Les relevés datés sont des points de départ à recouper, pas une certification du code actuel. Les chemins de code sont relatifs au dépôt ; les chemins nus `references/` désignent le dossier du skill. Les liens Markdown sont relatifs à ce fichier.

## Repères

- Vérification (avant de dire que c'est fait)
- Quand escalader / flaguer

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

- Le typecheck et les tests pertinents passent ; distinguer tests exécutés, ignorés et absents. Un échec d'environnement exige un diagnostic, pas une exemption fondée sur une ancienne baseline (voir AGENTS.md et `test-engineer`).
- Le rendu a été vérifié pour le(s) profil(s) ciblé(s) ; idéalement un viewport caisse large ET une tablette portrait pour tout composant WAITER.
- Aucune couleur en dur introduite, aucun import de primitif inexistant, **aucune classe morte** (alpha sur token `var()` nu hors famille `cat-*`, nom de classe absent du preset) — la garde CI `scripts/ci/tailwind-dead-classes.mjs` refuse toute référence neuve.

## Quand escalader / flaguer

- Le ticket exige un **nouveau primitif partagé** POS+BO → `packages/ui` + breakery-ui-kit + PR dédiée, pas un composant local dupliqué.
- Le ticket implique de **modifier la logique commande/paiement/cuisine/realtime** → renvoie à `pos-flow-audit` ; ne mélange pas un changement visuel et une mutation de flux sans validation.
- Le ticket touche **permissions/visibilité par rôle** → `security-fraud-guard`.
- La proposition s'avère **infaisable proprement dans la stack** (oblige à casser le design-system) → ne force pas : remonte à l'audit pour ré-arbitrer l'effort/impact.
