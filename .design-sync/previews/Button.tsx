import { Button } from '@breakery/ui';
import { Plus, Printer } from 'lucide-react';

// L'axe principal : les 8 variantes sur le thème luxe-dark POS.
export const Variants = () => (
  <div className="flex flex-wrap items-center gap-3 bg-bg-base p-6">
    <Button>Encaisser</Button>
    <Button variant="gold">Valider la commande</Button>
    <Button variant="secondary">Mettre en attente</Button>
    <Button variant="outlineGold">Imprimer le ticket</Button>
    <Button variant="ghost">Annuler</Button>
    <Button variant="ghostDestructive">Supprimer la ligne</Button>
    <Button variant="link">Voir le détail</Button>
    <Button variant="ink">Enregistrer</Button>
  </div>
);

// Tailles : sm / md / lg / icon (cibles tactiles POS).
export const Sizes = () => (
  <div className="flex flex-wrap items-center gap-3 bg-bg-base p-6">
    <Button size="sm" variant="secondary">
      <Plus size={16} /> Ajouter
    </Button>
    <Button size="md">Encaisser Rp 68,000</Button>
    <Button size="lg" variant="gold">Paiement — Rp 245,000</Button>
    <Button size="icon" variant="secondary" aria-label="Imprimer le ticket">
      <Printer size={18} />
    </Button>
  </div>
);

// Désactivé : les variantes pleines neutralisent leur couleur (surface-4),
// les plates gardent l'opacité de base.
export const Disabled = () => (
  <div className="flex flex-wrap items-center gap-3 bg-bg-base p-6">
    <Button disabled>Encaisser</Button>
    <Button variant="gold" disabled>Valider la commande</Button>
    <Button variant="outlineGold" disabled>Imprimer le ticket</Button>
    <Button variant="secondary" disabled>Mettre en attente</Button>
    <Button variant="ghost" disabled>Annuler</Button>
  </div>
);

// Back-office ivoire : l'action primaire est ENCRE, en casse de phrase.
export const Backoffice = () => (
  <div className="theme-backoffice flex flex-wrap items-center gap-3 bg-bg-base p-6">
    <Button variant="ink">Enregistrer le produit</Button>
    <Button variant="secondary">Annuler</Button>
    <Button variant="ghost">Exporter CSV</Button>
    <Button variant="ghostDestructive">Supprimer</Button>
    <Button variant="ink" disabled>Enregistrer le produit</Button>
  </div>
);
