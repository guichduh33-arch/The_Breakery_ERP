import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@breakery/ui';

// Full composition — the canonical Card anatomy (header → content → footer).
export const FullAnatomy = () => (
  <div className="bg-bg-base p-6 rounded-lg">
    <Card className="w-96">
      <CardHeader>
        <CardTitle>Viennoiserie du matin</CardTitle>
        <CardDescription>
          Baked fresh at 6 AM — croissants, pains au chocolat and kouign-amann
          from the Breakery lab.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between text-sm">
          <span className="text-text-secondary">Croissant au beurre</span>
          <span className="font-mono text-text-primary">Rp 28.000</span>
        </div>
        <div className="mt-2 flex items-center justify-between text-sm">
          <span className="text-text-secondary">Pain au chocolat</span>
          <span className="font-mono text-text-primary">Rp 32.000</span>
        </div>
      </CardContent>
      <CardFooter className="justify-between">
        <Badge variant="success">In stock</Badge>
        <span className="text-xs text-text-muted">Updated 07:15</span>
      </CardFooter>
    </Card>
  </div>
);

// The 3 chrome variants side by side — default / elevated / inset.
export const Variants = () => (
  <div className="bg-bg-base p-6 rounded-lg flex flex-col gap-4">
    <Card variant="default" padding="md" className="w-80">
      <p className="text-sm text-text-primary font-medium">Default</p>
      <p className="text-xs text-text-secondary">Standard panel — border + shadow-sm.</p>
    </Card>
    <Card variant="elevated" padding="md" className="w-80">
      <p className="text-sm text-text-primary font-medium">Elevated</p>
      <p className="text-xs text-text-secondary">Hover-raised panel for interactive tiles.</p>
    </Card>
    <Card variant="inset" padding="md" className="w-80">
      <p className="text-sm text-text-primary font-medium">Inset</p>
      <p className="text-xs text-text-secondary">Recessed well for nested content.</p>
    </Card>
  </div>
);
