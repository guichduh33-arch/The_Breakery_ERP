// apps/backoffice/src/__tests__/no-unbound-supabase-rpc.test.ts
// Regression guard C1 (audit 2026-06-12): forbids extracting supabase.rpc
// without .bind(supabase) — an unbound call crashes with "reading 'rest'".
//
// Allowed  :  (supabase.rpc as X)(...)           ← inline cast, binding preserved
// Forbidden:  = supabase.rpc as X                ← extraction without bind
//             return supabase.rpc as X            ← extraction without bind

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '..');

// Matches `= supabase.rpc as` and `return supabase.rpc as` WITHOUT .bind.
// Inline casts like `(supabase.rpc as ...)(` are NOT matched (binding intact).
const UNBOUND = /(?:=|return)\s+supabase\.rpc\s+as\s/;

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      // skip the __tests__ folders themselves
      if (entry.name !== '__tests__') walk(full, acc);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

describe('no unbound supabase.rpc extraction', () => {
  it('every file binds supabase.rpc before extracting it', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const text = readFileSync(file, 'utf8');
      if (UNBOUND.test(text)) {
        // Report relative path for readability
        offenders.push(file.replace(SRC + '/', '').replace(SRC + '\\', ''));
      }
    }
    expect(offenders).toEqual([]);
  });
});
