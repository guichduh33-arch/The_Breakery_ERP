// apps/backoffice/src/lib/mutationErrorText.ts
//
// LE DÉFAUT QUE CE FICHIER FERME. Une mutation qui échoue sans `onError` et
// sur un écran qui ne rend pas `.error` ne dit RIEN : le `isPending` retombe,
// le contrôle se réarme, et l'écran montre encore la valeur voulue jusqu'au
// prochain refetch. L'utilisateur croit avoir enregistré. Relevé du
// 2026-08-20 : six mutations dans ce cas, dont les presets de caisse POS, le
// plafond de crédit d'un client et une ligne de recette (donc le COGS).
//
// DOCTRINE, reprise de `exportErrorDetail` (PR #431) et généralisée : on ne
// montre JAMAIS à l'écran ce qu'on n'a pas su traduire. Trois interdits :
//  · pas de « [object Object] » — une erreur Supabase est un objet nu, pas une
//    `Error`, donc `String(e)` la rend littéralement comme ça ;
//  · pas de jeton machine (`permission_denied`, `23505`) — un code ne dit pas
//    à un gérant ce qu'il doit en conclure ;
//  · pas de nom de contrainte Postgres.
// Quand rien n'est traduisible, on rend la phrase générique. Taire un jeton
// vaut mieux que le montrer.

/** Codes Postgres et codes de garde rencontrés par le back-office.
 *  Une entrée se paie d'une phrase complète, pas d'un mot. */
const ERROR_PHRASES: Readonly<Record<string, string>> = {
  // Droits
  '42501':             'You do not have permission to do this.',
  permission_denied:   'You do not have permission to do this.',
  // Session
  authorization_required: 'Your session has expired. Sign in again.',
  invalid_auth:           'Your session has expired. Sign in again.',
  // Intégrité
  '23505': 'That value already exists. Use a different one.',
  '23503': 'Another record still refers to this one, so it cannot be changed.',
  '23514': 'The server rejected these values as invalid.',
  '23502': 'A required value is missing.',
  // Réseau
  FetchError:  'The server could not be reached. Check the connection.',
  NetworkError:'The server could not be reached. Check the connection.',
};

/** Phrase de dernier recours. Elle dit ce qui s'est passé ET ce que ça
 *  implique — « Failed » seul laisse croire à un problème d'affichage. */
export const GENERIC_MUTATION_ERROR = 'That change was not saved. Try again.';

/** Un jeton machine : snake_case, SCREAMING_CASE ou code Postgres à 5
 *  caractères. On les tait — ils n'apprennent rien à un gérant. */
function isMachineToken(s: string): boolean {
  return /^[A-Za-z0-9]+(_[A-Za-z0-9]+)+$/.test(s) || /^[0-9A-Z]{5}$/.test(s);
}

/** Lit `message` et `code` sur n'importe quoi, sans supposer une `Error`.
 *  Une `PostgrestError` de Supabase est un objet nu : elle a les deux champs
 *  mais n'hérite pas d'`Error`. */
function readShape(e: unknown): { message: string; code: string } {
  if (typeof e === 'string') return { message: e.trim(), code: '' };
  if (e instanceof Error) {
    const withCode = e as Error & { code?: unknown };
    return {
      message: e.message.trim(),
      code: typeof withCode.code === 'string' ? withCode.code : '',
    };
  }
  if (typeof e === 'object' && e !== null) {
    const o = e as { message?: unknown; code?: unknown };
    return {
      message: typeof o.message === 'string' ? o.message.trim() : '',
      code: typeof o.code === 'string' ? o.code : '',
    };
  }
  return { message: '', code: '' };
}

/**
 * Rend une phrase lisible pour n'importe quelle valeur rejetée.
 *
 * Ordre de résolution :
 *  1. le `code` connu → sa phrase ;
 *  2. le `message` qui EST un code connu → sa phrase ;
 *  3. le `message` qui CONTIENT un code connu → sa phrase (les erreurs de
 *     RPC arrivent souvent enveloppées, « ... 42501 ... ») ;
 *  4. une vraie phrase (elle contient une espace et n'est pas un jeton) → telle
 *     quelle ;
 *  5. sinon la phrase générique.
 *
 * Ne rend jamais de chaîne vide, jamais « [object Object] », jamais un jeton.
 */
export function mutationErrorText(e: unknown): string {
  const { message, code } = readShape(e);

  const byCode = ERROR_PHRASES[code];
  if (byCode !== undefined) return byCode;

  if (message === '') return GENERIC_MUTATION_ERROR;

  const byMessage = ERROR_PHRASES[message];
  if (byMessage !== undefined) return byMessage;

  for (const key of Object.keys(ERROR_PHRASES)) {
    if (message.includes(key)) return ERROR_PHRASES[key]!;
  }

  if (isMachineToken(message)) return GENERIC_MUTATION_ERROR;
  if (message === '[object Object]') return GENERIC_MUTATION_ERROR;

  return message;
}
