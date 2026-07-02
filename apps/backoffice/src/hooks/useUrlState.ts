// apps/backoffice/src/hooks/useUrlState.ts
//
// URL-backed state for filters that should survive a refresh and be shareable
// via a copied link (S57 D-D3). Thin wrapper over react-router's
// `useSearchParams`: the URL query string is the single source of truth.
//
// Two flavours cover the report-page needs:
//   - `useUrlState(key, default)`   — string values: ISO dates (YYYY-MM-DD),
//     active-tab names, section ids…
//   - `useUrlBoolean(key, default)` — checkbox flags (e.g. "compare to prev").
//
// Both prune the param when it equals the default, so a pristine page keeps a
// clean URL, and both use `replace: true` so filter tweaks don't spam history.
//
// Scope note: only report pages are converted in S57; orders/expenses/b2b stay
// on local state until a later session (see spec Non-goals).

import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

export function useUrlState(
  key: string,
  defaultValue: string,
): readonly [string, (next: string) => void] {
  const [params, setParams] = useSearchParams();
  const value = params.get(key) ?? defaultValue;

  const setValue = useCallback(
    (next: string) => {
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (next === defaultValue || next === '') p.delete(key);
          else p.set(key, next);
          return p;
        },
        { replace: true },
      );
    },
    [key, defaultValue, setParams],
  );

  return [value, setValue] as const;
}

export function useUrlBoolean(
  key: string,
  defaultValue = false,
): readonly [boolean, (next: boolean) => void] {
  const [raw, setRaw] = useUrlState(key, defaultValue ? '1' : '0');
  const value = raw === '1';
  const setValue = useCallback((next: boolean) => setRaw(next ? '1' : '0'), [setRaw]);
  return [value, setValue] as const;
}
