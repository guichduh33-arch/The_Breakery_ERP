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
  /**
   * Un coffre NÉGATIF est un solde à découvert — dans un commerce qui n'a pas de
   * découvert, c'est une erreur de saisie ou un coffre non compté. « Petty Cash
   * -Rp 14.000.000 » s'affichait exactement comme un coffre sain, alors que la
   * même mesure sur le tableau de bord dit déjà « overdrawn » en danger
   * (`DashboardKpiStrip.tsx`, tuile « Cash on hand »). Deux écrans, une seule
   * lecture : c'est le même traitement de sévérité qui est repris ici.
   *
   * Trois signaux, comme là-bas, et la couleur n'est jamais le premier : le
   * SIGNE vient du formatteur, le MOT de la ligne sous la valeur, la teinte
   * n'arrive qu'en renfort (WCAG 1.4.1). Le rouge écrit passe par
   * `danger-as-text` — Règle des Deux Rouges — et sans alpha : `text-danger/70`
   * sur un token `var()` nu serait supprimé en silence par Tailwind.
   */
  const overdrawn = wallet.balance < 0;

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
        <div
          // The Mono-Carries-Data Rule : `tabular-nums` seul ALIGNE les chiffres
          // d'une police proportionnelle, il ne la remplace pas. Ce solde décide
          // d'un écart de caisse porté au grand livre — il rend en JetBrains
          // Mono comme les colonnes du ledger juste dessous.
          className={`mt-2 font-data text-2xl font-semibold tabular-nums ${overdrawn ? 'text-danger-as-text' : ''}`}
          data-testid="wallet-balance"
        >
          {idr.format(wallet.balance)}
        </div>
        {overdrawn && (
          <div className="mt-1 text-xs text-danger-as-text" data-testid="wallet-overdrawn">
            Overdrawn
          </div>
        )}
        {fixedFloat != null && (
          <div className="mt-1 text-xs text-text-muted">
            Fixed float:{' '}
            <span className="font-data tabular-nums">{idr.format(fixedFloat)}</span>
          </div>
        )}
      </Card>
    </button>
  );
}
