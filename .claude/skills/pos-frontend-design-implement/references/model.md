# pos-frontend-design-implement — modèle, contrats et repères

Complément de [SKILL.md](../SKILL.md). Lire les sections nécessaires au parcours indiqué dans l’entrée ; les contrôles applicables restent obligatoires. Les relevés datés sont des points de départ à recouper, pas une certification du code actuel. Les chemins de code sont relatifs au dépôt ; les chemins nus `references/` désignent le dossier du skill. Les liens Markdown sont relatifs à ce fichier.

## Repères

- Contexte et conventions
- Quand c'est ce skill (vs l'audit)

# POS Frontend Design Implement — The Breakery

Bras armé de **`pos-frontend-design-audit`** : prend une proposition de design **déjà formulée** (rapport rendu en conversation par l'audit, ou donnée directement par l'utilisateur) et la **transforme en code POS qui tient en production**. L'audit décide *quoi* et *pourquoi* ; ce skill fait *comment*, proprement.

**`CLAUDE.md` est la source de vérité** des patterns du projet. **`breakery-ui-kit`** est la source de vérité des primitifs/tokens. Ce skill ajoute la méthode d'implémentation design et les garde-fous d'exécution.

> **Re-vérifié contre le code le 2026-08-31** : inventaire des primitifs (`packages/ui/src/index.ts`), `Select` et `selectClassName` (`packages/ui/src/primitives/Select.tsx`), tokens et familles de classes (`packages/ui/tailwind-preset.ts`), noms de packages et scripts (`package.json` racine, `apps/pos`, `packages/ui`), coques natives (aucun Tauri au dépôt ; Capacitor Android côté WAITER, ADR-029). Les faits ci-dessous se re-vérifient à la source avant d'être cités — un « ça n'existe pas » se re-vérifie comme un « ça existe ».

## Quand c'est ce skill (vs l'audit)

- « Trouve les problèmes / audite / compare au marché » → **pas ici**, c'est `pos-frontend-design-audit`.
- « Implémente / développe / applique / code / agrandis / refais » une proposition → **ici**.
- Si on te demande d'implémenter mais qu'**aucune proposition n'est présente dans la session et que la demande n'est pas claire**, ne devine pas le design : lance d'abord l'audit (ou demande à l'utilisateur de pointer le ticket précis).
