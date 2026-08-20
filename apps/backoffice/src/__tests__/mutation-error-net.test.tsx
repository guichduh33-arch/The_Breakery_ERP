// apps/backoffice/src/__tests__/mutation-error-net.test.tsx
//
// FILET ANTI-RÉGRESSION du lot « aucune mutation ne meurt en silence »
// (2026-08-20). Deux invariants, et ils tirent dans des sens opposés — c'est
// pour ça qu'ils vivent dans le même fichier :
//
//  1. une mutation SANS `onError` produit un toast lisible (le trou qu'on ferme) ;
//  2. une mutation AVEC `onError` n'en produit PAS (le filet ne doit pas
//     doubler les ~45 surfaces d'erreur déjà écrites).
//
// Et la phrase montrée ne doit jamais être un objet ni un jeton machine —
// c'est la doctrine posée par `exportErrorDetail` (PR #431), généralisée ici.

import type { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const toastError = vi.fn();
vi.mock('sonner', () => ({ toast: { error: (m: string) => { toastError(m); } } }));

// On teste LE client expédié, pas une recopie de sa politique : un test qui
// réécrit la règle qu'il vérifie reste vert quand le fichier réel dérive.
const { queryClient } = await import('../lib/queryClient.js');
const { GENERIC_MUTATION_ERROR, mutationErrorText } = await import('../lib/mutationErrorText.js');

function makeClient(): QueryClient { return queryClient; }

async function runFailingMutation(
  client: QueryClient,
  rejected: unknown,
  options: { onError?: () => void; meta?: Record<string, unknown> } = {},
): Promise<void> {
  const observerOptions = {
    // Rejeter autre chose qu'une `Error` EST le sujet du test : une
    // `PostgrestError` de Supabase est un objet nu, et c'est elle qui produisait
    // « [object Object] » à l'écran.
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
    mutationFn: () => Promise.reject(rejected),
    retry: false as const,
    ...options,
  };
  await client.getMutationCache()
    .build(client, observerOptions)
    .execute(undefined)
    .catch(() => { /* l'échec est le sujet du test */ });
}

describe('filet global d’erreur de mutation', () => {
  beforeEach(() => { toastError.mockClear(); });

  it('toaste une phrase quand la mutation n’a pas de onError', async () => {
    await runFailingMutation(makeClient(), new Error('permission_denied'));
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledWith('You do not have permission to do this.');
  });

  it('se tait quand l’appelant déclare son propre onError', async () => {
    const own = vi.fn();
    await runFailingMutation(makeClient(), new Error('boom'), { onError: own });
    expect(own).toHaveBeenCalledTimes(1);
    expect(toastError).not.toHaveBeenCalled();
  });

  it('se tait sur l’opt-out nommé meta.errorHandled', async () => {
    await runFailingMutation(makeClient(), new Error('boom'), { meta: { errorHandled: true } });
    expect(toastError).not.toHaveBeenCalled();
  });

  it('ne montre jamais « [object Object] » pour une erreur Supabase nue', async () => {
    // Une PostgrestError n’hérite PAS d’Error : c’est un objet nu.
    const postgrestError = { message: '', code: '23505', details: null, hint: null };
    await runFailingMutation(makeClient(), postgrestError);
    const shown = toastError.mock.calls[0]?.[0] as string;
    expect(shown).toBe('That value already exists. Use a different one.');
    expect(shown).not.toContain('object Object');
  });
});

describe('mutationErrorText', () => {
  it('traduit un code Postgres porté par le champ code', () => {
    expect(mutationErrorText({ code: '42501', message: '' }))
      .toBe('You do not have permission to do this.');
  });

  it('traduit un code enveloppé dans une phrase de RPC', () => {
    expect(mutationErrorText(new Error('rpc failed: 42501 for relation orders')))
      .toBe('You do not have permission to do this.');
  });

  it('laisse passer une vraie phrase venue du serveur', () => {
    expect(mutationErrorText(new Error('Cash drawer is already closed for today.')))
      .toBe('Cash drawer is already closed for today.');
  });

  it('tait un jeton machine inconnu plutôt que de le montrer', () => {
    expect(mutationErrorText(new Error('combo_price_mismatch'))).toBe(GENERIC_MUTATION_ERROR);
    expect(mutationErrorText(new Error('P0001'))).toBe(GENERIC_MUTATION_ERROR);
  });

  it('ne rend jamais une chaîne vide ni un objet, quelle que soit l’entrée', () => {
    for (const input of [undefined, null, 0, [], {}, new Error(''), '   ']) {
      const out = mutationErrorText(input);
      expect(out.length).toBeGreaterThan(0);
      expect(out).not.toContain('object Object');
    }
  });
});
