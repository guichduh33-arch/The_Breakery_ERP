import tseslint from 'typescript-eslint';
import reactPlugin from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import importPlugin from 'eslint-plugin-import';
import breakeryLocal from './tools/eslint-rules/no-raw-modal-overlay.mjs';

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
      import: importPlugin,
      'breakery-local': breakeryLocal
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
      // Session 22 / Phase 1.A.2 — Forbids raw fullscreen overlay <div>s
      // (`className="fixed inset-0"` or `style={{position:'fixed', inset: 0}}`)
      // outside `packages/ui/**`. Forces consumers through Radix-backed modal
      // primitives that handle focus-trap + Esc + a11y for free.
      'breakery-local/no-raw-modal-overlay': 'error',
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
