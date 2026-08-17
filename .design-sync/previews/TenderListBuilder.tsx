import { TenderListBuilder } from '@breakery/ui';

// Paiement fractionné soldé : cash (avec monnaie) + QRIS, reste 0.
export const SplitCashQris = () => (
  <div className="bg-bg-base p-6">
    <TenderListBuilder
      className="mx-auto max-w-sm"
      tenders={[
        { method: 'cash', amount: 50000, cash_received: 100000, change_given: 50000 },
        { method: 'qris', amount: 18000 },
      ]}
      remaining={0}
      onRemoveTender={() => {}}
    />
  </div>
);

// Paiement partiel en cours : un tender posé, reste à encaisser.
export const Partiel = () => (
  <div className="bg-bg-base p-6">
    <TenderListBuilder
      className="mx-auto max-w-sm"
      tenders={[{ method: 'card', amount: 125000 }]}
      remaining={43000}
      onRemoveTender={() => {}}
    />
  </div>
);

// État vide — hint en pointillés avant le premier règlement.
export const Vide = () => (
  <div className="bg-bg-base p-6">
    <TenderListBuilder
      className="mx-auto max-w-sm"
      tenders={[]}
      remaining={168000}
      emptyHint="Aucun règlement — choisir un mode de paiement"
    />
  </div>
);
