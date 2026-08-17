import { PromotionLineRow } from '@breakery/ui';

// Promotions appliquées dans le résumé du panier POS — rangées italiques muted.
const applied = [
  {
    promotion_id: 'promo-1',
    slug: 'happy-hour-beverage',
    name: 'Happy Hour Beverage',
    type: 'percentage' as const,
    amount: 9_600,
    description: '−15 % boissons',
  },
  {
    promotion_id: 'promo-2',
    slug: 'panier-viennoiseries',
    name: 'Panier viennoiseries −Rp 10.000',
    type: 'fixed_amount' as const,
    amount: 10_000,
    description: 'Remise fixe viennoiseries',
  },
  {
    promotion_id: 'promo-3',
    slug: 'croissant-offert',
    name: 'Croissant offert dès Rp 150.000',
    type: 'free_product' as const,
    amount: 0,
    description: 'Cadeau : 1 croissant beurre',
  },
];

export const Panier = () => (
  <div className="bg-bg-base p-6">
    <div className="w-96 rounded-xl border border-border-subtle bg-bg-elevated p-4 space-y-1.5">
      <div className="flex items-center justify-between text-sm text-text-primary">
        <span>Sous-total</span>
        <span className="font-mono tabular-nums">Rp 186,000</span>
      </div>
      {applied.map((a) => (
        <PromotionLineRow key={a.promotion_id} applied={a} />
      ))}
      <div className="flex items-center justify-between border-t border-border-subtle pt-2 text-sm font-semibold text-text-primary">
        <span>Total</span>
        <span className="font-mono tabular-nums">Rp 166,400</span>
      </div>
    </div>
  </div>
);

// Mêmes rangées sous le thème ivoire du back-office (détail de commande).
export const Backoffice = () => (
  <div className="theme-backoffice bg-bg-base p-6">
    <div className="w-96 rounded-xl border border-border-subtle bg-bg-elevated p-4 space-y-1.5">
      {applied.map((a) => (
        <PromotionLineRow key={a.promotion_id} applied={a} />
      ))}
    </div>
  </div>
);
