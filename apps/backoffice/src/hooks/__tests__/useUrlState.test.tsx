// apps/backoffice/src/hooks/__tests__/useUrlState.test.tsx
// Unit tests for the URL-backed state hooks (S57 D-D3).

import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useUrlState, useUrlBoolean } from '@/hooks/useUrlState.js';

function wrapperFor(initialEntry: string) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <MemoryRouter initialEntries={[initialEntry]}>{children}</MemoryRouter>;
  };
}

describe('useUrlState', () => {
  it('returns the default value when the param is absent', () => {
    const { result } = renderHook(() => useUrlState('start', '2026-01-01'), {
      wrapper: wrapperFor('/reports/sales'),
    });
    expect(result.current[0]).toBe('2026-01-01');
  });

  it('reads the value from the query string when present', () => {
    const { result } = renderHook(() => useUrlState('start', '2026-01-01'), {
      wrapper: wrapperFor('/reports/sales?start=2026-06-30'),
    });
    expect(result.current[0]).toBe('2026-06-30');
  });

  it('writes the value into the query string', () => {
    const { result } = renderHook(
      () => ({ state: useUrlState('start', '2026-01-01'), loc: useLocation() }),
      { wrapper: wrapperFor('/reports/sales') },
    );
    act(() => result.current.state[1]('2026-07-03'));
    expect(result.current.state[0]).toBe('2026-07-03');
    expect(result.current.loc.search).toContain('start=2026-07-03');
  });

  it('prunes the param from the URL when set back to the default', () => {
    const { result } = renderHook(
      () => ({ state: useUrlState('start', '2026-01-01'), loc: useLocation() }),
      { wrapper: wrapperFor('/reports/sales?start=2026-06-30') },
    );
    act(() => result.current.state[1]('2026-01-01'));
    expect(result.current.loc.search).not.toContain('start');
  });

  it('preserves sibling params when updating one key', () => {
    const { result } = renderHook(
      () => ({ state: useUrlState('end', '2026-01-31'), loc: useLocation() }),
      { wrapper: wrapperFor('/reports/sales?start=2026-06-01&end=2026-06-30') },
    );
    act(() => result.current.state[1]('2026-07-15'));
    expect(result.current.loc.search).toContain('start=2026-06-01');
    expect(result.current.loc.search).toContain('end=2026-07-15');
  });
});

describe('useUrlBoolean', () => {
  it('defaults to false and reflects "1" from the URL', () => {
    const off = renderHook(() => useUrlBoolean('compare'), {
      wrapper: wrapperFor('/reports/sales'),
    });
    expect(off.result.current[0]).toBe(false);

    const on = renderHook(() => useUrlBoolean('compare'), {
      wrapper: wrapperFor('/reports/sales?compare=1'),
    });
    expect(on.result.current[0]).toBe(true);
  });

  it('sets and prunes the flag', () => {
    const { result } = renderHook(
      () => ({ state: useUrlBoolean('compare'), loc: useLocation() }),
      { wrapper: wrapperFor('/reports/sales') },
    );
    act(() => result.current.state[1](true));
    expect(result.current.state[0]).toBe(true);
    expect(result.current.loc.search).toContain('compare=1');
    act(() => result.current.state[1](false));
    expect(result.current.loc.search).not.toContain('compare');
  });
});
