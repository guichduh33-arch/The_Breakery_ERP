// apps/backoffice/src/components/errorDetailText.ts
//
// LE DÉFAUT QUE CE FICHIER FERME. Les deux écrans de comptage rendaient
// `{String(error)}` et affichaient donc, à l'écran, littéralement :
//
//     Failed to load count: [object Object]
//
// La cause n'est pas une étourderie : une `PostgrestError` de Supabase est un
// **objet nu**, elle n'hérite pas d'`Error`, donc `String()` tombe sur
// `Object.prototype.toString`. Un `String(error)` sur une erreur de requête
// Supabase produira TOUJOURS ça (relevé et vu au navigateur le 2026-08-20).
//
// Ce que la fonction rend est le `detail` de `QueryErrorBanner` : du
// DIAGNOSTIC, pas de l'information. La phrase humaine est écrite par
// l'appelant ; ici on se contente de ne jamais salir l'écran. Deux règles :
//  · rien qu'on n'a pas su lire ne sort — mieux vaut pas de détail qu'un objet ;
//  · un jeton machine seul (`opname_not_found`, `42501`) est tu : il n'apprend
//    rien au lecteur et la phrase de l'appelant dit déjà ce qui est en jeu.
//
// Même doctrine que `exportErrorDetail` (PR #431) et que `mutationErrorText` —
// trois surfaces, une seule règle : on ne montre que ce qu'on a su traduire.

/** Diagnostic serveur affichable, ou `undefined` quand il n'y a rien de
 *  lisible à montrer. Ne rend JAMAIS « [object Object] » ni un jeton machine. */
export function errorDetailText(e: unknown): string | undefined {
  const raw =
    typeof e === 'string' ? e
    : e instanceof Error ? e.message
    : typeof e === 'object' && e !== null && typeof (e as { message?: unknown }).message === 'string'
      ? (e as { message: string }).message
      : '';

  const msg = raw.trim();
  if (msg === '' || msg === '[object Object]') return undefined;
  // snake_case / SCREAMING_CASE, ou code Postgres à 5 caractères.
  if (/^[A-Za-z0-9]+(_[A-Za-z0-9]+)+$/.test(msg) || /^[0-9A-Z]{5}$/.test(msg)) return undefined;
  return msg;
}
