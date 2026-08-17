import { EmptyState } from '@breakery/ui';
import { CreditCard, PackageOpen, ShoppingBag } from 'lucide-react';

// Composition canonique : icône + titre Playfair italique + description + CTA.
export const Default = () => (
  <div className="bg-bg-base p-6">
    <EmptyState
      icon={ShoppingBag}
      title="Aucune commande en attente"
      description="Les commandes mises en attente pendant le service apparaîtront ici."
      action={{ label: 'Nouvelle commande', onClick: () => {} }}
    />
  </div>
);

// L'axe de tailles : sm / md / lg (padding + illustration).
export const Sizes = () => (
  <div className="grid gap-4 bg-bg-base p-6">
    <div className="rounded-lg border border-border-subtle">
      <EmptyState
        size="sm"
        icon={CreditCard}
        title="Aucun paiement B2B"
        description="Les règlements reçus apparaîtront ici."
      />
    </div>
    <div className="rounded-lg border border-border-subtle">
      <EmptyState
        size="lg"
        icon={PackageOpen}
        title="Aucun transfert de stock"
        description="Créez votre premier transfert pour déplacer des matières entre sections."
        action={{ label: 'Créer un transfert', onClick: () => {} }}
      />
    </div>
  </div>
);

// Ton "branded" sans icône : la BrandMark prend la place de l'illustration.
export const Branded = () => (
  <div className="bg-bg-base p-6">
    <EmptyState
      tone="branded"
      title="Aucun produit ne correspond aux filtres"
      description="Essayez d'élargir la recherche ou de retirer un filtre de catégorie."
    />
  </div>
);

// Sous le thème ivoire du back-office.
export const Backoffice = () => (
  <div className="theme-backoffice bg-bg-base p-6">
    <EmptyState
      icon={CreditCard}
      title="Aucune créance en cours"
      description="Tous les clients B2B sont à jour de leurs règlements."
    />
  </div>
);
