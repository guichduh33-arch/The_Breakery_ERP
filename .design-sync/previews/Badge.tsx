import { Badge } from '@breakery/ui';

// Canonical status chips — the semantic tonal variants are THE way screens
// tag order/stock/payment states (no raw Tailwind palette pills).
export const SemanticStatuses = () => (
  <div className="bg-bg-base p-6 rounded-lg flex flex-wrap items-center gap-2">
    <Badge variant="success">Paid</Badge>
    <Badge variant="warning">Low stock</Badge>
    <Badge variant="info">Dine-in</Badge>
    <Badge variant="destructive">Voided</Badge>
  </div>
);

export const AllVariants = () => (
  <div className="bg-bg-base p-6 rounded-lg flex flex-wrap items-center gap-2">
    <Badge>Signature</Badge>
    <Badge variant="secondary">Take-out</Badge>
    <Badge variant="outline">Gluten-free</Badge>
    <Badge variant="neutral">Draft</Badge>
  </div>
);

export const InContext = () => (
  <div className="bg-bg-base p-6 rounded-lg flex items-center justify-between gap-4 w-80">
    <div className="flex flex-col gap-1">
      <span className="text-sm text-text-primary font-medium">Croissant au beurre</span>
      <span className="text-xs text-text-muted">SKU VIEN-001</span>
    </div>
    <Badge variant="warning">3 left</Badge>
  </div>
);
