import '@testing-library/jest-dom';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Session 47 (DEV-S47-D3-02): explicit DOM teardown after every test.
//
// This project runs the POS suite WITHOUT file isolation (shared jsdom +
// module registry across files). React Testing Library's auto-cleanup
// self-registers its `afterEach(cleanup)` as a side-effect the first time
// `@testing-library/react` is imported — which, with a shared module cache,
// happens only during the FIRST test file. Subsequent files reuse the cached
// module, so the registration side-effect never runs for them and their DOM
// accumulates between tests (Radix Dialog portals into document.body, so
// queries like getByRole('checkbox', { name }) then match multiple elements).
//
// setupFiles run once per test file, so registering cleanup here guarantees
// teardown for EVERY file's suite regardless of module-import caching.
afterEach(() => {
  cleanup();
});
