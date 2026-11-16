import { describe, expect, it } from 'vitest';
import { ilikeAnyFilter, ilikeExactPattern, sanitizeOrSearchTerm } from '../postgrestSearch.js';

const HOSTILE = 'flour%,deleted_at.not.is.null),(id.gt.*"\\_';

describe('sanitizeOrSearchTerm', () => {
  it('removes every structural and wildcard character of an .or() filter', () => {
    const out = sanitizeOrSearchTerm(HOSTILE);
    expect(out).not.toMatch(/[,()*%_\\"]/);
    expect(out).toBe('flourdeletedat.not.is.nullid.gt.');
  });

  it('caps the term at 64 characters', () => {
    expect(sanitizeOrSearchTerm('a'.repeat(100))).toHaveLength(64);
  });
});

describe('ilikeAnyFilter', () => {
  it('builds one ilike term per column, and nothing else', () => {
    const filter = ilikeAnyFilter(['name', 'code'], HOSTILE);
    expect(filter).toBe('name.ilike.%flourdeletedat.not.is.nullid.gt.%,code.ilike.%flourdeletedat.not.is.nullid.gt.%');
    // Exactement deux termes : la saisie n'a pas pu en ajouter un troisième.
    expect(filter?.split(',')).toHaveLength(2);
  });

  it('returns null when nothing searchable is left, instead of a match-all %%', () => {
    expect(ilikeAnyFilter(['name'], ' ,)*% ')).toBeNull();
  });
});

describe('ilikeExactPattern', () => {
  it('escapes the SQL wildcards and the backslash', () => {
    expect(ilikeExactPattern('50%_off\\x')).toBe('50\\%\\_off\\\\x');
  });

  it('leaves structural characters alone: a simple filter value is encoded by the client', () => {
    expect(ilikeExactPattern('Ayu, Warung (Bali)')).toBe('Ayu, Warung (Bali)');
  });
});
