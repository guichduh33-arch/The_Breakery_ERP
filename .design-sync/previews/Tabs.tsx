import { Tabs, TabsContent, TabsList, TabsTrigger } from '@breakery/ui';

// Composition complète : List + Triggers + Content, onglet actif doré.
export const Default = () => (
  <div className="bg-bg-base p-6">
    <Tabs defaultValue="pending">
      <TabsList>
        <TabsTrigger value="pending">En attente</TabsTrigger>
        <TabsTrigger value="preparing">En préparation</TabsTrigger>
        <TabsTrigger value="ready">Prêtes</TabsTrigger>
      </TabsList>
      <TabsContent value="pending">
        <div className="max-w-sm rounded-lg border border-border-subtle bg-bg-elevated p-4 text-sm">
          <div className="flex items-center justify-between font-semibold text-text-primary">
            <span>Commande #1042</span>
            <span className="font-mono tabular-nums">14:32</span>
          </div>
          <p className="mt-1 text-text-secondary">2 × Croissant beurre · 1 × Latte</p>
          <p className="mt-2 font-mono tabular-nums text-text-primary">Rp 68,000</p>
        </div>
      </TabsContent>
      <TabsContent value="preparing">
        <p className="text-sm text-text-secondary">3 commandes en préparation.</p>
      </TabsContent>
      <TabsContent value="ready">
        <p className="text-sm text-text-secondary">Aucune commande prête.</p>
      </TabsContent>
    </Tabs>
  </div>
);

// Un déclencheur désactivé (module non disponible pour ce rôle).
export const DisabledTrigger = () => (
  <div className="bg-bg-base p-6">
    <Tabs defaultValue="sales">
      <TabsList>
        <TabsTrigger value="sales">Ventes</TabsTrigger>
        <TabsTrigger value="refunds">Remboursements</TabsTrigger>
        <TabsTrigger value="zreport" disabled>
          Z-report
        </TabsTrigger>
      </TabsList>
      <TabsContent value="sales">
        <p className="text-sm text-text-secondary">
          142 commandes · <span className="font-mono tabular-nums">Rp 4,850,000</span>
        </p>
      </TabsContent>
    </Tabs>
  </div>
);

// Sous le thème ivoire du back-office (fiche fournisseur).
export const Backoffice = () => (
  <div className="theme-backoffice bg-bg-base p-6">
    <Tabs defaultValue="purchases">
      <TabsList>
        <TabsTrigger value="purchases">Achats</TabsTrigger>
        <TabsTrigger value="price">Historique des prix</TabsTrigger>
        <TabsTrigger value="payments">Règlements</TabsTrigger>
      </TabsList>
      <TabsContent value="purchases">
        <p className="text-sm text-text-secondary">
          12 bons de commande ce mois — total{' '}
          <span className="font-mono tabular-nums">Rp 18,240,000</span>.
        </p>
      </TabsContent>
    </Tabs>
  </div>
);
