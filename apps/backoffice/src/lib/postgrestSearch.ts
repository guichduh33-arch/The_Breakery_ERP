// Filtres PostgREST construits à partir d'une saisie (S1-13).
//
// Un filtre `.or()` est une chaîne que PostgREST relit : la virgule sépare les
// termes, la parenthèse ouvre un groupe, le guillemet cite une valeur, `*` et
// `%` sont des jokers. Une saisie concaténée telle quelle peut donc poser un
// autre prédicat que celui qu'on croit (`x%,deleted_at.not.is.null` élargit la
// recherche aux lignes supprimées). On RETIRE ces caractères plutôt que
// d'espérer un échappement correct à travers deux couches (URL, puis grammaire
// PostgREST) — même choix que la recherche B2B et la recherche clients.

const OR_FILTER_UNSAFE = /[,()*%_\\"]/g;
const SEARCH_MAX = 64;

/** Terme de recherche sûr dans un filtre `.or()` : caractères de structure et jokers retirés. */
export function sanitizeOrSearchTerm(raw: string): string {
  return raw.replace(OR_FILTER_UNSAFE, '').trim().slice(0, SEARCH_MAX);
}

/**
 * Construit `col1.ilike.%t%,col2.ilike.%t%`. Rend `null` quand le terme nettoyé
 * est vide : l'appelant ne pose alors aucun filtre, plutôt qu'un `%%` qui
 * ramènerait tout en se faisant passer pour une recherche.
 */
export function ilikeAnyFilter(columns: readonly string[], raw: string): string | null {
  const term = sanitizeOrSearchTerm(raw);
  if (term === '') return null;
  return columns.map((c) => `${c}.ilike.%${term}%`).join(',');
}

/**
 * Motif `ilike` d'égalité insensible à la casse, pour un filtre SIMPLE (`.ilike()`,
 * jamais `.or()`) : le client encode la valeur, seuls les jokers SQL restent à
 * neutraliser. `*`, que PostgREST lit aussi comme joker, ne peut pas s'échapper :
 * il peut élargir la correspondance, et l'appelant doit contrôler l'égalité exacte.
 */
export function ilikeExactPattern(raw: string): string {
  return raw.replace(/[\\%_]/g, '\\$&');
}
