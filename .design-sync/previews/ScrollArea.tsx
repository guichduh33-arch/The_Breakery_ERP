import { ScrollArea } from '@breakery/ui';

const ticketLines = [
  ['2 × Croissant beurre', 'Rp 36,000'],
  ['1 × Pain au chocolat', 'Rp 20,000'],
  ['1 × Baguette tradition', 'Rp 28,000'],
  ['2 × Latte', 'Rp 64,000'],
  ['1 × Éclair café', 'Rp 25,000'],
  ['3 × Cookie chocolat', 'Rp 45,000'],
  ['1 × Tarte citron', 'Rp 38,000'],
  ['2 × Americano', 'Rp 48,000'],
  ['1 × Quiche lorraine', 'Rp 42,000'],
  ['1 × Chausson aux pommes', 'Rp 22,000'],
] as const;

// Ticket POS : liste plus haute que sa fenêtre, barre de défilement du kit
// (type="always" pour la rendre visible en statique).
export const OrderTicket = () => (
  <div className="bg-bg-base p-6">
    <ScrollArea
      type="always"
      className="h-64 w-80 rounded-md border border-border-subtle bg-bg-elevated"
    >
      <div className="p-4">
        <p className="mb-3 font-semibold text-text-primary">Commande #1042 — Table 4</p>
        <ul className="space-y-2 text-sm text-text-secondary">
          {ticketLines.map(([label, price]) => (
            <li key={label} className="flex justify-between gap-4">
              <span>{label}</span>
              <span className="font-mono tabular-nums">{price}</span>
            </li>
          ))}
        </ul>
      </div>
    </ScrollArea>
  </div>
);

// Sous le thème ivoire du back-office (liste de mouvements de stock).
export const Backoffice = () => (
  <div className="theme-backoffice bg-bg-base p-6">
    <ScrollArea
      type="always"
      className="h-56 w-96 rounded-md border border-border-subtle bg-bg-elevated"
    >
      <div className="p-4">
        <p className="mb-3 font-semibold text-text-primary">Réception du 17 août</p>
        <ul className="space-y-2 text-sm text-text-secondary">
          {[
            ['Farine T55', '25 kg'],
            ['Beurre AOP', '10 kg'],
            ['Levure fraîche', '2 kg'],
            ['Chocolat 64%', '8 kg'],
            ['Sucre glace', '5 kg'],
            ['Œufs', '360 pcs'],
            ['Crème 35%', '12 L'],
            ['Lait entier', '24 L'],
            ['Amandes effilées', '3 kg'],
          ].map(([label, qty]) => (
            <li key={label} className="flex justify-between gap-4">
              <span>{label}</span>
              <span className="font-mono tabular-nums">{qty}</span>
            </li>
          ))}
        </ul>
      </div>
    </ScrollArea>
  </div>
);
