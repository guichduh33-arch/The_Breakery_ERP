---
name: breakery-ui-kit
description: >-
  Utiliser @breakery/ui dans le JSX Breakery : vérifier exports, tokens, Select natif, Dialog/Sheet, formulaires et états. Pour implémenter avec le design system existant ; direction artistique : breakery-design ou pos-design-craft.
---

# Breakery UI Kit — `@breakery/ui`

Commencer par packages/ui/src/index.ts et le composant ou token utilisé, pas par l’inventaire complet. Lire les patterns seulement pour le contrôle concerné ; vérifier toute affirmation d’absence au barrel.

## Lecture proportionnée

Les règles d’CLAUDE.md restent applicables. Les liens ci-dessous sont conditionnels : ne pas charger tout le dossier ni tous les skills voisins. Réutiliser les lectures déjà faites dans la session ; rouvrir si le code ou le périmètre a changé.

| Quand lire | Ressource |
|---|---|
| Pour le contrat, le parcours ou la surface concernée ; avant toute modification de sa logique. | [modèle, contrats et repères](references/model.md) |
| Pour conduire la conception, le diagnostic ou le conseil demandé ; lire seulement le cas correspondant. | [méthode ciblée](references/workflow.md) |
| Avant une modification et avant de conclure : sélectionner les contrôles du parcours, puis exécuter les tests requis par CLAUDE.md. | [contrôles et sources](references/verification.md) |

## ❌ Ce qui N'EST PAS exporté (fallbacks requis)

| Absent | Fallback à utiliser | Contexte |
|--------|--------------------|---------:|
| `SelectItem` (Radix) | `Select` existe, mais c'est un `<select>` natif stylé : ses enfants sont des `<option>`, pas des `SelectItem` | |
| `RadioGroup` / `RadioGroupItem` | groupe de `<button>` ou `<input type="radio">` natif | `ConvertToParentDialog` (choix d'axe) |
| `Checkbox` | `<input type="checkbox">` natif | |
| `Popover` | Radix `@radix-ui/react-popover` direct si besoin | |
| `Tooltip` | Radix direct ou attribut `title` | |

> Règle : **ne jamais importer un primitif absent du barrel**. TypeScript lèvera une erreur, mais la vraie perte de temps c'est le debug runtime. Vérifier `packages/ui/src/index.ts` avant d'écrire un import — c'est plus rapide que de croire une liste.
>
> Le piège inverse coûte aussi cher : ce skill a longtemps affirmé que `Select` n'existait pas, ce qui a fait styler ~75 `<select>` à la main avec des hauteurs et des anneaux de focus divergents — la dette que le primitif a précisément résorbée. **Un « ça n'existe pas » se re-vérifie comme un « ça existe ».**

---

## Anti-patterns

- **Importer `RadioGroup`/`Checkbox`/`Popover`/`Tooltip` depuis `@breakery/ui`** → n'existent pas, build cassé.
- **Re-styler un `<select>` à la main** alors que `Select` (ou `selectClassName`) fait le travail → c'est la dette que le primitif a résorbée.
- **Hardcoder une couleur** (`#c9a557`, `bg-white`, etc.) → utiliser les tokens CSS.
- **Poser un alpha sur un token de couleur `var()` nu** (`bg-danger/15`, `bg-gold/5`) → Tailwind supprime la déclaration EN SILENCE. Seule la famille `cat-*` est déclarée avec `<alpha-value>`. La vérité est `packages/ui/tailwind-preset.ts`, et une garde CI (`tailwind-dead-classes.mjs`) le surveille.
- **Dupliquer un composant déjà dans @breakery/ui** dans une app — vérifier la liste d'abord.
- **Créer un composant POS-only dans @breakery/ui** alors qu'il n'a pas vocation partagée — co-localiser dans `apps/pos/src/components/`.
- **Faire un `import ... from '@breakery/ui/primitives/Dialog'`** (chemin interne) → toujours importer depuis `@breakery/ui` (barrel public).

---

## Qualité de restitution

Répondre d’abord au problème demandé. Distinguer fait observé, intention métier et hypothèse ; ancrer les constats dans le code lu ou le résultat mesuré. Un ancien relevé n’est pas une preuve actuelle. Donner impact, correction ou décision attendue, vérification effectuée et limite éventuelle ; ne pas remplir des rubriques sans résultat utile. Une consigne de skill n’élargit pas l’autorisation donnée par Mamat.
