import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@breakery/ui';

// Composition canonique : en-tête serif + contenu + pied d'action.
export const Composition = () => (
  <div className="bg-bg-base p-6">
    <Card className="max-w-sm">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Commande #1042</CardTitle>
          <Badge variant="success">Payée</Badge>
        </div>
        <CardDescription>Sur place — Table 4 · 14:32</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2 text-sm text-text-secondary">
          <li className="flex justify-between"><span>2 × Croissant beurre</span><span className="font-mono tabular-nums">Rp 36,000</span></li>
          <li className="flex justify-between"><span>1 × Latte</span><span className="font-mono tabular-nums">Rp 32,000</span></li>
          <li className="flex justify-between border-t border-border-subtle pt-2 font-semibold text-text-primary"><span>Total</span><span className="font-mono tabular-nums">Rp 68,000</span></li>
        </ul>
      </CardContent>
      <CardFooter className="gap-2">
        <Button size="sm">Encaisser</Button>
        <Button size="sm" variant="outline">Imprimer</Button>
      </CardFooter>
    </Card>
  </div>
);

// L'axe de variantes : default / elevated / inset.
export const Variants = () => (
  <div className="grid gap-4 bg-bg-base p-6">
    <Card variant="default" padding="md">
      <p className="text-sm text-text-primary">default — panneau standard (bg-elevated, shadow-sm)</p>
    </Card>
    <Card variant="elevated" padding="md">
      <p className="text-sm text-text-primary">elevated — un cran de surface au-dessus (surface-3, shadow-md)</p>
    </Card>
    <Card variant="inset" padding="md">
      <p className="text-sm text-text-primary">inset — encastré dans le fond (bg-base, ombre interne)</p>
    </Card>
  </div>
);

// La même carte sous le thème ivoire du back-office.
export const Backoffice = () => (
  <div className="theme-backoffice bg-bg-base p-6">
    <Card className="max-w-sm">
      <CardHeader>
        <CardTitle>Ventes du jour</CardTitle>
        <CardDescription>Dimanche 17 août — service en cours</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-text-secondary">142 commandes · panier moyen <span className="font-mono tabular-nums">Rp 74,500</span></p>
      </CardContent>
    </Card>
  </div>
);
