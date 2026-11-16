// Recherche d'un fournisseur de référence pour l'import historique (S1-13).
//
// L'ancienne version posait `.or(code.eq.<code>,name.ilike.<nom>)` avec les
// valeurs du paquet concaténées : un nom contenant une virgule ou une parenthèse
// réécrivait le filtre. Deux filtres SIMPLES à la place, dont le client encode
// les valeurs ; seuls les jokers SQL du nom restent à neutraliser. L'union est
// dédoublonnée par identifiant, et l'appelant garde son contrôle d'égalité exacte.

import { supabase } from '@/lib/supabase.js';
import { ilikeExactPattern } from '@/lib/postgrestSearch.js';
import type { SupplierReference } from './referencePackage.js';

const COLUMNS = 'id,code,name,is_active,deleted_at';

export interface SupplierReferenceRow {
  id: string;
  code: string | null;
  name: string;
  is_active: boolean;
  deleted_at: string | null;
}

export async function lookupSupplierReference(
  ref: SupplierReference,
  guard?: () => void,
): Promise<SupplierReferenceRow[]> {
  const byCode = await supabase.from('suppliers').select(COLUMNS).eq('code', ref.code);
  guard?.(); if (byCode.error) throw new Error(byCode.error.message);
  const byName = await supabase.from('suppliers').select(COLUMNS).ilike('name', ilikeExactPattern(ref.name));
  guard?.(); if (byName.error) throw new Error(byName.error.message);
  const rows = new Map<string, SupplierReferenceRow>();
  for (const s of [...byCode.data, ...byName.data]) rows.set(s.id, s);
  return [...rows.values()];
}
