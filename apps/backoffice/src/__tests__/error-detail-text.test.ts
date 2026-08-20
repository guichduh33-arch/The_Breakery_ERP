// apps/backoffice/src/__tests__/error-detail-text.test.ts
//
// FILET ANTI-RÉGRESSION du lot « plus jamais [object Object] à l'écran »
// (2026-08-20). Sept surfaces rendaient `{String(error)}` ; une
// `PostgrestError` de Supabase est un objet nu, donc l'écran affichait
// littéralement « Failed to load count: [object Object] » (vu au navigateur).
//
// Deux invariants :
//  1. `errorDetailText` ne rend jamais quelque chose d'illisible ;
//  2. plus aucun fichier de l'app ne rend `String(<quelque chose>.error)` —
//     c'est ce second test qui empêche la classe de repousser, parce que la
//     correction d'origine n'avait fermé que 2 des 7 sites.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { errorDetailText } from '../components/errorDetailText.js';

describe('errorDetailText', () => {
  it('tait une PostgrestError nue plutôt que de rendre un objet', () => {
    // L'objet exact que Supabase rejette : pas une Error, message vide.
    expect(errorDetailText({ message: '', code: '42501', details: null, hint: null }))
      .toBeUndefined();
  });

  it('ne laisse jamais sortir la chaîne « [object Object] »', () => {
    for (const input of [{}, [], Object.create(null), new Map(), 0, null, undefined]) {
      expect(errorDetailText(input)).toBeUndefined();
    }
    expect(errorDetailText('[object Object]')).toBeUndefined();
  });

  it('tait un jeton machine, qui n’apprend rien au lecteur', () => {
    expect(errorDetailText(new Error('opname_not_found'))).toBeUndefined();
    expect(errorDetailText(new Error('42501'))).toBeUndefined();
    expect(errorDetailText({ message: 'permission_denied' })).toBeUndefined();
  });

  it('laisse passer un vrai diagnostic serveur', () => {
    expect(errorDetailText(new Error('relation "opname_v2" does not exist')))
      .toBe('relation "opname_v2" does not exist');
    expect(errorDetailText({ message: 'JWT expired at 12:04' })).toBe('JWT expired at 12:04');
  });
});

describe('la classe de défaut est éteinte dans tout l’app', () => {
  const ROOT = join(__dirname, '..');
  const SKIP = new Set(['__tests__', 'node_modules']);

  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        if (!SKIP.has(name)) walk(p, out);
      } else if (/\.tsx?$/.test(name) && !name.includes('.test.')) {
        out.push(p);
      }
    }
    return out;
  }

  it('aucun fichier ne rend String(<…>.error) dans du JSX', () => {
    // Le commentaire d'en-tête de `errorDetailText.ts` cite le motif ; on
    // masque donc les commentaires avant de chercher, sinon la garde
    // s'accuserait elle-même.
    const offenders: string[] = [];
    for (const file of walk(ROOT)) {
      const src = readFileSync(file, 'utf8')
        .replace(/\r/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^[ \t]*\/\/.*$/gm, '');
      if (/String\(\s*[A-Za-z_$][\w$.]*\berror\b[\w$.]*\s*\)/.test(src)) {
        offenders.push(file.slice(ROOT.length + 1));
      }
    }
    expect(offenders).toEqual([]);
  });
});
