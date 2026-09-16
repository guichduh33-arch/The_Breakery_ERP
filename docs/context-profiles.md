# Profils de fenêtre de contexte par session

Ce document définit comment charger le bon périmètre de code par session pour réduire le bruit de contexte.

## Objectif

Ne charger que les fichiers utiles à la tâche en cours, selon le profil métier, puis élargir explicitement si le besoin le nécessite.

## Règles globales

- Sources de vérité (à lire si besoin de décision) :
  - `README.md`
  - `CLAUDE.md`
  - `package.json`
  - `pnpm-workspace.yaml`
  - `turbo.json`
- Exclusions systématiques (par défaut) :
  - `node_modules/`, `dist/`, `.turbo/`, `coverage/`, `build/`, `android/`
  - Fichiers binaires inutiles (`.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, `.ico`, `.bmp`, `.avif`)  
    (sauf si la tâche porte explicitement sur l’asset)
- Ajouter des couches additionnelles **après** échec de la résolution métier (API, route, test manquant).

## Profils

### 1) `POS_SESSION`

- Objectif : correction POS, debug ou implémentation côté caisse.
- Inclusions de base :
  - `apps/pos`
  - `packages/domain`
  - `packages/ui`
  - `packages/supabase`
  - `packages/utils`
- Commande standard :
  ```bash
  git ls-files apps/pos packages/domain packages/ui packages/supabase packages/utils
  ```

### 2) `BO_SESSION`

- Objectif : correction Backoffice (gestion, reporting, inventaire, achats, etc.).
- Inclusions de base :
  - `apps/backoffice`
  - `packages/domain`
  - `packages/ui`
  - `packages/supabase`
  - `packages/utils`
- Commande standard :
  ```bash
  git ls-files apps/backoffice packages/domain packages/ui packages/supabase packages/utils
  ```

### 3) `DOMAIN_SESSION`

- Objectif : logique métier partagée, calculs, règles, types/contrats de domaine.
- Inclusions de base :
  - `packages/domain`
  - `packages/utils`
- Commande standard :
  ```bash
  git ls-files packages/domain packages/utils
  ```

### 4) `SUPABASE_SESSION`

- Objectif : migration SQL, fonctions SQL/Edge Functions, tests PG.
- Inclusions de base :
  - `supabase/migrations`
  - `supabase/functions`
  - `supabase/tests`
  - `supabase/config.toml`
  - `supabase/seed.sql`
  - `packages/supabase`
- Commande standard :
  ```bash
  git ls-files supabase/migrations supabase/functions supabase/tests supabase/config.toml supabase/seed.sql packages/supabase
  ```

## Ordre d’ouverture recommandé

1. Manifeste de périmètre (`README.md`, `CLAUDE.md`, `package.json`).
2. `package.json` des packages du profil.
3. Fichiers de surface métier (routes, pages, features, stores/services).
4. Tests liés au périmètre.
5. DB/infra partielle en second temps seulement (uniquement si la tâche touche SQL/Edge/migration).

## Script d’automatisation

Un script dédié produit ces jeux de fichiers depuis Git :
- `scripts/context-snapshot.mjs`

Exemples :
- `node scripts/context-snapshot.mjs pos`
- `node scripts/context-snapshot.mjs bo` (`backoffice`)
- `node scripts/context-snapshot.mjs domain`
- `node scripts/context-snapshot.mjs supabase`

Le script filtre automatiquement les artefacts volumineux (dist, node_modules, coverage, etc.) et peut inclure les binaires si nécessaire.
