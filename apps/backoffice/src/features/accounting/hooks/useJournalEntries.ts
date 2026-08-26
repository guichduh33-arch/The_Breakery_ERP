// apps/backoffice/src/features/accounting/hooks/useJournalEntries.ts
//
// Journal entries — keyset paginé, SELECT direct sous la policy auth_read.
//
// DEUX défauts corrigés ici (critique du 2026-08-26), qui n'en faisaient qu'un
// aux yeux du comptable : la liste mentait sur son ordre ET sur sa taille.
//
//   1. L'ORDRE. Le tri était `entry_date DESC, id DESC` — `id` est un UUID v4,
//      donc les écritures d'une MÊME journée sortaient dans un ordre
//      arbitraire : JE-…-0040 pouvait précéder JE-…-0006. Le départage passe
//      sur `entry_number`, qui est UNIQUE NOT NULL et de largeur fixe
//      (`JE-YYYYMMDD-NNNN`, cf. `next_journal_entry_number`) : son ordre
//      lexicographique EST son ordre de création. Vérifié sur la base de
//      développement le 2026-08-26 — 591 écritures, format uniforme, et zéro
//      ligne dont le segment de date diverge de `entry_date`.
//
//   2. LA TAILLE. Un `.limit(200)` muet coupait la liste, et la page présentait
//      ces 200 lignes comme un total. On passe au régime de liste du
//      back-office (OrdersListPage, AuditPage, GeneralLedgerPage) : pages
//      keyset + « Load more », et le VRAI total demandé une seule fois — un
//      `count: 'exact'` sur la première page — pour que le pied de table écrive
//      « X loaded of Y » sans jamais faire passer un plafond pour un total.
//
// Le curseur est (entry_date, entry_number). `entry_number` étant unique, la
// paire l'est aussi : pas de doublon ni de trou entre deux pages, contrairement
// à un OFFSET qui décale dès qu'une écriture est postée pendant la lecture.

import { useInfiniteQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface JournalEntryRow {
  id:             string;
  entry_number:   string;
  entry_date:     string;
  description:    string | null;
  reference_type: string | null;
  reference_id:   string | null;
  status:         string;
  total_debit:    number;
  total_credit:   number;
  created_at:     string;
}

export interface JournalEntriesFilter {
  startDate?: string; // ISO YYYY-MM-DD
  endDate?:   string;
  /** Texte libre, cherché dans la description ET le numéro d'écriture. */
  search?: string;
  /** Famille d'émetteur — une valeur de `reference_type`. */
  referenceType?: string;
  /** Compte touché par au moins une ligne (`accounts.id`). */
  accountId?: string;
}

/** Position keyset de la dernière ligne rendue. */
export interface JournalEntriesCursor {
  entryDate:   string;
  entryNumber: string;
}

/** Une page de résultats. Nommée `Slice` et non `Page` : `JournalEntriesPage`
 *  est déjà le composant d'écran, et le barillet de la feature exporte les
 *  deux. */
export interface JournalEntriesSlice {
  rows: JournalEntryRow[];
  /**
   * Total des écritures qui satisfont le filtre. Demandé UNE seule fois, sur la
   * première page ; `null` sur les suivantes — le recompter à chaque « Load
   * more » ferait payer un `count` complet par cran sans rien apprendre.
   */
  total: number | null;
  nextCursor: JournalEntriesCursor | null;
}

export const JOURNAL_ENTRIES_KEY = ['accounting', 'journal-entries'] as const;
export const JOURNAL_ENTRIES_PAGE_SIZE = 100;

const COLUMNS =
  'id, entry_number, entry_date, description, reference_type, reference_id, status, total_debit, total_credit, created_at';

// Le curseur part dans une expression `or=` de PostgREST, qui est du TEXTE :
// une valeur porteuse de `,` `.` `(` `)` en changerait le sens. Les deux
// colonnes n'en contiennent pas, et ces gardes le rendent explicite plutôt
// qu'espéré — une valeur hors forme arrête la pagination au lieu d'émettre une
// requête douteuse.
const CURSOR_DATE_RE   = /^\d{4}-\d{2}-\d{2}$/;
const CURSOR_NUMBER_RE = /^[A-Za-z0-9-]+$/;

// Même règle que la recherche loyalty : la syntaxe `.or()` de PostgREST réserve
// `,()` comme séparateurs, `*` comme joker, `%_` comme métacaractères ilike —
// un `(` tapé dans le champ ressortirait en 400. On retire, on ne remplace
// pas : aucun terme légitime (nom de produit, numéro JE-…, client) n'en porte.
const OR_FILTER_UNSAFE = /[,()*%_\\]/g;
function sanitizeSearchTerm(term: string): string {
  return term.replace(OR_FILTER_UNSAFE, '').slice(0, 64);
}

function cursorOf(row: JournalEntryRow | undefined): JournalEntriesCursor | null {
  if (row === undefined) return null;
  if (!CURSOR_DATE_RE.test(row.entry_date)) return null;
  if (!CURSOR_NUMBER_RE.test(row.entry_number)) return null;
  return { entryDate: row.entry_date, entryNumber: row.entry_number };
}

export function useJournalEntries(filter: JournalEntriesFilter = {}) {
  const term = sanitizeSearchTerm((filter.search ?? '').trim());

  return useInfiniteQuery<JournalEntriesSlice, Error>({
    queryKey: [
      ...JOURNAL_ENTRIES_KEY,
      filter.startDate ?? null, filter.endDate ?? null,
      term || null, filter.referenceType ?? null, filter.accountId ?? null,
    ],
    staleTime: 30_000,
    initialPageParam: null as JournalEntriesCursor | null,
    queryFn: async ({ pageParam }) => {
      const cursor = pageParam as JournalEntriesCursor | null;

      // Le filtre par compte passe par un embed `!inner` FILTRANT : PostgREST
      // ne rend que les écritures dont AU MOINS une ligne touche le compte,
      // sans dupliquer la ligne mère, et le `count` de première page reste un
      // compte d'écritures. La colonne embarquée est jetée au mapping.
      const columns = filter.accountId
        ? `${COLUMNS}, journal_entry_lines!inner(account_id)`
        : COLUMNS;

      let q = cursor === null
        ? supabase.from('journal_entries').select(columns, { count: 'exact' })
        : supabase.from('journal_entries').select(columns);

      if (filter.startDate) q = q.gte('entry_date', filter.startDate);
      if (filter.endDate)   q = q.lte('entry_date', filter.endDate);
      if (filter.referenceType) q = q.eq('reference_type', filter.referenceType);
      if (filter.accountId) q = q.eq('journal_entry_lines.account_id', filter.accountId);
      // Deux `.or()` (celui-ci et le curseur) partent en paramètres `or=`
      // distincts, que PostgREST combine en ET — c'est le comportement voulu.
      if (term !== '') {
        q = q.or(`description.ilike.%${term}%,entry_number.ilike.%${term}%`);
      }
      if (cursor !== null) {
        // « strictement après le curseur dans l'ordre décroissant » : jour
        // antérieur, ou même jour et numéro inférieur.
        q = q.or(
          `entry_date.lt.${cursor.entryDate},`
          + `and(entry_date.eq.${cursor.entryDate},entry_number.lt.${cursor.entryNumber})`,
        );
      }

      const { data, error, count } = await q
        .order('entry_date',   { ascending: false })
        .order('entry_number', { ascending: false })
        .limit(JOURNAL_ENTRIES_PAGE_SIZE);
      if (error) throw error;

      const rows = ((data ?? []) as unknown as (JournalEntryRow & {
        journal_entry_lines?: unknown;
      })[]).map((r): JournalEntryRow => {
        if (!('journal_entry_lines' in r)) return r;
        const { journal_entry_lines: _lines, ...rest } = r;
        void _lines;
        return rest;
      });
      return {
        rows,
        total: cursor === null ? count ?? null : null,
        // Une page incomplète est la dernière : inutile d'aller chercher le
        // vide pour l'apprendre.
        nextCursor: rows.length < JOURNAL_ENTRIES_PAGE_SIZE
          ? null
          : cursorOf(rows[rows.length - 1]),
      };
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}
