import { KpiTile } from '@breakery/ui';
import { Banknote, ShoppingBag, Users } from 'lucide-react';

// La rangée KPI du dashboard back-office (thème ivoire) — l'usage d'origine.
export const Dashboard = () => (
  <div className="theme-backoffice grid grid-cols-3 gap-4 bg-bg-base p-6">
    <KpiTile
      label="Today's revenue"
      value={4850000}
      valueFormat="currency"
      icon={Banknote}
      delta={{ value: '12%', direction: 'up', hint: 'vs hier' }}
    />
    <KpiTile
      label="Orders"
      value={142}
      icon={ShoppingBag}
      delta={{ value: '4%', direction: 'down', hint: 'vs hier' }}
    />
    <KpiTile
      label="Customers"
      value={96}
      icon={Users}
      delta={{ value: '0', direction: 'neutral' }}
    />
  </div>
);

// Formats de valeur : currency / percent / number, avec footer.
export const Formats = () => (
  <div className="theme-backoffice grid grid-cols-3 gap-4 bg-bg-base p-6">
    <KpiTile label="Avg basket" value={74500} valueFormat="currency" />
    <KpiTile label="Gross margin" value={62} valueFormat="percent" delta={{ value: '1,5%', direction: 'up' }} />
    <KpiTile label="Items sold" value={318} footer="Sur 142 commandes" />
  </div>
);

// Sous le thème sombre POS (tuile de shift / caisse).
export const PosDark = () => (
  <div className="grid grid-cols-2 gap-4 bg-bg-base p-6">
    <KpiTile label="Cash in drawer" value={2150000} valueFormat="currency" />
    <KpiTile label="Shift orders" value={57} delta={{ value: '8', direction: 'up', hint: 'vs shift préc.' }} />
  </div>
);
