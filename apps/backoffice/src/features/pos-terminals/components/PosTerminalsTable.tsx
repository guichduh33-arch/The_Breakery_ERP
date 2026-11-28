// apps/backoffice/src/features/pos-terminals/components/PosTerminalsTable.tsx
// Liste des terminaux POS avec édition en ligne du nom et du type. Le repère
// « Last used by » aide à reconnaître l'appareil physique : le jeton seul
// (pd_xxxxx) n'est affiché nulle part sur le terminal.
//
// Par défaut, seuls les terminaux vus depuis RECENT_DAYS jours sont listés :
// chaque navigateur vidé crée un jeton neuf, et les anciens noieraient les
// vrais terminaux. « Show all » rend la liste complète.
import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { toast } from 'sonner';
import { Pencil } from 'lucide-react';
import { Input, Select } from '@breakery/ui';
import { Button } from '@/components/BackofficeUi.js';
import { formatDateTime } from '@breakery/utils';
import { usePosTerminals, type PosTerminalKind, type PosTerminalRow } from '../hooks/usePosTerminals.js';
import {
  POS_TERMINAL_LABEL_MAX,
  useRenamePosTerminal,
  validateTerminalLabel,
} from '../hooks/useRenamePosTerminal.js';

export const KIND_LABELS: Record<PosTerminalKind, string> = {
  counter: 'Till',
  tablet: 'Tablet',
  kds: 'Kitchen display',
  kiosk: 'Kiosk',
  unknown: 'Unknown',
};
const EDITABLE_KINDS: PosTerminalKind[] = ['counter', 'tablet', 'kds', 'kiosk'];
export const RECENT_DAYS = 30;

/** Identifiant court tel que le journal d'activité l'affiche (« pd_75b45 »). */
export function shortId(token: string): string {
  return token.slice(0, 8);
}

function TerminalRow({ row }: { row: PosTerminalRow }): JSX.Element {
  const rename = useRenamePosTerminal();
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState('');
  // '' = type pas encore choisi (terminal inconnu) : le choix est obligatoire.
  const [kind, setKind] = useState<PosTerminalKind | ''>('');
  const [error, setError] = useState<string | null>(null);
  const renameButton = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);

  useEffect(() => {
    if (!editing && restoreFocus.current) {
      restoreFocus.current = false;
      renameButton.current?.focus();
    }
  }, [editing]);

  const id = shortId(row.device_token);
  const errorId = `terminal-error-${row.id}`;

  function startEdit(): void {
    setLabel(row.is_registered ? row.label : '');
    setKind(row.kind === 'unknown' ? '' : row.kind);
    setError(null);
    setEditing(true);
  }

  function stopEdit(): void {
    restoreFocus.current = true;
    setEditing(false);
  }

  function save(): void {
    if (rename.isPending) return;
    const invalid = validateTerminalLabel(label);
    if (invalid !== null) { setError(invalid); return; }
    if (kind === '') { setError('Choose a type.'); return; }
    rename.mutate(
      { deviceToken: row.device_token, label, kind },
      {
        onSuccess: () => { toast.success(`Terminal named ${label.trim()}`); stopEdit(); },
        onError: (e) => setError(e.message),
      },
    );
  }

  return (
    <tr className="border-b border-border-subtle align-top">
      <td className="py-2 pr-3">
        {editing ? (
          <div>
            <Input aria-label={`Name for ${id}`} value={label} maxLength={POS_TERMINAL_LABEL_MAX}
              placeholder="e.g. Main till" autoFocus
              aria-invalid={error !== null} aria-describedby={error !== null ? errorId : undefined}
              onChange={(e) => setLabel(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') stopEdit(); }} />
            {error !== null && <p id={errorId} role="alert" className="mt-1 text-xs text-danger-as-text">{error}</p>}
          </div>
        ) : (
          <span className={row.is_registered ? 'font-medium' : 'text-text-secondary'}>{row.label}</span>
        )}
      </td>
      <td className="py-2 pr-3">
        {editing ? (
          <Select aria-label={`Type for ${id}`} value={kind}
            onChange={(e) => setKind(e.target.value as PosTerminalKind | '')}>
            <option value="" disabled>Select type…</option>
            {EDITABLE_KINDS.map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
          </Select>
        ) : KIND_LABELS[row.kind]}
      </td>
      <td className="py-2 pr-3">
        <span className={`inline-block rounded px-2 py-0.5 text-xs ${
          row.is_registered ? 'bg-success-soft text-success' : 'bg-warning-soft text-warning'
        }`}>
          {row.is_registered ? 'Named' : 'Not named'}
        </span>
      </td>
      <td className="py-2 pr-3 font-mono text-xs">{id}</td>
      <td className="py-2 pr-3">{row.last_user ?? '—'}</td>
      <td className="py-2 pr-3 font-mono text-xs">{formatDateTime(row.last_seen_at)}</td>
      <td className="py-2 pr-3 font-mono text-xs">{formatDateTime(row.first_seen_at)}</td>
      <td className="py-2 text-right whitespace-nowrap">
        {editing ? (
          <span className="space-x-1">
            <Button variant="secondary" size="sm" aria-label={`Cancel renaming ${id}`}
              onClick={stopEdit} disabled={rename.isPending}>
              Cancel
            </Button>
            <Button variant="ink" size="sm" aria-label={`Save name for ${id}`}
              onClick={save} disabled={rename.isPending}>
              {rename.isPending ? 'Saving…' : 'Save'}
            </Button>
          </span>
        ) : (
          <Button ref={renameButton} variant="secondary" size="sm" aria-label={`Rename ${id}`} onClick={startEdit}>
            <Pencil className="h-4 w-4" aria-hidden /> Rename
          </Button>
        )}
      </td>
    </tr>
  );
}

export function PosTerminalsTable(): JSX.Element {
  const { data, isLoading, error } = usePosTerminals();
  const [showAll, setShowAll] = useState(false);

  const all = useMemo(() => data ?? [], [data]);
  const recent = useMemo(() => {
    const cutoff = Date.now() - RECENT_DAYS * 86_400_000;
    return all.filter((r) => new Date(r.last_seen_at).getTime() >= cutoff);
  }, [all]);

  if (isLoading) return <div className="text-sm text-text-secondary">Loading terminals…</div>;
  if (error !== null) {
    return <div role="alert" className="text-sm text-danger-as-text">Failed to load terminals: {error.message}</div>;
  }
  if (all.length === 0) {
    return (
      <div className="text-sm text-text-secondary">
        No terminal has reported yet. A till or tablet appears here after its first sale or action.
      </div>
    );
  }

  const rows = showAll ? all : recent;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-text-secondary">
        <p>
          {showAll
            ? `Showing all ${all.length} terminals.`
            : `Showing ${recent.length} of ${all.length} terminals seen in the last ${RECENT_DAYS} days.`}
        </p>
        {recent.length < all.length && (
          <Button variant="secondary" size="sm" aria-pressed={showAll} onClick={() => setShowAll((v) => !v)}>
            {showAll ? `Show last ${RECENT_DAYS} days only` : 'Show all'}
          </Button>
        )}
      </div>
      {rows.length === 0 ? (
        <div className="text-sm text-text-secondary">No terminal seen in the last {RECENT_DAYS} days.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Name, type, status, ID, last user, last seen and first seen per POS terminal</caption>
            <thead className="border-b border-border-subtle text-xs uppercase text-text-secondary">
              <tr>
                <th scope="col" className="py-2 pr-3 text-left">Name</th>
                <th scope="col" className="py-2 pr-3 text-left">Type</th>
                <th scope="col" className="py-2 pr-3 text-left">Status</th>
                <th scope="col" className="py-2 pr-3 text-left">ID</th>
                <th scope="col" className="py-2 pr-3 text-left">Last used by</th>
                <th scope="col" className="py-2 pr-3 text-left">Last seen</th>
                <th scope="col" className="py-2 pr-3 text-left">First seen</th>
                <th scope="col" className="py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => <TerminalRow key={r.id} row={r} />)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
