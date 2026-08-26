// apps/backoffice/src/features/accounting/utils/journalDescription.ts
//
// Les descriptions d'écriture sont rédigées par les triggers comptables et
// portent l'identifiant TECHNIQUE de l'entité concernée : « Stock movement
// adjustment for product f007e750-… ». Au relevé du 2026-08-26 sur la base de
// développement, 385 des 591 écritures en contenaient au moins un — la colonne
// Description était donc majoritairement illisible pour un comptable.
//
// La colonne STOCKÉE n'est pas touchée. Une description d'écriture est une
// trace : la réécrire ferait diverger ce qu'on montre de ce qui est journalisé,
// et un nom de produit renommé demain rendrait les anciennes lignes fausses. La
// substitution vit donc au RENDU seul, et l'UUID reste à un survol de distance.

/**
 * Un fragment de description à peindre. `uuid` non nul signale que `text` est
 * un nom résolu qui REMPLACE cet identifiant — l'appelant peut alors le
 * signaler visuellement et exposer l'original. `uuid` nul = texte tel quel,
 * identifiant non résolu compris.
 */
export interface DescriptionSegment {
  key:  number;
  text: string;
  uuid: string | null;
}

// `g` obligatoire pour `matchAll` (qui, lui, ne mute pas `lastIndex` de
// l'original : il travaille sur un clone). Aucune autre méthode de cette
// regexp n'est appelée ailleurs — un `.test()` sur une regexp globale garde un
// curseur entre deux appels et rendrait un résultat sur deux.
const UUID_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * Identifiants distincts présents dans un lot de descriptions, en minuscules.
 * L'appelant en fait une seule requête de résolution plutôt qu'une par ligne.
 */
export function collectUuids(descriptions: Iterable<string | null>): string[] {
  const seen = new Set<string>();
  for (const d of descriptions) {
    if (d === null || d === '') continue;
    for (const m of d.matchAll(UUID_RE)) seen.add(m[0].toLowerCase());
  }
  return [...seen];
}

/**
 * Découpe une description en fragments, en substituant les identifiants dont on
 * connaît le nom. Un identifiant non résolu reste écrit tel quel — mieux vaut
 * un UUID visible qu'un trou muet dans une phrase.
 */
export function segmentDescription(
  description: string,
  names: ReadonlyMap<string, string>,
): DescriptionSegment[] {
  const out: DescriptionSegment[] = [];
  let cut = 0;
  let key = 0;
  for (const m of description.matchAll(UUID_RE)) {
    const uuid = m[0];
    const name = names.get(uuid.toLowerCase());
    if (name === undefined || name === '') continue;
    const at = m.index;
    if (at > cut) out.push({ key: key++, text: description.slice(cut, at), uuid: null });
    out.push({ key: key++, text: name, uuid });
    cut = at + uuid.length;
  }
  if (out.length === 0) return [{ key: 0, text: description, uuid: null }];
  if (cut < description.length) {
    out.push({ key: key++, text: description.slice(cut), uuid: null });
  }
  return out;
}
