// apps/backoffice/src/features/dashboard/utils/usePrefersReducedMotion.ts
//
// Les animations d'entrée de recharts se désactivent par une PROP JS
// (`isAnimationActive`), pas par une classe : `motion-reduce:` — le levier
// habituel du projet — n'a aucune prise dessus. D'où ce hook.
//
// `matchMedia` peut manquer (jsdom sans polyfill) : on rend `false` plutôt que
// de faire tomber la page.

import { useEffect, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(QUERY);
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent): void => { setReduced(e.matches); };
    mq.addEventListener('change', onChange);
    return () => { mq.removeEventListener('change', onChange); };
  }, []);

  return reduced;
}
