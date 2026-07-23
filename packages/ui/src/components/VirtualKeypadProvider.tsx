import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  VirtualKeypadContext,
  type VkpLayout,
  type VkpTarget,
} from '../hooks/useVirtualKeypad.js';
import { QwertyLayout } from './QwertyLayout.js';
import { Numpad } from './Numpad.js';

/** Writes a value into an input/textarea via the native setter so React onChange fires. */
function setInputValue(el: VkpTarget, next: string): void {
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const desc = Object.getOwnPropertyDescriptor(proto, 'value');
  desc?.set?.call(el, next);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

export function VirtualKeypadProvider({ children }: { children: ReactNode }) {
  const [layout, setLayout] = useState<VkpLayout | null>(null);
  // DEV-S35-E3-01 — when the focused input lives inside a Radix Dialog, portal
  // the overlay INTO that dialog's content node. Radix marks everything OUTSIDE
  // the open dialog as aria-hidden ; an overlay rendered at the provider root
  // (a dialog sibling) would inherit it and be silenced for screen readers.
  // Portaling it as a dialog descendant keeps it announced. null → render inline.
  const [portalEl, setPortalEl] = useState<HTMLElement | null>(null);
  const targetRef = useRef<VkpTarget | null>(null);

  const openFor = useCallback((el: VkpTarget, l: VkpLayout) => {
    targetRef.current = el;
    setPortalEl(el.closest<HTMLElement>('[role="dialog"]') ?? null);
    setLayout(l);
  }, []);
  const close = useCallback(() => {
    setLayout(null);
    setPortalEl(null);
    targetRef.current = null;
  }, []);

  useEffect(() => {
    const onFocusIn = (e: FocusEvent): void => {
      const el = e.target as HTMLElement;
      if (
        (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) &&
        el.dataset.vkp
      ) {
        el.setAttribute('inputmode', 'none'); // suppress native iOS keyboard
        openFor(el, el.dataset.vkp as VkpLayout);
      }
    };
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, [openFor]);

  const writeKey = (c: string): void => {
    const el = targetRef.current;
    if (el) setInputValue(el, el.value + c);
  };
  const backspace = (): void => {
    const el = targetRef.current;
    if (el) setInputValue(el, el.value.slice(0, -1));
  };

  const overlay = layout && (
    <div
      data-testid="vkp-overlay"
      className="fixed inset-x-0 bottom-0 z-50 bg-bg-elevated border-t border-border-subtle p-4 shadow-modal"
      role="dialog"
      aria-label="Virtual keyboard"
    >
      {layout === 'qwerty' ? (
        <QwertyLayout
          onKey={writeKey}
          onBackspace={backspace}
          onSpace={() => writeKey(' ')}
          onDone={close}
        />
      ) : (
        <div className="max-w-xs mx-auto">
          <Numpad
            value={targetRef.current?.value ?? ''}
            onChange={(next) => {
              const el = targetRef.current;
              if (el) setInputValue(el, next);
            }}
          />
          <button
            type="button"
            onClick={close}
            className="mt-3 w-full h-touch-comfy rounded-md bg-gold text-black font-semibold"
          >
            Done
          </button>
        </div>
      )}
    </div>
  );

  return (
    <VirtualKeypadContext.Provider value={{ openFor, close }}>
      {children}
      {/* Position is `fixed` (viewport-relative) so the portal parent never
          affects layout — only the DOM ancestry, which is what a11y needs. */}
      {overlay && (portalEl ? createPortal(overlay, portalEl) : overlay)}
    </VirtualKeypadContext.Provider>
  );
}
