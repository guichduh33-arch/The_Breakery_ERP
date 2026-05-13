# Phase 1 — Foundation (Monorepo Bootstrap)

> **Trace historique** : ce fichier documente une session de travail datée. Le contenu de fond reste l'enregistrement de cette date. Seules les références de chemin ont été alignées sur la nouvelle structure documentaire (voir [`docs/README.md`](../../README.md)).
> **Last refreshed** : 2026-05-13

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Initialiser le monorepo Turborepo + pnpm avec les 2 apps Vite (vides mais qui boot) et les 4 packages internes (vides mais publiables/importables). Pas de logique métier, juste la plomberie.

**Spec source:** `docs/workplan/specs/2026-05-03-breakery-split-2apps-design.md` sections 2, 3.

**À la fin de cette phase :**
- Repo git initialisé
- `pnpm install` fonctionne
- `pnpm dev` démarre `apps/pos` (port 5173) et `apps/backoffice` (port 5174) avec une page "Hello"
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` passent (vides ou triviaux)

---

## Task 1.1 — Init git + sauvegarder le spec

**Files:**
- Create: `.gitignore`
- Modify: (commit existing) `docs/workplan/specs/2026-05-03-breakery-split-2apps-design.md`

- [ ] **Step 1: Init git**

```bash
git init
git branch -M main
```

- [ ] **Step 2: Créer `.gitignore`**

```gitignore
# Dependencies
node_modules/
.pnpm-store/

# Build outputs
dist/
build/
.turbo/
.vite/
*.tsbuildinfo

# Environment
.env
.env.local
.env.*.local

# Supabase
supabase/.branches/
supabase/.temp/
supabase/seed.local.sql

# Editor
.vscode/
.idea/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Logs
*.log
npm-debug.log*
pnpm-debug.log*

# Test coverage
coverage/

# Sentry
.sentryclirc
```

- [ ] **Step 3: Premier commit du spec**

```bash
git add .gitignore docs/
git commit -m "docs: add design spec for split 2-apps bootstrap + POS vertical"
```

---

## Task 1.2 — Configurer pnpm workspaces

**Files:**
- Create: `pnpm-workspace.yaml`
- Create: `package.json` (racine)
- Create: `.npmrc`

- [ ] **Step 1: Créer `pnpm-workspace.yaml`**

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

- [ ] **Step 2: Créer `.npmrc`**

```ini
auto-install-peers=true
strict-peer-dependencies=false
shamefully-hoist=false
node-linker=isolated
```

- [ ] **Step 3: Créer `package.json` racine**

```json
{
  "name": "the-breakery",
  "private": true,
  "version": "0.1.0",
  "engines": {
    "node": ">=22.12.0",
    "pnpm": ">=9.0.0"
  },
  "packageManager": "pnpm@9.15.0",
  "scripts": {
    "dev": "turbo run dev --parallel",
    "build": "turbo run build",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck",
    "test": "turbo run test",
    "test:watch": "turbo run test:watch --parallel",
    "format": "prettier --write \"**/*.{ts,tsx,js,jsx,json,md}\"",
    "format:check": "prettier --check \"**/*.{ts,tsx,js,jsx,json,md}\"",
    "db:start": "supabase start",
    "db:stop": "supabase stop",
    "db:reset": "supabase db reset",
    "db:types": "supabase gen types typescript --local > packages/supabase/src/types.generated.ts"
  },
  "devDependencies": {
    "turbo": "^2.3.3",
    "prettier": "^3.4.2",
    "typescript": "^5.3.3"
  }
}
```

- [ ] **Step 4: Verify**

```bash
pnpm install
```

Expected: pnpm crée `node_modules/`, `pnpm-lock.yaml`, sans erreur.

- [ ] **Step 5: Commit**

```bash
git add pnpm-workspace.yaml package.json .npmrc pnpm-lock.yaml
git commit -m "chore(monorepo): init pnpm workspaces + root package.json"
```

---

## Task 1.3 — Configurer Turborepo

**Files:**
- Create: `turbo.json`

- [ ] **Step 1: Créer `turbo.json`**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "globalDependencies": [".env", ".env.example", "tsconfig.base.json"],
  "globalEnv": ["NODE_ENV", "VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"],
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".vite/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "lint": {
      "dependsOn": ["^build"],
      "outputs": []
    },
    "typecheck": {
      "dependsOn": ["^build"],
      "outputs": []
    },
    "test": {
      "dependsOn": ["^build"],
      "outputs": ["coverage/**"]
    },
    "test:watch": {
      "cache": false,
      "persistent": true
    }
  }
}
```

- [ ] **Step 2: Verify**

```bash
pnpm turbo run --help
```

Expected: liste des tasks disponibles.

- [ ] **Step 3: Commit**

```bash
git add turbo.json
git commit -m "chore(monorepo): add turborepo pipeline config"
```

---

## Task 1.4 — Configurer TypeScript base

**Files:**
- Create: `tsconfig.base.json`

- [ ] **Step 1: Créer `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "useDefineForClassFields": true,

    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noFallthroughCasesInSwitch": true,
    "noImplicitOverride": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,

    "skipLibCheck": true,
    "allowSyntheticDefaultImports": true,
    "forceConsistentCasingInFileNames": true,

    "jsx": "react-jsx"
  },
  "exclude": ["node_modules", "dist", ".turbo", "coverage"]
}
```

- [ ] **Step 2: Commit**

```bash
git add tsconfig.base.json
git commit -m "chore(monorepo): add base TypeScript config (strict + extra checks)"
```

---

## Task 1.5 — Configurer ESLint + Prettier

**Files:**
- Create: `eslint.config.mjs`
- Create: `.prettierrc.json`
- Create: `.prettierignore`

- [ ] **Step 1: Installer dépendances ESLint au root**

```bash
pnpm add -Dw eslint@^8.57.1 typescript-eslint@^8.18.2 \
  eslint-plugin-react@^7.37.3 eslint-plugin-react-hooks@^5.1.0 \
  eslint-plugin-import@^2.31.0 eslint-import-resolver-typescript@^3.7.0
```

- [ ] **Step 2: Créer `eslint.config.mjs`**

```js
import tseslint from 'typescript-eslint';
import reactPlugin from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import importPlugin from 'eslint-plugin-import';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/.turbo/**', '**/node_modules/**', '**/coverage/**', '**/*.generated.ts']
  },
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    },
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooks,
      import: importPlugin
    },
    settings: {
      react: { version: 'detect' },
      'import/resolver': { typescript: true }
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'import/no-restricted-paths': ['error', {
        zones: [
          { target: './packages/domain', from: './packages/ui' },
          { target: './packages/domain', from: './packages/supabase' },
          { target: './packages/domain', from: './apps' },
          { target: './packages/utils', from: './packages/ui' },
          { target: './packages/utils', from: './packages/supabase' },
          { target: './packages/utils', from: './apps' },
          { target: './packages/ui', from: './packages/supabase' },
          { target: './packages/ui', from: './apps' },
          { target: './packages/supabase', from: './apps' },
          { target: './apps/pos', from: './apps/backoffice' },
          { target: './apps/backoffice', from: './apps/pos' }
        ]
      }]
    }
  }
);
```

- [ ] **Step 3: Créer `.prettierrc.json`**

```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2,
  "arrowParens": "always",
  "endOfLine": "lf"
}
```

- [ ] **Step 4: Créer `.prettierignore`**

```
**/dist/**
**/.turbo/**
**/node_modules/**
**/coverage/**
**/*.generated.ts
pnpm-lock.yaml
```

- [ ] **Step 5: Commit**

```bash
git add eslint.config.mjs .prettierrc.json .prettierignore package.json pnpm-lock.yaml
git commit -m "chore(monorepo): add ESLint + Prettier config with frontier rules"
```

---

## Task 1.6 — Créer `packages/utils` (squelette)

**Files:**
- Create: `packages/utils/package.json`
- Create: `packages/utils/tsconfig.json`
- Create: `packages/utils/src/index.ts`
- Create: `packages/utils/vitest.config.ts`

- [ ] **Step 1: Créer `packages/utils/package.json`**

```json
{
  "name": "@breakery/utils",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "lint": "eslint src",
    "typecheck": "tsc --noEmit",
    "test": "vitest run --coverage",
    "test:watch": "vitest"
  },
  "dependencies": {
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@vitest/coverage-v8": "^2.1.9",
    "vitest": "^2.1.9"
  }
}
```

- [ ] **Step 2: Créer `packages/utils/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "noEmit": true
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Créer `packages/utils/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      thresholds: { lines: 85, statements: 85, functions: 85, branches: 80 },
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts']
    }
  }
});
```

- [ ] **Step 4: Créer `packages/utils/src/index.ts`**

```ts
export {};
```

- [ ] **Step 5: Commit**

```bash
git add packages/utils/
git commit -m "chore(utils): scaffold @breakery/utils package"
```

---

## Task 1.7 — Créer `packages/domain` (squelette)

**Files:**
- Create: `packages/domain/package.json`
- Create: `packages/domain/tsconfig.json`
- Create: `packages/domain/src/index.ts`
- Create: `packages/domain/vitest.config.ts`

- [ ] **Step 1: Créer `packages/domain/package.json`**

```json
{
  "name": "@breakery/domain",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "lint": "eslint src",
    "typecheck": "tsc --noEmit",
    "test": "vitest run --coverage",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "@vitest/coverage-v8": "^2.1.9",
    "vitest": "^2.1.9"
  }
}
```

- [ ] **Step 2: Créer `packages/domain/tsconfig.json`**

Identique à `packages/utils/tsconfig.json`.

- [ ] **Step 3: Créer `packages/domain/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      thresholds: { lines: 90, statements: 90, functions: 90, branches: 85 },
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts', 'src/types/**']
    }
  }
});
```

- [ ] **Step 4: Créer `packages/domain/src/index.ts`**

```ts
export {};
```

- [ ] **Step 5: Commit**

```bash
git add packages/domain/
git commit -m "chore(domain): scaffold @breakery/domain package"
```

---

## Task 1.8 — Créer `packages/ui` (squelette + tailwind preset vide)

**Files:**
- Create: `packages/ui/package.json`
- Create: `packages/ui/tsconfig.json`
- Create: `packages/ui/src/index.ts`
- Create: `packages/ui/tailwind-preset.ts`
- Create: `packages/ui/src/tokens/luxe-dark.css`
- Create: `packages/ui/vitest.config.ts`

- [ ] **Step 1: Créer `packages/ui/package.json`**

```json
{
  "name": "@breakery/ui",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./tailwind-preset": "./tailwind-preset.ts",
    "./tokens.css": "./src/tokens/luxe-dark.css"
  },
  "scripts": {
    "lint": "eslint src",
    "typecheck": "tsc --noEmit",
    "test": "vitest run --coverage",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@breakery/utils": "workspace:*",
    "@radix-ui/react-dialog": "^1.1.4",
    "@radix-ui/react-tabs": "^1.1.2",
    "@radix-ui/react-slot": "^1.1.1",
    "@radix-ui/react-separator": "^1.1.1",
    "@radix-ui/react-scroll-area": "^1.2.2",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "tailwind-merge": "^3.0.1",
    "lucide-react": "^0.469.0",
    "sonner": "^2.0.7"
  },
  "peerDependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.9.1",
    "@testing-library/react": "^16.3.1",
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "@vitest/coverage-v8": "^2.1.9",
    "autoprefixer": "^10.4.20",
    "jsdom": "^26.0.0",
    "postcss": "^8.4.49",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "tailwindcss": "^3.4.17",
    "tailwindcss-animate": "^1.0.7",
    "vitest": "^2.1.9"
  }
}
```

- [ ] **Step 2: Créer `packages/ui/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "noEmit": true,
    "jsx": "react-jsx"
  },
  "include": ["src/**/*", "tailwind-preset.ts"]
}
```

- [ ] **Step 3: Créer `packages/ui/src/tokens/luxe-dark.css` (placeholder, complétée Phase 4)**

```css
:root, .dark {
  --bg-base: #0a0a0c;
  --text-primary: #f5f5f7;
}
```

- [ ] **Step 4: Créer `packages/ui/tailwind-preset.ts` (placeholder)**

```ts
import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

const preset: Partial<Config> = {
  darkMode: 'class',
  theme: {
    extend: {}
  },
  plugins: [animate]
};

export default preset;
```

- [ ] **Step 5: Créer `packages/ui/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      thresholds: { lines: 70, statements: 70, functions: 70, branches: 60 },
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/index.ts']
    }
  }
});
```

- [ ] **Step 6: Créer `packages/ui/vitest.setup.ts`**

```ts
import '@testing-library/jest-dom';
```

- [ ] **Step 7: Créer `packages/ui/src/index.ts`**

```ts
export {};
```

- [ ] **Step 8: Commit**

```bash
git add packages/ui/
git commit -m "chore(ui): scaffold @breakery/ui package with tailwind preset placeholder"
```

---

## Task 1.9 — Créer `packages/supabase` (squelette)

**Files:**
- Create: `packages/supabase/package.json`
- Create: `packages/supabase/tsconfig.json`
- Create: `packages/supabase/src/index.ts`
- Create: `packages/supabase/src/types.generated.ts` (placeholder)

- [ ] **Step 1: Créer `packages/supabase/package.json`**

```json
{
  "name": "@breakery/supabase",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./types": "./src/types.generated.ts"
  },
  "scripts": {
    "lint": "eslint src",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@breakery/domain": "workspace:*",
    "@breakery/utils": "workspace:*",
    "@supabase/supabase-js": "^2.47.10"
  },
  "devDependencies": {
    "vitest": "^2.1.9"
  }
}
```

- [ ] **Step 2: Créer `packages/supabase/tsconfig.json`** identique à utils.

- [ ] **Step 3: Créer `packages/supabase/src/types.generated.ts` (placeholder)**

```ts
export type Database = Record<string, unknown>;
```

- [ ] **Step 4: Créer `packages/supabase/src/index.ts`**

```ts
export type { Database } from './types.generated.js';
```

- [ ] **Step 5: Commit**

```bash
git add packages/supabase/
git commit -m "chore(supabase): scaffold @breakery/supabase package"
```

---

## Task 1.10 — Créer `apps/pos` (Vite + React + Tailwind, page Hello)

**Files:**
- Create: `apps/pos/package.json`
- Create: `apps/pos/tsconfig.json`
- Create: `apps/pos/tsconfig.node.json`
- Create: `apps/pos/vite.config.ts`
- Create: `apps/pos/tailwind.config.ts`
- Create: `apps/pos/postcss.config.js`
- Create: `apps/pos/index.html`
- Create: `apps/pos/src/main.tsx`
- Create: `apps/pos/src/App.tsx`
- Create: `apps/pos/src/index.css`
- Create: `apps/pos/vitest.config.ts`

- [ ] **Step 1: Créer `apps/pos/package.json`**

```json
{
  "name": "@breakery/app-pos",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite --port 5173",
    "build": "tsc -b && vite build",
    "preview": "vite preview --port 5173",
    "lint": "eslint src",
    "typecheck": "tsc -b --noEmit",
    "test": "vitest run --coverage"
  },
  "dependencies": {
    "@breakery/domain": "workspace:*",
    "@breakery/supabase": "workspace:*",
    "@breakery/ui": "workspace:*",
    "@breakery/utils": "workspace:*",
    "@tanstack/react-query": "^5.62.11",
    "@sentry/react": "^10.47.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-router-dom": "^6.28.0",
    "zustand": "^4.5.5",
    "@fontsource-variable/inter": "^5.1.1",
    "@fontsource-variable/fraunces": "^5.1.1",
    "@fontsource-variable/jetbrains-mono": "^5.1.2"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.9.1",
    "@testing-library/react": "^16.3.1",
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "@vitejs/plugin-react": "^4.3.4",
    "@vitest/coverage-v8": "^2.1.9",
    "autoprefixer": "^10.4.20",
    "jsdom": "^26.0.0",
    "postcss": "^8.4.49",
    "tailwindcss": "^3.4.17",
    "vite": "^5.4.11",
    "vite-plugin-pwa": "^1.0.0",
    "vitest": "^2.1.9"
  }
}
```

- [ ] **Step 2: Créer `apps/pos/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] }
  },
  "include": ["src/**/*"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

- [ ] **Step 3: Créer `apps/pos/tsconfig.node.json`**

```json
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "allowSyntheticDefaultImports": true,
    "strict": true
  },
  "include": ["vite.config.ts", "vitest.config.ts", "tailwind.config.ts", "postcss.config.js"]
}
```

- [ ] **Step 4: Créer `apps/pos/vite.config.ts`** (PWA désactivée pour bootstrap, activée Phase 5)

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') }
  },
  server: { port: 5173, host: true }
});
```

- [ ] **Step 5: Créer `apps/pos/postcss.config.js`**

```js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {}
  }
};
```

- [ ] **Step 6: Créer `apps/pos/tailwind.config.ts`**

```ts
import type { Config } from 'tailwindcss';
import preset from '@breakery/ui/tailwind-preset';

export default {
  presets: [preset],
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
    '../../packages/ui/src/**/*.{ts,tsx}'
  ]
} satisfies Config;
```

- [ ] **Step 7: Créer `apps/pos/index.html`**

```html
<!doctype html>
<html lang="en" class="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
    <title>The Breakery POS</title>
  </head>
  <body class="bg-bg-base text-text-primary">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 8: Créer `apps/pos/src/index.css`**

```css
@import '@breakery/ui/tokens.css';
@import '@fontsource-variable/inter';
@import '@fontsource-variable/fraunces';
@import '@fontsource-variable/jetbrains-mono';
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 9: Créer `apps/pos/src/main.tsx`**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element #root not found');

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

- [ ] **Step 10: Créer `apps/pos/src/App.tsx`**

```tsx
export default function App() {
  return (
    <main className="min-h-screen grid place-items-center">
      <h1 className="text-3xl">The Breakery POS — boot OK</h1>
    </main>
  );
}
```

- [ ] **Step 11: Créer `apps/pos/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') }
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/main.tsx', 'src/**/*.test.{ts,tsx}']
    }
  }
});
```

- [ ] **Step 12: Créer `apps/pos/vitest.setup.ts`**

```ts
import '@testing-library/jest-dom';
```

- [ ] **Step 13: Verify boot**

```bash
pnpm install
pnpm --filter @breakery/app-pos dev
```

Expected: Vite démarre sur `http://localhost:5173`, page affiche "The Breakery POS — boot OK". Stop le serveur (Ctrl+C).

- [ ] **Step 14: Commit**

```bash
git add apps/pos/ pnpm-lock.yaml
git commit -m "feat(pos): scaffold Vite SPA with tailwind + ui preset (boot OK)"
```

---

## Task 1.11 — Créer `apps/backoffice` (Vite + React + Tailwind, page Hello)

**Files:** Identique à Task 1.10 mais en remplaçant tous les `pos` par `backoffice`, port `5174`, et **sans `vite-plugin-pwa`** dans `package.json`.

- [ ] **Step 1: Dupliquer la structure de `apps/pos/` vers `apps/backoffice/`**

Reproduire chaque fichier de Task 1.10 avec ces ajustements :
- `package.json` : `name = "@breakery/app-backoffice"`, port `5174`, retirer `vite-plugin-pwa` des devDeps
- `vite.config.ts` : `server: { port: 5174 }`
- `index.html` : `<title>The Breakery Backoffice</title>`
- `src/App.tsx` : message "The Breakery Backoffice — boot OK"

- [ ] **Step 2: Verify boot**

```bash
pnpm install
pnpm --filter @breakery/app-backoffice dev
```

Expected: Vite démarre sur `http://localhost:5174`, page affiche "The Breakery Backoffice — boot OK".

- [ ] **Step 3: Commit**

```bash
git add apps/backoffice/ pnpm-lock.yaml
git commit -m "feat(backoffice): scaffold Vite SPA mirror of pos (boot OK)"
```

---

## Task 1.12 — Vérifier `pnpm dev` parallèle + lint + typecheck + build

- [ ] **Step 1: Run `pnpm dev`**

```bash
pnpm dev
```

Expected: Turborepo lance les 2 apps en parallèle. POS sur 5173, Backoffice sur 5174. Stop avec Ctrl+C.

- [ ] **Step 2: Run `pnpm lint`**

```bash
pnpm lint
```

Expected: 0 erreur, 0 warning sur tous les packages.

Si erreur sur `@typescript-eslint/no-unused-vars` (ex. `export {};`) : ajouter un export trivial dans les `index.ts` ou désactiver la règle pour ces fichiers. Préférer le premier.

- [ ] **Step 3: Run `pnpm typecheck`**

```bash
pnpm typecheck
```

Expected: 0 erreur.

- [ ] **Step 4: Run `pnpm build`**

```bash
pnpm build
```

Expected: `apps/pos/dist/`, `apps/backoffice/dist/` créés sans erreur. Bundles de qq KB chacun.

- [ ] **Step 5: Run `pnpm test`**

```bash
pnpm test
```

Expected: chaque package retourne "no tests found" — c'est OK pour cette phase, on ajoute les tests dans les phases suivantes.

Pour éviter que Turborepo échoue sur "no tests found", configurer Vitest avec `passWithNoTests: true` dans chaque `vitest.config.ts` :

```ts
test: {
  passWithNoTests: true,
  // ... reste
}
```

Refaire `pnpm test` pour confirmer.

- [ ] **Step 6: Commit fixups**

```bash
git add **/vitest.config.ts
git commit -m "chore(monorepo): add passWithNoTests to all vitest configs"
```

---

## Task 1.13 — Créer `.env.example` + README initial

**Files:**
- Create: `.env.example`
- Create: `README.md`

- [ ] **Step 1: Créer `.env.example`**

```bash
# Frontend (exposés au bundle, préfixe VITE_)
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=
VITE_SENTRY_DSN_POS=
VITE_SENTRY_DSN_BACKOFFICE=

# Edge Functions (Deno, secrets via `supabase secrets set`)
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_JWT_SECRET=
```

- [ ] **Step 2: Créer `README.md`**

```markdown
# The Breakery — ERP/POS Monorepo

Monorepo Turborepo + pnpm. 2 apps (`pos`, `backoffice`) + 4 packages partagés (`ui`, `supabase`, `domain`, `utils`).

## Prerequisites

- Node.js ≥ 22.12.0
- pnpm ≥ 9.0
- Supabase CLI ≥ 2.0
- Docker (pour `supabase start`)

## Setup

\`\`\`bash
pnpm install
cp .env.example .env
supabase start
supabase db reset
pnpm dev
\`\`\`

POS : http://localhost:5173
Backoffice : http://localhost:5174

## Scripts

| Command | Effect |
|---|---|
| \`pnpm dev\` | Démarre les 2 apps en parallèle |
| \`pnpm build\` | Build prod des 2 apps |
| \`pnpm lint\` | ESLint sur tout |
| \`pnpm typecheck\` | TypeScript strict |
| \`pnpm test\` | Vitest + couverture |
| \`pnpm db:reset\` | Reset DB Supabase locale + applique seed |
| \`pnpm db:types\` | Régénère types TS depuis schéma |

## Spec

Voir [\`docs/workplan/specs/2026-05-03-breakery-split-2apps-design.md\`](docs/workplan/specs/2026-05-03-breakery-split-2apps-design.md).
```

- [ ] **Step 3: Commit**

```bash
git add .env.example README.md
git commit -m "docs: add .env.example and initial README"
```

---

## Phase 1 — Done criteria

- [ ] `git log` montre ~13 commits propres
- [ ] `pnpm install` clean
- [ ] `pnpm dev` démarre POS:5173 + Backoffice:5174 avec messages "boot OK"
- [ ] `pnpm lint` 0 warning
- [ ] `pnpm typecheck` 0 erreur
- [ ] `pnpm build` produit `dist/` pour chaque app
- [ ] `pnpm test` passe (no tests yet)
- [ ] Structure : `apps/{pos,backoffice}/` + `packages/{ui,supabase,domain,utils}/` créés
- [ ] Frontières ESLint en place (interdiction d'imports cross-app et cross-layer)

**Next:** Phase 2 — Database (`2026-05-03-breakery-02-database.md`).
