// apps/backoffice/src/layouts/CommandPalette.tsx
//
// Refonte shell 2026-08-05 — la palette de commandes (⌘K / Ctrl-K).
//
// Contrepartie indispensable du passage de 85 entrées visibles à 7 onglets :
// ce qui n'est plus à l'écran doit rester atteignable en trois frappes. La
// palette indexe TOUTES les destinations du modèle `nav.ts` — donc exactement
// celles que l'utilisateur a le droit de voir, le filtrage étant fait en amont
// par `visibleDomains` — plus une courte liste d'ACTIONS de création.
//
// Chaque résultat porte son fil d'Ariane (« Reports › Inventory ») : sans lui
// un titre comme « Sales by hour » ne dit pas d'où il vient, et la palette
// remplacerait mal la carte mentale que donnait l'arborescence du sidebar.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CornerDownLeft, Search } from 'lucide-react';
import { CenterModal, cn, useDebouncedValue } from '@breakery/ui';
import type { PermissionCode } from '@breakery/supabase';
import { useAuthStore } from '@/stores/authStore.js';
import { NAV_DOMAINS, flattenDestinations, visibleDomains } from './nav.js';
import { MIN_ENTITY_QUERY, usePaletteSearch } from './usePaletteSearch.js';

/** Délai avant que la frappe ne parte en requête serveur (audit lot 4). */
const SEARCH_DEBOUNCE_MS = 250;
/** Plafond par section — pages et actions suivent la même règle que les entités. */
const SECTION_LIMIT = 5;

interface PaletteEntry {
  to: string;
  label: string;
  /** « Reports › Inventory » — vide pour les entrées de premier niveau. */
  breadcrumb: string;
  group: string;
}

/** Raccourcis de création — leurs droits sont ceux des `PermissionGate` des routes. */
const ACTIONS: { to: string; label: string; permission: PermissionCode }[] = [
  { to: '/backoffice/expenses/new', label: 'New expense', permission: 'expenses.create' },
  { to: '/backoffice/purchasing/purchase-orders/new', label: 'New purchase order', permission: 'purchasing.po.create' },
  { to: '/backoffice/inventory/transfers/new', label: 'New stock transfer', permission: 'inventory.transfer.create' },
  { to: '/backoffice/products/combos/new', label: 'New combo', permission: 'combos.create' },
  { to: '/backoffice/users/new', label: 'New user', permission: 'users.create' },
];

/**
 * Correspondance resserrée (audit UX/UI 2026-08-13, lot 4). L'ancienne
 * subséquence libre acceptait n'importe quels caractères dispersés — « crois »
 * remontait « Customer categories ». Deux formes seulement désormais :
 *   · sous-chaîne littérale (« sales by » dans « Sales by hour ») —
 *     score = position, plus tôt = meilleur ;
 *   · acronyme d'INITIALES de mots, dans l'ordre (« sbh » → Sales By Hour) —
 *     pénalisé à +1000 pour passer derrière toute sous-chaîne.
 * Renvoie null si la requête ne correspond à aucune des deux.
 */
export function fuzzyScore(query: string, target: string): number | null {
  const q = query.trim().toLowerCase();
  if (q === '') return 0;
  const t = target.toLowerCase();

  const exact = t.indexOf(q);
  if (exact !== -1) return exact; // sous-chaîne littérale : toujours devant

  const initials = t.split(/[^a-z0-9]+/).filter((w) => w !== '').map((w) => w.charAt(0));
  let wordCursor = 0;
  let firstHit = -1;
  for (const ch of q) {
    let found = -1;
    for (let i = wordCursor; i < initials.length; i += 1) {
      if (initials[i] === ch) { found = i; break; }
    }
    if (found === -1) return null;
    if (firstHit === -1) firstHit = found;
    wordCursor = found + 1;
  }
  return firstHit + 1000;
}

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const navigate = useNavigate();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // La frappe filtre pages/actions immédiatement ; les requêtes serveur
  // (entités) ne partent qu'après 250 ms de silence et ≥ 2 caractères.
  const debouncedQuery = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);
  const { sections: entitySections, isSearching, entityQueryActive } =
    usePaletteSearch(debouncedQuery, open);

  const entries = useMemo<PaletteEntry[]>(() => {
    const pages: PaletteEntry[] = flattenDestinations(
      visibleDomains(NAV_DOMAINS, hasPermission),
    ).map((d) => ({
      to: d.to,
      label: d.label,
      breadcrumb: d.columnLabel === '' ? d.domainLabel : `${d.domainLabel} › ${d.columnLabel}`,
      group: 'Pages',
    }));
    const actions: PaletteEntry[] = ACTIONS.filter((a) => hasPermission(a.permission)).map((a) => ({
      to: a.to,
      label: a.label,
      breadcrumb: '',
      group: 'Actions',
    }));
    return [...pages, ...actions];
  }, [hasPermission]);

  const results = useMemo(() => {
    const scored = entries
      .map((e) => ({ entry: e, score: fuzzyScore(query, `${e.label} ${e.breadcrumb}`) }))
      .filter((r): r is { entry: PaletteEntry; score: number } => r.score !== null)
      .sort((a, b) => a.score - b.score)
      .map((r) => r.entry);
    // Actions d'abord quand la requête est vide : à froid, la palette propose
    // de FAIRE, pas de relire la liste des pages dans l'ordre du menu.
    if (query.trim() === '') {
      return [
        ...scored.filter((e) => e.group === 'Actions').slice(0, SECTION_LIMIT),
        ...scored.filter((e) => e.group === 'Pages').slice(0, SECTION_LIMIT),
      ];
    }
    // Requête active : entités d'abord (Orders/Products/Customers/Suppliers,
    // classement serveur), puis Pages, puis Actions — 5 par section.
    const entityEntries: PaletteEntry[] = entitySections.flatMap((s) =>
      s.hits.map((h) => ({ ...h, group: s.group })),
    );
    return [
      ...entityEntries,
      ...scored.filter((e) => e.group === 'Pages').slice(0, SECTION_LIMIT),
      ...scored.filter((e) => e.group === 'Actions').slice(0, SECTION_LIMIT),
    ];
  }, [entries, query, entitySections]);

  useEffect(() => { setHighlight(0); }, [query]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setHighlight(0);
    // Le champ est monté dans le même commit — focus au frame suivant.
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => { cancelAnimationFrame(id); };
  }, [open]);

  // La ligne surlignée reste dans la zone visible quand on descend au clavier.
  // `scrollIntoView` est absent de jsdom : on garde l'appel, sinon toute la
  // palette casse sous test pour une commodité de défilement.
  useEffect(() => {
    const row = listRef.current?.querySelector('[data-highlighted="true"]');
    if (row instanceof HTMLElement && typeof row.scrollIntoView === 'function') {
      row.scrollIntoView({ block: 'nearest' });
    }
  }, [highlight]);

  if (!open) return null;

  const go = (to: string) => {
    onClose();
    void navigate(to);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    // Échap est déjà géré par Radix via `onOpenChange` — pas de doublon ici.
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => (results.length === 0 ? 0 : (h + 1) % results.length));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => (results.length === 0 ? 0 : (h - 1 + results.length) % results.length));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const target = results[highlight];
      if (target !== undefined) go(target.to);
    }
  };

  let lastGroup: string | null = null;

  return (
    // CenterModal (Radix) plutôt qu'un overlay maison : piège à focus, Échap et
    // aria-modal viennent avec, et la règle lint `no-raw-modal-overlay` du repo
    // interdit précisément de les réécrire à la main. On la remonte de la
    // verticale centrée vers 14vh — une palette se lit en haut de l'écran.
    <CenterModal
      open={open}
      onOpenChange={(next) => { if (!next) onClose(); }}
      title="Command palette"
      data-testid="command-palette"
      className="top-[14vh] w-[560px] max-w-[calc(100vw-32px)] translate-y-0 overflow-hidden rounded-xl border-border-strong bg-surface-3 shadow-[0_18px_48px_rgba(28,23,18,0.22)]"
    >
      <div onKeyDown={onKeyDown} className="flex min-h-0 flex-col">
        <div className="flex items-center gap-3 border-b border-border-muted px-4 py-3.5">
          <Search className="h-[18px] w-[18px] shrink-0 text-text-subtle" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); }}
            placeholder="Search orders, products, customers… or jump to a page"
            aria-label="Search orders, products, customers, suppliers, pages and actions"
            aria-controls="command-palette-results"
            className="min-w-0 flex-1 bg-transparent text-[15px] text-text-primary outline-none placeholder:text-text-muted"
          />
          <kbd className="shrink-0 rounded-sm border border-border-strong px-1.5 py-0.5 font-data text-[10px] text-text-muted">
            Esc
          </kbd>
        </div>

        <ul
          ref={listRef}
          id="command-palette-results"
          className="max-h-[46vh] overflow-y-auto py-1.5"
          role="listbox"
        >
          {isSearching && (
            <li
              className="flex items-center gap-2 px-4 py-2 text-[12px] text-text-muted"
              role="status"
              aria-live="polite"
            >
              <span
                className="h-3 w-3 animate-spin rounded-full border-2 border-border-subtle border-t-gold"
                aria-hidden
              />
              Searching…
            </li>
          )}
          {results.length === 0 && !isSearching && (
            <li className="px-4 py-6 text-center text-[13px] text-text-muted">
              {entityQueryActive
                ? <>No order, product, customer, supplier, page or action matches “{query}”.</>
                : query.trim().length > 0 && query.trim().length < MIN_ENTITY_QUERY
                  ? <>Type at least {MIN_ENTITY_QUERY} characters to search orders, products and customers.</>
                  : <>No page or action matches “{query}”.</>}
            </li>
          )}
          {results.map((entry, i) => {
            const groupHeader = entry.group !== lastGroup ? entry.group : null;
            lastGroup = entry.group;
            const highlighted = i === highlight;
            return (
              <li key={`${entry.group}:${entry.to}`}>
                {groupHeader !== null && (
                  <p className="px-4 pb-1 pt-2 font-data text-[10px] uppercase tracking-widest text-text-muted">
                    {groupHeader}
                  </p>
                )}
                <button
                  type="button"
                  role="option"
                  aria-selected={highlighted}
                  data-highlighted={highlighted}
                  onMouseEnter={() => { setHighlight(i); }}
                  onClick={() => { go(entry.to); }}
                  className={cn(
                    'flex w-full items-center gap-3 px-4 py-2 text-left transition-colors',
                    highlighted && 'bg-[rgba(138,104,32,0.10)]',
                  )}
                >
                  <span className="min-w-0 flex-1 truncate text-[13.5px] text-text-primary">
                    {entry.label}
                  </span>
                  {entry.breadcrumb !== '' && (
                    <span className="shrink-0 text-[11.5px] text-text-muted">{entry.breadcrumb}</span>
                  )}
                  {highlighted && (
                    <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-text-muted" aria-hidden />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </CenterModal>
  );
}
