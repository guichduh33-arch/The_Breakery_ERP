import { Badge } from '@breakery/ui';

// Puces de statut canoniques — les 8 variantes, contenu réaliste POS/BO.
export const Variants = () => (
  <div className="flex flex-wrap items-center gap-3 rounded-lg bg-bg-base p-6">
    <Badge>Nouveau</Badge>
    <Badge variant="success">Payée</Badge>
    <Badge variant="warning">En attente</Badge>
    <Badge variant="destructive">Annulée</Badge>
    <Badge variant="info">B2B</Badge>
    <Badge variant="secondary">Brouillon</Badge>
    <Badge variant="neutral">Archivé</Badge>
    <Badge variant="outline">Sur place</Badge>
  </div>
);

// Mêmes variantes sous le thème ivoire du back-office.
export const Backoffice = () => (
  <div className="theme-backoffice flex flex-wrap items-center gap-3 rounded-lg bg-bg-base p-6">
    <Badge>Nouveau</Badge>
    <Badge variant="success">Payée</Badge>
    <Badge variant="warning">En attente</Badge>
    <Badge variant="destructive">Annulée</Badge>
    <Badge variant="info">B2B</Badge>
    <Badge variant="secondary">Brouillon</Badge>
    <Badge variant="neutral">Archivé</Badge>
    <Badge variant="outline">Sur place</Badge>
  </div>
);
