// apps/backoffice/src/features/reports/components/useDismissablePanel.ts
//
// Lot B (campagne Reports 2026-08-15) — mécanique commune des deux panneaux du
// bandeau (PeriodControl, ExportMenu) : fermeture au clic extérieur et à
// Échap, focus rendu au bouton déclencheur. `@breakery/ui` n'exporte pas de
// Popover (voir skill breakery-ui-kit) ; ce hook est le fallback maison, borné
// au module reports.

import { useEffect, useRef, useState } from 'react';

export function useDismissablePanel<T extends HTMLElement = HTMLDivElement>() {
  const [open, setOpen] = useState(false);
  const rootRef    = useRef<T | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (e: MouseEvent): void => {
      if (rootRef.current !== null && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return { open, setOpen, rootRef, triggerRef };
}
