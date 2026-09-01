import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  VirtualKeypadContext,
  type VkpLayout,
  type VkpTarget,
} from '../hooks/useVirtualKeypad.js';
import { QwertyLayout } from './QwertyLayout.js';
import { Numpad } from './Numpad.js';
import { cn } from '../lib/cn.js';

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
  // Incrémenté à CHAQUE ouverture — `layout` seul ne suffit pas à déclencher
  // le recentrage quand on passe d'un champ qwerty à un autre champ qwerty.
  const [openSeq, setOpenSeq] = useState(0);
  // Valeur COURANTE du champ visé, en state. `Numpad` est contrôlé : il la lisait
  // dans `targetRef`, que React ne resurveille jamais — le pavé restait donc figé
  // sur la valeur d'OUVERTURE (le plus souvent vide) et chaque touche écrasait la
  // précédente au lieu de s'y ajouter. Mesuré au navigateur le 2026-09-01 : « 5 »
  // puis « 0 » donnait « 0 ». Défaut préexistant sur les volets QRIS et Card.
  const [targetValue, setTargetValue] = useState('');
  const targetRef = useRef<VkpTarget | null>(null);

  const openFor = useCallback((el: VkpTarget, l: VkpLayout) => {
    targetRef.current = el;
    setPortalEl(el.closest<HTMLElement>('[role="dialog"]') ?? null);
    setLayout(l);
    setTargetValue(el.value);
    setOpenSeq((n) => n + 1);
  }, []);
  const close = useCallback(() => {
    // Audit 2026-08-24 (a11y P1) — restaurer l'inputmode d'origine : le 'none'
    // posé au focusin restait pour toujours, et si l'overlay ne se remontait
    // pas (champ déjà focus), le champ n'avait PLUS AUCUN clavier sur tablette.
    const el = targetRef.current;
    if (el) {
      const prev = el.dataset.vkpPrevInputmode;
      if (prev === undefined || prev === '') el.removeAttribute('inputmode');
      else el.setAttribute('inputmode', prev);
      delete el.dataset.vkpPrevInputmode;
    }
    setLayout(null);
    setPortalEl(null);
    setTargetValue('');
    targetRef.current = null;
  }, []);

  useEffect(() => {
    const onFocusIn = (e: FocusEvent): void => {
      const el = e.target as HTMLElement;
      if (
        (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) &&
        el.dataset.vkp
      ) {
        // Capturé AVANT l'écrasement, restauré par close().
        el.dataset.vkpPrevInputmode ??= el.getAttribute('inputmode') ?? '';
        el.setAttribute('inputmode', 'none'); // suppress native iOS keyboard
        openFor(el, el.dataset.vkp as VkpLayout);
      }
    };
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, [openFor]);

  // Une seule source de vérité pour `targetValue` : l'évènement `input` du champ
  // lui-même. Il couvre nos propres écritures (setInputValue en émet un) ET la
  // frappe au clavier physique, donc le pavé ne peut pas se désynchroniser.
  useEffect(() => {
    if (!layout) return undefined;
    const el = targetRef.current;
    if (!el) return undefined;
    const sync = (): void => setTargetValue(el.value);
    el.addEventListener('input', sync);
    return () => el.removeEventListener('input', sync);
  }, [layout, openSeq]);

  // Mesuré au navigateur le 2026-09-01 sur Close Shift : le clavier ne
  // recouvre plus le champ (il est en flux), mais le champ visé peut se
  // retrouver DÉFILÉ HORS DE VUE dans la carte, puisque celle-ci rétrécit pour
  // faire de la place. On le ramène donc au centre après que l'overlay a pris
  // sa place (rAF = après la pose du layout). `?.` : jsdom n'implémente pas
  // scrollIntoView, les tests unitaires ne doivent pas tomber dessus.
  useEffect(() => {
    if (!layout) return undefined;
    const el = targetRef.current;
    if (!el) return undefined;
    const id = requestAnimationFrame(() => {
      el.scrollIntoView?.({ block: 'center', behavior: 'auto' });
    });
    return () => cancelAnimationFrame(id);
  }, [layout, openSeq]);

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
      className={cn(
        'z-50 bg-bg-elevated border-t border-border-subtle p-4 shadow-modal',
        // Mesuré au navigateur le 2026-09-01, viewport 1280x800 : `fixed` est
        // FAUX dès que l'overlay est portalisé dans un dialogue.
        //   - Radix DialogContent (Customer) porte `translate-x-[-50%]`. Un
        //     transform crée un bloc conteneur pour les descendants `fixed` :
        //     le clavier se dimensionnait sur la modale (561 px au lieu de
        //     1280), se posait EN PLEIN MILIEU (top=392) et `overflow-y-auto`
        //     le tronquait.
        //   - FullScreenModal (Close Shift) n'a pas de transform, mais le
        //     clavier flottait PAR-DESSUS la carte et en masquait 228 px.
        // `sticky` échappe aux deux pièges : insensible au transform d'un
        // ancêtre, jamais rogné par son conteneur de défilement, et surtout il
        // occupe une vraie place — la carte rétrécit au lieu d'être recouverte.
        // Hors dialogue (recherche produit), il n'y a ni transform ni conteneur
        // de défilement dédié : `fixed` reste le bon comportement.
        portalEl ? 'sticky bottom-0 shrink-0' : 'fixed inset-x-0 bottom-0',
      )}
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
            value={targetValue}
            onChange={(next) => {
              const el = targetRef.current;
              if (el) setInputValue(el, next);
            }}
          />
          <button
            type="button"
            onClick={close}
            className="mt-3 w-full h-touch-comfy rounded-md bg-gold text-gold-fg font-semibold"
          >
            Done
          </button>
        </div>
      )}
    </div>
  );

  // Lot 5 — openFor/close sont stables (useCallback) : mémoïser l'objet évite
  // de re-rendre tous les consommateurs du contexte à chaque render du provider.
  const ctxValue = useMemo(() => ({ openFor, close }), [openFor, close]);

  return (
    <VirtualKeypadContext.Provider value={ctxValue}>
      {children}
      {/* Dans un dialogue, l'overlay est un enfant DE FLUX (`sticky`) : la
          cible du portail détermine donc aussi sa mise en page, pas seulement
          son ascendance DOM comme avant le 2026-09-01. C'est voulu — c'est ce
          qui fait rétrécir la modale au lieu de la laisser recouvrir. Hors
          dialogue, il reste `fixed` et n'affecte aucune mise en page. */}
      {overlay && (portalEl ? createPortal(overlay, portalEl) : overlay)}
    </VirtualKeypadContext.Provider>
  );
}
