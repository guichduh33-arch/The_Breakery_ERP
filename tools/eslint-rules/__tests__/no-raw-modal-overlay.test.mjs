// tools/eslint-rules/__tests__/no-raw-modal-overlay.test.mjs
//
// Session 22 / Phase 1.A.2 — RuleTester suite for `no-raw-modal-overlay`.
//
// We use Node's built-in test runner (`node:test`) — keeping this dependency-free
// and avoiding pulling Vitest into a tools/ workspace that isn't part of the
// pnpm graph. ESLint v8 ships its own `RuleTester` which is used to validate
// both the rule meta and reported messages.
//
// Cases covered (≥ 5) :
//   valid :
//     1. file under `packages/ui/...` — exempt by path
//     2. file under `apps/pos/...` — `<div className="sticky top-0 z-10">` (different pattern)
//     3. file under `apps/pos/...` — `<div className="fixed top-0">` (only one token)
//   invalid :
//     4. file under `apps/pos/...` — `<div className="fixed inset-0">`
//     5. file under `apps/backoffice/...` — `<div className="z-50 fixed inset-0 bg-black/50">`
//     6. file under `apps/backoffice/...` — `<div style={{position:'fixed', inset: 0}}>`
//     7. file under `packages/domain/...` — raw overlay (extra coverage)

import { RuleTester } from 'eslint';
import { test } from 'node:test';
import { noRawModalOverlay } from '../no-raw-modal-overlay.mjs';

// ESLint v8 default parser is `espree`. We enable JSX via parserOptions.
const tester = new RuleTester({
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
});

test('no-raw-modal-overlay rule', () => {
  tester.run('no-raw-modal-overlay', noRawModalOverlay, {
    valid: [
      // 1. exempt — packages/ui/ is the canonical home of modal primitives
      {
        name: 'exempt — packages/ui/ source file',
        filename: 'C:/repo/packages/ui/src/primitives/Dialog.tsx',
        code: `const C = () => <div className="fixed inset-0 z-50">x</div>;`,
      },
      // 2. apps/pos/ — different className pattern, no full-overlay tokens
      {
        name: 'apps/pos sticky header — not an overlay pattern',
        filename: 'C:/repo/apps/pos/src/foo.tsx',
        code: `const C = () => <div className="sticky top-0 z-10">x</div>;`,
      },
      // 3. apps/pos/ — only `fixed` without `inset-0` is allowed (positioned but not full-screen)
      {
        name: 'apps/pos partial fixed — fixed without inset-0',
        filename: 'C:/repo/apps/pos/src/foo.tsx',
        code: `const C = () => <div className="fixed top-0">x</div>;`,
      },
      // 4. apps/pos/ — style object with position fixed only (no inset)
      {
        name: 'apps/pos style with only position fixed — no inset',
        filename: 'C:/repo/apps/pos/src/foo.tsx',
        code: `const C = () => <div style={{position: 'fixed', top: 0}}>x</div>;`,
      },
    ],

    invalid: [
      // 4. apps/pos/ raw overlay in className
      {
        name: 'apps/pos raw overlay via className',
        filename: 'C:/repo/apps/pos/src/features/foo/CustomOverlay.tsx',
        code: `const C = () => <div className="fixed inset-0">x</div>;`,
        errors: [{ messageId: 'noRawModalOverlay' }],
      },
      // 5. apps/backoffice/ raw overlay in className with extra tokens
      {
        name: 'apps/backoffice raw overlay via className with extra tokens',
        filename: 'C:/repo/apps/backoffice/src/foo.tsx',
        code: `const C = () => <div className="z-50 fixed inset-0 bg-black/50">x</div>;`,
        errors: [{ messageId: 'noRawModalOverlay' }],
      },
      // 6. apps/backoffice/ raw overlay via inline style object
      {
        name: 'apps/backoffice raw overlay via inline style object',
        filename: 'C:/repo/apps/backoffice/src/foo.tsx',
        code: `const C = () => <div style={{position: 'fixed', inset: 0}}>x</div>;`,
        errors: [{ messageId: 'noRawModalOverlay' }],
      },
      // 7. packages/domain/ raw overlay (defensive coverage — domain should never own JSX
      // anyway but the rule must still flag if it ever happens)
      {
        name: 'packages/domain raw overlay (defensive)',
        filename: 'C:/repo/packages/domain/src/foo.tsx',
        code: `const C = () => <div className="fixed inset-0">x</div>;`,
        errors: [{ messageId: 'noRawModalOverlay' }],
      },
      // 8. apps/backoffice/ raw overlay via inline style with inset: '0' (string)
      {
        name: 'apps/backoffice raw overlay via inline style with inset:"0" string',
        filename: 'C:/repo/apps/backoffice/src/foo.tsx',
        code: `const C = () => <div style={{position: 'fixed', inset: '0'}}>x</div>;`,
        errors: [{ messageId: 'noRawModalOverlay' }],
      },
    ],
  });
});
