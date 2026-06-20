import '@testing-library/jest-dom';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Mirror of apps/pos/vitest.setup.ts (DEV-S47-D3-02): explicit DOM teardown
// after every test. This project runs the suite WITHOUT file isolation (shared
// jsdom + module registry across files). React Testing Library's auto-cleanup
// self-registers its `afterEach(cleanup)` as a side-effect the first time
// `@testing-library/react` is imported — which, with a shared module cache,
// happens only during the FIRST test file. Subsequent files reuse the cached
// module, so the registration side-effect never runs for them and their DOM
// accumulates between tests (Radix Dialog/portal renders into document.body, so
// queries then match multiple elements). setupFiles run once per test file, so
// registering cleanup here guarantees teardown for EVERY file's suite.
afterEach(() => {
  cleanup();
});

// jsdom does not implement DragEvent (https://github.com/jsdom/jsdom/issues/1568).
// Without it, @testing-library/dom falls back to the plain Event constructor and
// silently drops MouseEvent init keys like `relatedTarget` from fireEvent.dragLeave.
// Minimal polyfill: a MouseEvent subclass preserves those keys; `dataTransfer` is
// still attached by testing-library via Object.defineProperty as before.
if (typeof window !== 'undefined' && typeof window.DragEvent === 'undefined') {
  class DragEventPolyfill extends MouseEvent {}
  window.DragEvent = DragEventPolyfill as unknown as typeof DragEvent;
}
