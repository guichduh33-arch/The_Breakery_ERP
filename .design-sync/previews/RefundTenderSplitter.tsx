import { RefundTenderSplitter } from '@breakery/ui';

// Répartition du remboursement sur les moyens de paiement d'origine de la commande.
const methods = [
  { method: 'cash' as const, paid: 120_000, already_refunded: 0 },
  { method: 'qris' as const, paid: 80_000, already_refunded: 20_000 },
];

// Somme égale au total à rembourser — compteur neutre.
export const Equilibre = () => (
  <div className="bg-bg-base p-6">
    <div className="w-[480px]">
      <RefundTenderSplitter
        refundTotal={86_000}
        methods={methods}
        values={[
          { method: 'cash', amount: 50_000 },
          { method: 'qris', amount: 36_000 },
        ]}
        onChange={() => {}}
      />
    </div>
  </div>
);

// Somme incomplète — le compteur passe en danger tant que la répartition ne colle pas.
export const Desequilibre = () => (
  <div className="bg-bg-base p-6">
    <div className="w-[480px]">
      <RefundTenderSplitter
        refundTotal={86_000}
        methods={methods}
        values={[{ method: 'cash', amount: 30_000 }]}
        onChange={() => {}}
      />
    </div>
  </div>
);
