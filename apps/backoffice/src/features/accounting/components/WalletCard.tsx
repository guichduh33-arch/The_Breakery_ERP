// apps/backoffice/src/features/accounting/components/WalletCard.tsx
// Cash Wallets module — single wallet summary card, selectable.
import { Card, Badge } from '@breakery/ui';
import type { WalletBalance } from '../hooks/useCashWallets.js';

const LABELS: Record<string, string> = {
  '1110': 'Undeposited Funds',
  '1111': 'Petty Cash',
  '1117': 'Small Money',
};

const idr = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });

export function WalletCard({
  wallet,
  selected,
  onSelect,
  fixedFloat,
}: {
  wallet: WalletBalance;
  selected: boolean;
  onSelect: () => void;
  fixedFloat?: number | undefined;
}) {
  const label = LABELS[wallet.account_code] ?? wallet.account_name;
  const lentOut = fixedFloat != null && wallet.balance !== fixedFloat;

  return (
    <button
      type="button"
      onClick={onSelect}
      // `rounded-md` sur le PORTEUR de l'anneau : le `<button>` n'avait aucun
      // rayon (0 px) autour d'une `Card` qui en a 4 px, donc `ring-2` traçait un
      // rectangle vif qui coupait les quatre coins arrondis de la carte. Le
      // rayon du porteur doit suivre celui de ce qu'il entoure — `--radius-md`
      // et `--radius-lg` valent tous deux 4 px dans ce thème, la carte et
      // l'anneau tombent donc exactement l'un sur l'autre.
      // SÉLECTION ET FOCUS NE PEUVENT PAS ÊTRE LE MÊME SIGNAL (2026-08-18).
      // La sélection portait `ring-2 ring-gold` et le focus un
      // `outline-2 outline-gold` décalé de 2 px : même couleur, même épaisseur,
      // deux traits parallèles à 2 px d'écart. Au clavier, on ne pouvait plus
      // lire lequel des deux états on regardait — et sur la carte sélectionnée
      // les deux se confondaient en un seul liseré épais.
      // La sélection passe donc à l'ENCRE, qui n'est ni la couleur du focus ni
      // celle d'aucun autre état de ce thème (`--ink-base` #201d19, 16,784:1 sur
      // la feuille blanche). L'or reste ce que DESIGN.md lui donne : le focus.
      // La couleur n'est de toute façon pas le seul porteur — `aria-pressed`
      // annonce la sélection, elle n'est jamais devinée à la teinte.
      className={`rounded-md text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold ${
        selected ? 'ring-2 ring-ink' : ''
      }`}
      aria-pressed={selected}
    >
      <Card className="p-4 min-w-[200px]">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-text-muted">{label}</span>
          {fixedFloat != null && (
            <Badge variant={lentOut ? 'destructive' : 'secondary'}>
              {lentOut ? 'Lent out' : 'Float OK'}
            </Badge>
          )}
        </div>
        <div className="mt-2 text-2xl font-semibold tabular-nums">{idr.format(wallet.balance)}</div>
        {fixedFloat != null && (
          <div className="mt-1 text-xs text-text-muted">
            Fixed float: {idr.format(fixedFloat)}
          </div>
        )}
      </Card>
    </button>
  );
}
