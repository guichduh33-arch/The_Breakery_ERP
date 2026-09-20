# breakery-ui-kit — contrôles et sources

Complément de [SKILL.md](../SKILL.md). Lire les sections nécessaires au parcours indiqué dans l’entrée ; les contrôles applicables restent obligatoires. Les relevés datés sont des points de départ à recouper, pas une certification du code actuel. Les chemins de code sont relatifs au dépôt ; les chemins nus `references/` désignent le dossier du skill. Les liens Markdown sont relatifs à ce fichier.

## Repères

- Verification
- Sources de vérité
- When to escalate

## Verification

```bash
# Type check du package UI (NOTE : peut échouer sur env install incomplet
# @dnd-kit/*/recharts/sonner — reproduit sur master, pas une régression)
pnpm --filter @breakery/ui typecheck

# Tests unitaires primitifs + composants
pnpm --filter @breakery/ui test

# Vérifier qu'un export existe réellement
grep "export" packages/ui/src/index.ts | grep "NomDuComposant"
```

---

## Sources de vérité

```
Barrel d'exports (unique point d'entrée)
  packages/ui/src/index.ts

Tokens cascade
  packages/ui/src/tokens/index.css  → 8 layers

Primitives (implémentations)
  packages/ui/src/primitives/*.tsx

Composants domaine
  packages/ui/src/components/*.tsx

Hooks
  packages/ui/src/hooks/*.ts

Patterns de référence consommateurs
  apps/backoffice/src/features/settings/expense-thresholds/ThresholdFormDialog.tsx  (formulaire en Dialog)
  apps/backoffice/src/features/products/components/ConvertToParentDialog.tsx        (groupe de boutons, faute de RadioGroup)
  apps/backoffice/src/features/accounting/components/CreateManualJeModal.tsx        (Dialog stepper)
```

---

## When to escalate

- Besoin d'un nouveau primitif **partagé** entre POS et BO → l'ajouter dans `packages/ui/src/primitives/` + exporter dans `index.ts` + tests dans `__tests__/` + PR dédiée.
- Besoin de `RadioGroup`/`Checkbox` de façon répétée sur plusieurs features → valider avec Mamat si c'est le bon moment de les ajouter à `@breakery/ui`. Précédent utile : `Select` a été créé quand la duplication est devenue mesurable, et il a résorbé ~75 call-sites divergents.
- Nouveau token couleur qui n'existe pas dans les 8 layers → créer dans `colors.css` sous la bonne classe de thème, pas dans le composant.
