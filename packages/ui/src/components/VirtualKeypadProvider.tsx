import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
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
  const targetRef = useRef<VkpTarget | null>(null);

  const openFor = useCallback((el: VkpTarget, l: VkpLayout) => {
    targetRef.current = el;
    setLayout(l);
  }, []);
  const close = useCallback(() => {
    setLayout(null);
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

  return (
    <VirtualKeypadContext.Provider value={{ openFor, close }}>
      {children}
      {layout && (
        <div
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
      )}
    </VirtualKeypadContext.Provider>
  );
}
