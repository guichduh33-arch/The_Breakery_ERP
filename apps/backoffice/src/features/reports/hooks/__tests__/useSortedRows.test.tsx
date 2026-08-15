// apps/backoffice/src/features/reports/hooks/__tests__/useSortedRows.test.tsx
//
// Lot G (campagne Reports 2026-08-15) — le contrat du tri de colonne. Trois
// règles se verrouillent ici parce qu'elles sont contre-intuitives et qu'un
// « nettoyage » ultérieur les casserait sans que rien ne s'en aperçoive :
// l'état nul rend l'ORDRE SERVEUR intact, le tri est STABLE, et une valeur
// ABSENTE reste en bas dans les DEUX sens.

import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSortedRows, compareRows, type SortSpec } from '../useSortedRows.js';

interface Row {
  id:    string;
  name:  string;
  qty:   number | null;
  at:    string;
  group: string;
}

const SPECS: Record<'name' | 'qty' | 'at' | 'group', SortSpec<Row>> = {
  name:  { kind: 'string', value: (r) => r.name },
  qty:   { kind: 'number', value: (r) => r.qty },
  at:    { kind: 'date',   value: (r) => r.at },
  group: { kind: 'string', value: (r) => r.group },
};

// Ordre serveur volontairement « désordonné » sur chaque axe.
const ROWS: Row[] = [
  { id: 'a', name: 'Item 10', qty: 5,    at: '2026-08-03T10:00:00Z', group: 'x' },
  { id: 'b', name: 'Item 9',  qty: null, at: '2026-08-01T10:00:00Z', group: 'x' },
  { id: 'c', name: 'Éclair',  qty: 12,   at: '2026-08-05T10:00:00Z', group: 'y' },
  { id: 'd', name: 'eclair',  qty: 1,    at: '2026-08-02T10:00:00Z', group: 'x' },
];

const ids = (rows: Row[]): string[] => rows.map((r) => r.id);

describe('useSortedRows — état nul = ordre serveur', () => {
  it('rend le TABLEAU D\'ORIGINE tant que rien n\'est trié (pas même une copie)', () => {
    const { result } = renderHook(() => useSortedRows(ROWS, SPECS));
    expect(result.current.sort).toBeNull();
    expect(result.current.rows).toBe(ROWS);
    expect(result.current.ariaSort('name')).toBe('none');
  });

  it('cycle asc → desc → retour à l\'ordre serveur sur la même colonne', () => {
    const { result } = renderHook(() => useSortedRows(ROWS, SPECS));

    act(() => { result.current.toggle('qty'); });
    expect(result.current.sort).toEqual({ key: 'qty', dir: 'asc' });
    expect(result.current.ariaSort('qty')).toBe('ascending');

    act(() => { result.current.toggle('qty'); });
    expect(result.current.sort).toEqual({ key: 'qty', dir: 'desc' });
    expect(result.current.ariaSort('qty')).toBe('descending');

    act(() => { result.current.toggle('qty'); });
    expect(result.current.sort).toBeNull();
    expect(result.current.rows).toBe(ROWS);
  });

  it('changer de colonne repart en ascendant, et l\'ancienne retombe à "none"', () => {
    const { result } = renderHook(() => useSortedRows(ROWS, SPECS));
    act(() => { result.current.toggle('qty'); });
    act(() => { result.current.toggle('qty'); });   // desc
    act(() => { result.current.toggle('name'); });
    expect(result.current.sort).toEqual({ key: 'name', dir: 'asc' });
    expect(result.current.ariaSort('qty')).toBe('none');
  });

  it('`reset` ramène à l\'ordre serveur sans passer par le cycle', () => {
    const { result } = renderHook(() => useSortedRows(ROWS, SPECS));
    act(() => { result.current.toggle('at'); });
    act(() => { result.current.reset(); });
    expect(result.current.sort).toBeNull();
    expect(result.current.rows).toBe(ROWS);
  });
});

describe('useSortedRows — comparateurs', () => {
  it('number : ordre numérique, pas lexicographique', () => {
    const { result } = renderHook(() => useSortedRows(ROWS, SPECS));
    act(() => { result.current.toggle('qty'); });
    // 1, 5, 12 — puis le null. « 12 » avant « 5 » trahirait un tri de chaînes.
    expect(ids(result.current.rows)).toEqual(['d', 'a', 'c', 'b']);
  });

  it('date : ordre chronologique', () => {
    const { result } = renderHook(() => useSortedRows(ROWS, SPECS));
    act(() => { result.current.toggle('at'); });
    expect(ids(result.current.rows)).toEqual(['b', 'd', 'a', 'c']);
    act(() => { result.current.toggle('at'); });
    expect(ids(result.current.rows)).toEqual(['c', 'a', 'd', 'b']);
  });

  it('string : collation métier — accents et casse ignorés, numérotation naturelle', () => {
    const { result } = renderHook(() => useSortedRows(ROWS, SPECS));
    act(() => { result.current.toggle('name'); });
    // « Éclair » et « eclair » se rangent ensemble (accent + casse ignorés) et
    // gardent leur ordre serveur ; « Item 9 » passe AVANT « Item 10 », ce qu'un
    // tri lexicographique ferait exactement à l'envers.
    expect(ids(result.current.rows)).toEqual(['c', 'd', 'b', 'a']);
  });
});

describe('useSortedRows — une valeur absente reste EN BAS dans les deux sens', () => {
  it('ascendant : le null ferme la marche', () => {
    const { result } = renderHook(() => useSortedRows(ROWS, SPECS));
    act(() => { result.current.toggle('qty'); });
    expect(result.current.rows[result.current.rows.length - 1]?.id).toBe('b');
  });

  it('descendant AUSSI : le null ne remonte pas en tête', () => {
    const { result } = renderHook(() => useSortedRows(ROWS, SPECS));
    act(() => { result.current.toggle('qty'); });
    act(() => { result.current.toggle('qty'); });
    expect(ids(result.current.rows)).toEqual(['c', 'a', 'd', 'b']);
  });
});

describe('useSortedRows — stabilité', () => {
  it('à valeur égale, les lignes gardent leur ordre serveur (asc ET desc)', () => {
    const { result } = renderHook(() => useSortedRows(ROWS, SPECS));

    act(() => { result.current.toggle('group'); });
    // Groupe « x » : a, b, d dans l'ordre d'origine ; puis « y » : c.
    expect(ids(result.current.rows)).toEqual(['a', 'b', 'd', 'c']);

    act(() => { result.current.toggle('group'); });
    // « y » remonte, mais l'intérieur du groupe « x » n'est PAS inversé.
    expect(ids(result.current.rows)).toEqual(['c', 'a', 'b', 'd']);
  });
});

describe('useSortedRows — robustesse', () => {
  it('une clé de tri inconnue rend l\'ordre serveur au lieu d\'exploser', () => {
    const { result } = renderHook(
      () => useSortedRows(ROWS, { name: SPECS.name } as Record<'name' | 'ghost', SortSpec<Row>>),
    );
    act(() => { result.current.toggle('ghost'); });
    expect(ids(result.current.rows)).toEqual(ids(ROWS));
  });

  it('une date illisible ne déplace pas la ligne', () => {
    const spec: SortSpec<{ at: string }> = { kind: 'date', value: (r) => r.at };
    expect(compareRows({ at: 'not-a-date' }, { at: 'nope' }, spec, 'asc')).toBe(0);
  });

  it('un tableau vide ou d\'un seul élément traverse le tri sans dommage', () => {
    const { result } = renderHook(() => useSortedRows<Row, 'qty'>([], { qty: SPECS.qty }));
    act(() => { result.current.toggle('qty'); });
    expect(result.current.rows).toEqual([]);
  });
});
