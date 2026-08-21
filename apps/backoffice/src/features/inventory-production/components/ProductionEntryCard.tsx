// apps/backoffice/src/features/inventory-production/components/ProductionEntryCard.tsx
//
// Left card of the redesigned Production page. Multi-row production entry for a
// single station (section). Each row = a producible product (strictly filtered
// to the station via product_sections) + quantity in a chosen unit + waste +
// note. Submit is atomic via record_batch_production_v7 — any insufficient
// stock rolls the whole batch back.
//
// Logic kept from the legacy form: required section, idempotency key, atomic
// rollback, insufficient-stock surfacing. The entry's date/time may be
// backdated (production_date only — the ledger/JEs stay at now()).
//
// Per-row notes are persisted at batch level (the RPC has no per-item note
// field): non-empty notes are combined into the batch notes as "Product: note".
//
// ADR-008 D3 — une ligne qui déclare un raté doit en donner la cause. Le serveur
// refuse le lot entier sinon (`waste_reason_required`, DETAIL nommant la ligne) ;
// la garde côté table évite l'aller-retour.
//
// ADR-008 D4 — un stock insuffisant BLOQUE le lot. L'échappatoire (forçage) ne
// s'affiche qu'après un refus, et seulement pour un utilisateur porteur de
// `inventory.production.force_negative` : forcer reste un acte volontaire et
// tracé, jamais un réglage laissé coché par défaut.
//
// LE PANNEAU EST ENCRÉ (2026-08-21). DESIGN.md § Page Archetypes, archétype 9
// « Append-only log » : « le panneau de saisie est la SEULE surface encrée de la
// page ». Il était une feuille blanche parmi d'autres, donc rien ne disait où
// l'on écrit sur un écran dont tout le reste est en lecture seule. Quatre
// conséquences, toutes tenues par `../inkPanel.js` :
//
//   · les premiers plans changent de FAMILLE — `ink-fg` / `ink-fg-muted` /
//     `ink-fg-dim` / `ink-fg-sub` ;
//   · la sémantique change de TEINTE — The Ink Semantics Rule : `ink-danger` et
//     non `red`, qui tombe à 2,77:1 sur l'encre ;
//   · le focus passe à `ink-gold` (7,79:1) — `gold` y vaut 2,70:1 ;
//   · le bouton de soumission CÈDE l'encre. Il portait `TOOLBAR_BTN_PRIMARY`,
//     c'est-à-dire un aplat `bg-ink` : posé sur un panneau encré il aurait été
//     invisible ET aurait fait une seconde surface encrée (The One Ink Fill
//     Rule). Il s'inverse en ivoire plein à libellé encre. Accessoirement, cette
//     chaîne appartient au BANDEAU DE PAGE et à lui seul (DESIGN.md § Boutons,
//     garde CI n° 8) : elle n'avait rien à faire dans une carte.
//
// Deux surfaces restent CLAIRES à l'intérieur, et c'est délibéré : la liste de
// résultats de la recherche et l'aperçu d'ingrédients FLOTTENT ou RÉPONDENT —
// ce sont des feuilles posées sur l'encre, pas des surfaces encrées de plus.

import { AlertTriangle, Plus, Search, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { toast } from 'sonner';
import { Card, SectionLabel, cn } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore.js';
import { listboxOptionState, useListboxKeyboard } from '@/hooks/useListboxKeyboard.js';
import {
  useProducibleProductsBySection,
  type ProducibleProduct,
} from '../hooks/useProducibleProductsBySection.js';
import {
  useRecordBatchProduction,
  RecordBatchProductionError,
  type BatchItemInput,
} from '../hooks/useRecordBatchProduction.js';
import type { WasteReason } from '../hooks/useRecordProduction.js';
import { WASTE_REASON_LABELS, WASTE_REASON_OPTIONS, isWasteReason } from '../wasteReasons.js';
import { IngredientAggregatePreview } from './IngredientAggregatePreview.js';
import {
  FOCUS_RING_INK, INK_BTN_PRIMARY, INK_BTN_SECONDARY, INK_FIELD_BOX, INK_FIELD_BOX_CELL,
} from '../inkPanel.js';

interface Props {
  sectionId: string;
  sectionName: string;
  /** Day the page is viewing — the entry date/time defaults to it (backdating). */
  selectedDate: Date;
}

interface EntryRow {
  rowId: string;
  product: ProducibleProduct;
  unitCode: string;
  quantity: string;
  waste: string;
  wasteReason: WasteReason | '';
  note: string;
}

/** Format a Date as a `datetime-local` value in local time: YYYY-MM-DDTHH:mm. */
function toDatetimeLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

export function ProductionEntryCard({ sectionId, sectionName, selectedDate }: Props): JSX.Element {
  const products = useProducibleProductsBySection(sectionId);
  const recordMut = useRecordBatchProduction();
  const canForceNegative = useAuthStore((s) => s.hasPermission)('inventory.production.force_negative');

  const [rows, setRows] = useState<EntryRow[]>([]);
  const [query, setQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [productionAt, setProductionAt] = useState<string>(() => toDatetimeLocal(selectedDate));
  const [idempotencyKey, setIdempotencyKey] = useState<string>(() => crypto.randomUUID());
  const [shortages, setShortages] = useState<{ material_name: string; shortfall: number; unit: string }[] | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [forceNegative, setForceNegative] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // When the viewed day changes, re-seed the entry date/time to that day (keep
  // the current clock time so "today" stays now-ish).
  useEffect(() => {
    const now = new Date();
    const seeded = new Date(selectedDate);
    seeded.setHours(now.getHours(), now.getMinutes(), 0, 0);
    setProductionAt(toDatetimeLocal(seeded));
  }, [selectedDate]);

  // Reset rows when switching station — a row's product belongs to one station.
  useEffect(() => {
    setRows([]);
    setQuery('');
    setShortages(null);
    setFormError(null);
    setForceNegative(false);
  }, [sectionId]);

  const chosenIds = useMemo(() => new Set(rows.map((r) => r.product.id)), [rows]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === '') return [];
    return (products.data ?? [])
      .filter((p) => !chosenIds.has(p.id))
      .filter((p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q))
      .slice(0, 8);
  }, [query, products.data, chosenIds]);

  function addProduct(p: ProducibleProduct): void {
    setRows((prev) => [
      ...prev,
      { rowId: crypto.randomUUID(), product: p, unitCode: p.unit, quantity: '1', waste: '0', wasteReason: '', note: '' },
    ]);
    setQuery('');
    setSearchFocused(false);
  }

  function updateRow(rowId: string, patch: Partial<EntryRow>): void {
    setRows((prev) => prev.map((r) => (r.rowId === rowId ? { ...r, ...patch } : r)));
  }

  function removeRow(rowId: string): void {
    setRows((prev) => prev.filter((r) => r.rowId !== rowId));
  }

  function reset(): void {
    setRows([]);
    setQuery('');
    setShortages(null);
    setFormError(null);
    setForceNegative(false);
  }

  /** Build the RPC items (quantities converted to the product base unit). */
  const items: BatchItemInput[] = useMemo(() => {
    return rows
      .map((r): BatchItemInput | null => {
        const qty = Number.parseFloat(r.quantity);
        const factor = r.product.units.find((u) => u.code === r.unitCode)?.factor_to_base ?? 1;
        if (!Number.isFinite(qty) || qty <= 0) return null;
        const wasteBase = Number.parseFloat(r.waste);
        const out: BatchItemInput = {
          productId: r.product.id,
          quantityProduced: qty * factor,
        };
        if (Number.isFinite(wasteBase) && wasteBase > 0) {
          out.quantityWaste = wasteBase;
          if (r.wasteReason !== '') out.wasteReason = r.wasteReason;
        }
        return out;
      })
      .filter((x): x is BatchItemInput => x !== null);
  }, [rows]);

  /** ADR-008 D3 — au moins une ligne déclare un raté sans en donner la cause. */
  const wasteReasonMissing = useMemo(
    () => rows.some((r) => {
      const w = Number.parseFloat(r.waste);
      return Number.isFinite(w) && w > 0 && r.wasteReason === '';
    }),
    [rows],
  );

  const canSubmit = items.length > 0 && !wasteReasonMissing && !recordMut.isPending;

  function handleSubmit(): void {
    if (!canSubmit) return;
    setFormError(null);
    // Les pénuries affichées restent visibles tant que le forçage est armé :
    // l'utilisateur doit voir ce qu'il s'apprête à passer en négatif.
    if (!forceNegative) setShortages(null);

    const combinedNotes = rows
      .filter((r) => r.note.trim() !== '')
      .map((r) => `${r.product.name}: ${r.note.trim()}`)
      .join(' | ');

    const args: Parameters<typeof recordMut.mutate>[0] = {
      sectionId,
      idempotencyKey,
      items,
      productionDate: new Date(productionAt).toISOString(),
    };
    if (combinedNotes !== '') args.notes = combinedNotes;
    if (forceNegative) args.forceNegative = true;

    recordMut.mutate(args, {
      onSuccess: (res) => {
        if (res.forced_negative === true) {
          toast.warning(`Recorded ${res.batch_number} — forced below stock (traced in the audit log).`);
        } else {
          toast.success(`Recorded ${res.batch_number} (${res.production_records.length} item(s)).`);
        }
        reset();
        setIdempotencyKey(crypto.randomUUID());
      },
      onError: (err) => {
        if (err instanceof RecordBatchProductionError) {
          if (err.code === 'insufficient_stock' && Array.isArray(err.missingDetail)) {
            setShortages(err.missingDetail as { material_name: string; shortfall: number; unit: string }[]);
            setFormError('Insufficient stock for one or more ingredients.');
          } else if (err.code === 'force_negative_forbidden') {
            setForceNegative(false);
            setFormError('You are not allowed to force a production below stock.');
          } else if (err.code === 'invalid_production_date') {
            setFormError('Invalid production date/time.');
          } else if (err.code === 'recipe_not_found') {
            setFormError('A selected product has no active recipe.');
          } else if (err.code === 'waste_reason_required' || err.code === 'invalid_waste_reason') {
            setFormError('Every line with waste needs a valid waste reason.');
          } else if (err.code === 'unit_conversion_missing') {
            setFormError('A recipe line uses a unit that cannot be converted to the material stock unit. Fix the recipe first.');
          } else {
            setFormError(`Error: ${err.code}`);
          }
        } else {
          setFormError('Failed to record production.');
        }
      },
    });
  }

  const searchOpen = searchFocused && query.trim() !== '';
  const keyboard = useListboxKeyboard<ProducibleProduct>({
    items:      matches,
    open:       searchOpen,
    getItemKey: (p) => p.id,
    onSelect:   addProduct,
    onClose:    () => { setSearchFocused(false); },
  });

  // `blurTimer` était armé au blur et nettoyé au focus, mais jamais au
  // démontage : changer de station pendant les 150 ms laissait une minuterie
  // écrire dans un composant disparu.
  useEffect(() => () => {
    if (blurTimer.current) clearTimeout(blurTimer.current);
  }, []);

  return (
    <Card padding="md" className="space-y-5 border-ink bg-ink text-ink-fg">
      {/* Header + search */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Titre de CARTE = rôle Title (DESIGN.md § Typography) : mono, 12 px,
            capitales interlettrées — c'est ce que rend `SectionLabel`. Il
            portait `font-display text-2xl`, deux défauts d'une même ligne :
            `font-display` ne rend AUCUN serif sous ce thème (la classe ment,
            garde CI n° 7), et 30 px passaient au-dessus du `<h1>` de la page
            (23 px), inversant la hiérarchie. Le nombre n'est pas réécrit à la
            main : le primitif lit la rampe.

            Title et Label partagent le MÊME palier (12 px, `--type-xs`) — c'est
            écrit au § Typography : « un écran ne peut pas s'appuyer sur un
            contraste de taille entre le titre d'une carte et un en-tête de
            colonne ». La distinction se fait donc par la couleur et la
            position : ce titre est en `ink-fg`, les en-têtes de la table de
            saisie en `ink-fg-dim`. */}
        <SectionLabel as="h2" size="xs" className="text-ink-fg">
          Production Entry <span className="text-ink-fg-dim">— {sectionName}</span>
        </SectionLabel>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-fg-sub" aria-hidden />
          {/* 44 px et rayon 4 px (DESIGN.md § Champs). C'était un `h-9
              rounded-full` : un galet de 36 px là où le système ne connaît
              aucune forme entièrement circulaire hors pastille d'avatar et
              point d'état. */}
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => { setSearchFocused(true); if (blurTimer.current) clearTimeout(blurTimer.current); }}
            onBlur={() => { blurTimer.current = setTimeout(() => setSearchFocused(false), 150); }}
            onKeyDown={keyboard.handleKeyDown}
            placeholder="Search for a product…"
            aria-label="Search for a product"
            role="combobox"
            aria-expanded={searchOpen}
            aria-controls={keyboard.listboxId}
            aria-autocomplete="list"
            aria-activedescendant={keyboard.activeDescendantId}
            data-testid="production-search"
            className={cn(INK_FIELD_BOX, 'h-11 w-72 pl-9 pr-3 placeholder:text-ink-fg-sub', FOCUS_RING_INK)}
          />
          {/* Le descendant actif ne déplace pas le focus : sans annonce,
              l'apparition des résultats est muette pour un lecteur d'écran. */}
          <span className="sr-only" role="status" aria-live="polite">{keyboard.statusText}</span>
          {searchOpen && (
            <ul
              id={keyboard.listboxId}
              role="listbox"
              className="absolute right-0 z-20 mt-1 max-h-72 w-80 overflow-auto rounded-xl border border-border-subtle bg-bg-elevated py-1 shadow-lg"
              data-testid="production-search-results"
            >
              {products.isLoading ? (
                <li role="presentation" className="px-3 py-2 text-sm text-text-muted">Loading…</li>
              ) : matches.length === 0 ? (
                <li role="presentation" className="px-3 py-2 text-sm text-text-muted">No products for this station.</li>
              ) : (
                /* La liste FLOTTE au-dessus de la page : elle reste une feuille
                   blanche à 6 px de rayon (DESIGN.md § Elevation), pas une
                   surface encrée de plus. Ses premiers plans sont donc ceux du
                   papier, sans exception à faire. */
                matches.map((p, i) => (
                  // Non focalisable : surbrillance portée par le champ via
                  // `aria-activedescendant` (voir useListboxKeyboard).
                  <li
                    key={p.id}
                    role="option"
                    id={keyboard.optionId(i)}
                    aria-selected={keyboard.activeIndex === i}
                    onMouseEnter={() => { keyboard.onOptionHover(i); }}
                    onMouseDown={(e) => { e.preventDefault(); addProduct(p); }}
                    className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm ${listboxOptionState(keyboard.activeIndex === i)}`}
                  >
                    <span className="min-w-0 truncate text-text-primary">{p.name}</span>
                    <span className="shrink-0 font-mono text-xs uppercase tracking-widest text-text-muted">{p.sku}</span>
                  </li>
                ))
              )}
            </ul>
          )}
        </div>
      </div>

      {/* Alerts — The Ink Semantics Rule : `--danger` vaut 2,77:1 sur l'encre,
          `--ink-danger` 8,84:1. L'aplat `bg-red-soft` disparaît (une teinte à
          12 % d'opacité sur #201d19 ne se distingue plus du fond) ; le liseré
          et le texte portent seuls le signal, ce qui est de toute façon la
          doctrine du système. */}
      {formError !== null && (
        <div role="alert" className="rounded-md border border-ink-danger p-3 text-xs text-ink-danger">
          {formError}
          {shortages !== null && (
            <ul className="mt-1 list-disc pl-5" data-testid="production-shortages">
              {shortages.map((s, i) => (
                <li key={i}>{s.material_name} short {s.shortfall} {s.unit}</li>
              ))}
            </ul>
          )}
          {shortages !== null && canForceNegative && (
            <label className="mt-3 flex items-start gap-2 border-t border-ink-danger pt-2 text-ink-fg-dim">
              <input
                type="checkbox"
                checked={forceNegative}
                onChange={(e) => setForceNegative(e.target.checked)}
                data-testid="force-negative-toggle"
                className={`mt-0.5 accent-ink-gold ${FOCUS_RING_INK}`}
              />
              <span>
                <span className="inline-flex items-center gap-1 font-semibold text-ink-danger">
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                  Force this production below stock
                </span>
                <span className="block">
                  Raw material stock will go negative and the override is recorded in
                  the audit log. Submit again to confirm.
                </span>
              </span>
            </label>
          )}
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-md border border-ink-border">
        <table className="w-full text-sm">
          <caption className="sr-only">Product, quantity, waste, waste reason and note per production line</caption>
          <thead className="bg-ink-hover">
            <tr className="text-left">
              <th scope="col" className="px-4 py-2"><SectionLabel as="span" size="xs" className="text-ink-fg-dim">Product</SectionLabel></th>
              <th scope="col" className="px-4 py-2"><SectionLabel as="span" size="xs" className="text-ink-fg-dim">Quantity</SectionLabel></th>
              <th scope="col" className="px-4 py-2"><SectionLabel as="span" size="xs" className="text-ink-fg-dim">Waste</SectionLabel></th>
              <th scope="col" className="px-4 py-2"><SectionLabel as="span" size="xs" className="text-ink-fg-dim">Waste reason</SectionLabel></th>
              <th scope="col" className="px-4 py-2"><SectionLabel as="span" size="xs" className="text-ink-fg-dim">Note</SectionLabel></th>
              <th scope="col" className="px-4 py-2 w-10"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                {/* L'italique n'est aucun des six rôles typographiques déclarés
                    au § Typography : la phrase rend en corps ordinaire. */}
                <td colSpan={6} className="px-4 py-10 text-center text-sm text-ink-fg-dim">
                  Search and add a product to start a production batch.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.rowId} className="border-t border-ink-border" data-testid={`entry-row-${r.product.sku}`}>
                  <td className="px-4 py-3">
                    <div className="text-ink-fg">{r.product.name}</div>
                    <div className="font-mono text-xs uppercase tracking-widest text-ink-fg-dim">{r.product.sku}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        inputMode="decimal"
                        min={0.001}
                        step="0.001"
                        value={r.quantity}
                        onChange={(e) => updateRow(r.rowId, { quantity: e.target.value })}
                        aria-label={`Quantity for ${r.product.name}`}
                        className={cn(INK_FIELD_BOX_CELL, 'h-9 w-20', FOCUS_RING_INK)}
                      />
                      <select
                        value={r.unitCode}
                        onChange={(e) => updateRow(r.rowId, { unitCode: e.target.value })}
                        aria-label={`Unit for ${r.product.name}`}
                        className={cn(INK_FIELD_BOX_CELL, 'h-9', FOCUS_RING_INK)}
                      >
                        {r.product.units.map((u) => (
                          <option key={u.code} value={u.code}>{u.code}</option>
                        ))}
                      </select>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step="0.001"
                        value={r.waste}
                        onChange={(e) => updateRow(r.rowId, { waste: e.target.value })}
                        aria-label={`Waste for ${r.product.name}`}
                        className={cn(INK_FIELD_BOX_CELL, 'h-9 w-20', FOCUS_RING_INK)}
                      />
                      <span className="text-xs text-ink-fg-dim">{r.product.unit}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {(() => {
                      const w = Number.parseFloat(r.waste);
                      const needsReason = Number.isFinite(w) && w > 0;
                      return (
                        <select
                          value={r.wasteReason}
                          onChange={(e) => updateRow(r.rowId, {
                            wasteReason: isWasteReason(e.target.value) ? e.target.value : '',
                          })}
                          disabled={!needsReason}
                          aria-label={`Waste reason for ${r.product.name}`}
                          data-testid={`waste-reason-${r.product.sku}`}
                          className={cn(
                            INK_FIELD_BOX_CELL, 'h-9 disabled:opacity-50', FOCUS_RING_INK,
                            // ADR-008 D3 — la ligne réclame sa cause : le liseré
                            // vire au rouge d'encre (7,57:1 sur le remplissage
                            // du champ), pas au rouge du papier (2,77:1).
                            needsReason && r.wasteReason === '' ? 'border-ink-danger' : '',
                          )}
                        >
                          <option value="">{needsReason ? '— required —' : '—'}</option>
                          {WASTE_REASON_OPTIONS.map((reason) => (
                            <option key={reason} value={reason}>{WASTE_REASON_LABELS[reason]}</option>
                          ))}
                        </select>
                      );
                    })()}
                  </td>
                  <td className="px-4 py-3">
                    <input
                      type="text"
                      value={r.note}
                      onChange={(e) => updateRow(r.rowId, { note: e.target.value })}
                      maxLength={200}
                      aria-label={`Note for ${r.product.name}`}
                      className={cn(INK_FIELD_BOX_CELL, 'h-9 w-full', FOCUS_RING_INK)}
                    />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => removeRow(r.rowId)}
                      aria-label={`Remove ${r.product.name}`}
                      className={cn(
                        'inline-flex h-8 w-8 items-center justify-center rounded-sm',
                        'text-ink-fg-dim hover:bg-ink-hover hover:text-ink-danger',
                        FOCUS_RING_INK,
                      )}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Aperçu de faisabilité — juste au-dessus du bouton de soumission : c'est
          là que la pénurie doit se lire, avant l'aller-retour serveur. Les
          quantités passées sont celles de la RPC (unité de base), sinon
          l'aperçu se tromperait du facteur de conversion de la ligne. */}
      {rows.length > 0 && <IngredientAggregatePreview items={items} />}

      {/* Footer: production date/time + actions */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <SectionLabel as="div" size="xs" className="text-ink-fg-dim">Production date &amp; time</SectionLabel>
          <input
            type="datetime-local"
            value={productionAt}
            onChange={(e) => setProductionAt(e.target.value)}
            aria-label="Production date and time"
            data-testid="production-datetime"
            className={cn(INK_FIELD_BOX, 'h-11 [color-scheme:dark]', FOCUS_RING_INK)}
          />
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            className={INK_BTN_SECONDARY}
            onClick={reset}
            disabled={rows.length === 0 || recordMut.isPending}
          >
            Cancel
          </button>
          <button
            className={INK_BTN_PRIMARY}
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            data-testid="submit-production"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {recordMut.isPending
              ? 'Submitting…'
              : forceNegative ? 'Force & Submit' : 'Submit Production'}
          </button>
        </div>
      </div>
    </Card>
  );
}
