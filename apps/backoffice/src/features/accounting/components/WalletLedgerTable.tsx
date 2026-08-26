// apps/backoffice/src/features/accounting/components/WalletLedgerTable.tsx
// Cash Wallets module — In/Out/Saldo ledger table for a single wallet.
//
// L'en-tête n'était pas un en-tête de TABLEAU : Instrument Sans 14 px, casse
// normale, sans interlettrage, sur fond blanc. DESIGN.md § Tableaux exige
// « en-tête et pied sur papier inerte (#fafaf8), libellés en label mono
// capitales » — c'est ce que rend la `DataTable` du catalogue, prise ici comme
// référence : `font-data` posé sur la CELLULE (la famille s'hérite) et le
// libellé confié à `SectionLabel`.
//
// Le CORPS enfreignait The Mono-Carries-Data Rule sur trois colonnes de
// chiffres — dates, montants In/Out, saldo — rendues en Instrument Sans.
// `tabular-nums` seul ne suffit pas : il aligne les chiffres d'une police
// proportionnelle, il ne la remplace pas.
import { SectionLabel } from '@breakery/ui';
import { QueryErrorBanner } from '@/components/QueryErrorBanner.js';
import type { WalletLedgerRow } from '../hooks/useCashWalletLedger.js';

// Le préfixe « Rp » manquait ICI et nulle part ailleurs sur la page : les
// tuiles de portefeuille (`WalletCard`) formatent en `style: 'currency'`, la
// table rendait des nombres nus. Le même écran donnait donc « Rp 14.000.000 »
// en haut et « 14.000.000 » en dessous, pour la même unité (critique du
// 2026-08-26). L'unité se déclare une fois par écran, ou à chaque montant —
// jamais à moitié. Décimales à zéro : la roupie n'en porte pas (DESIGN.md).
const idr = new Intl.NumberFormat('id-ID', {
  style: 'currency', currency: 'IDR', maximumFractionDigits: 0,
});

const HEAD: readonly { label: string; right: boolean }[] = [
  { label: 'Date',        right: false },
  { label: 'Remark',      right: false },
  { label: 'Category',    right: false },
  { label: 'Description', right: false },
  { label: 'Supplier',    right: false },
  { label: 'In',          right: true  },
  { label: 'Out',         right: true  },
  { label: 'Balance',     right: true  },
];

export function WalletLedgerTable({
  rows,
  loading,
  error,
  onRetry,
}: {
  rows: WalletLedgerRow[];
  loading: boolean;
  /**
   * Diagnostic serveur quand le ledger n'a PAS pu être lu, `null` sinon.
   *
   * LE DÉFAUT QUE CETTE PROP FERME. Le composant ne connaissait que deux
   * états — « en cours » et « rien » — et rendait donc « No movements in this
   * period. » quand la requête ÉCHOUAIT. C'est la phrase la plus dangereuse
   * qu'un écran de trésorerie puisse rendre : elle affirme un fait sur le
   * coffre là où le serveur n'a rien répondu, et un comptable qui la croit
   * rapproche une caisse sur une période qu'il pense vide (même motif que
   * `JournalEntriesPage`, corrigé au même endroit).
   */
  error: string | null;
  /** Relance la requête depuis le « Try again » du bandeau. */
  onRetry: () => void;
}) {
  if (loading) {
    return <div className="p-4 text-sm text-text-muted">Loading ledger…</div>;
  }
  return (
    <>
      {/* Le bandeau SURPLOMBE la table, il ne la remplace pas : les lignes
          déjà chargées restent lisibles, avec l'avertissement au-dessus. */}
      {error !== null && (
        <QueryErrorBanner detail={error} onRetry={onRetry} data-testid="wallet-ledger-error">
          These movements could not be loaded — the period may well hold
          movements this request never reached.
        </QueryErrorBanner>
      )}

      {/* L'état vide n'est vrai que si le serveur a répondu. */}
      {error === null && rows.length === 0 && (
        <div className="p-4 text-sm text-text-muted">No movements in this period.</div>
      )}

      {rows.length > 0 && <LedgerRows rows={rows} />}
    </>
  );
}

function LedgerRows({ rows }: { rows: WalletLedgerRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">Date, remark, category, description, supplier, in, out and running balance for the selected cash wallet</caption>
        <thead>
          <tr className="border-b border-border-subtle bg-surface-inert text-left">
            {HEAD.map((h) => (
              <th
                key={h.label}
                scope="col"
                className={`px-3 py-2.5 font-data ${h.right ? 'text-right' : ''}`}
              >
                <SectionLabel as="span" size="xs">{h.label}</SectionLabel>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-border-row last:border-0">
              <td className="whitespace-nowrap px-3 py-1.5 font-data text-xs text-text-secondary">{r.row_date}</td>
              {/* La troncature vit sur un ENFANT du `<td>`, jamais sur le `<td>`
                  lui-même : l'algorithme de table `auto` n'honore pas une
                  `max-width` posée sur une cellule — l'ellipsis promise
                  n'apparaissait donc jamais, tandis que le `white-space: nowrap`
                  de `truncate` gonflait la min-content de ces quatre colonnes de
                  texte et ÉCRASAIT les trois colonnes de montants (critique du
                  2026-08-26). Le `title` n'est pas décoratif : ces libellés sont
                  la donnée de rapprochement, ce que l'ellipsis coupe doit rester
                  atteignable. */}
              <td className="px-3">
                <div className="max-w-[220px] truncate" title={r.remark ?? ''}>{r.remark}</div>
              </td>
              <td className="px-3">
                <div className="max-w-[140px] truncate" title={r.category ?? ''}>{r.category ?? ''}</div>
              </td>
              <td className="px-3">
                <div className="max-w-[200px] truncate" title={r.description ?? ''}>{r.description ?? ''}</div>
              </td>
              <td className="px-3">
                <div className="max-w-[160px] truncate" title={r.supplier ?? ''}>{r.supplier ?? ''}</div>
              </td>
              <td className="whitespace-nowrap px-3 text-right font-data tabular-nums">{r.in_amount ? idr.format(r.in_amount) : ''}</td>
              <td className="whitespace-nowrap px-3 text-right font-data tabular-nums">{r.out_amount ? idr.format(r.out_amount) : ''}</td>
              <td className="whitespace-nowrap px-3 text-right font-data font-medium tabular-nums">{idr.format(r.saldo)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
