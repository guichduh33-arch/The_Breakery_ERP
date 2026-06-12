import '@testing-library/jest-dom';

// jsdom does not implement DragEvent (https://github.com/jsdom/jsdom/issues/1568).
// Without it, @testing-library/dom falls back to the plain Event constructor and
// silently drops MouseEvent init keys like `relatedTarget` from fireEvent.dragLeave.
// Minimal polyfill: a MouseEvent subclass preserves those keys; `dataTransfer` is
// still attached by testing-library via Object.defineProperty as before.
if (typeof window !== 'undefined' && typeof window.DragEvent === 'undefined') {
  class DragEventPolyfill extends MouseEvent {}
  window.DragEvent = DragEventPolyfill as unknown as typeof DragEvent;
}
