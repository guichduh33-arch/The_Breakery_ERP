import { Separator } from '@breakery/ui';

// Horizontal — between ticket lines (the everyday use).
export const TicketLines = () => (
  <div className="bg-bg-base p-6 rounded-lg w-80">
    <div className="flex items-center justify-between py-2 text-sm">
      <span className="text-text-secondary">2× Croissant au beurre</span>
      <span className="font-mono text-text-primary">Rp 56.000</span>
    </div>
    <Separator />
    <div className="flex items-center justify-between py-2 text-sm">
      <span className="text-text-secondary">1× Es kopi susu</span>
      <span className="font-mono text-text-primary">Rp 32.000</span>
    </div>
    <Separator />
    <div className="flex items-center justify-between py-2 text-sm">
      <span className="font-medium text-text-primary">Total</span>
      <span className="font-mono font-semibold text-gold">Rp 88.000</span>
    </div>
  </div>
);

// Vertical — dividing inline stats (needs an explicit height context).
export const VerticalStats = () => (
  <div className="bg-bg-base p-6 rounded-lg w-96">
    <div className="flex h-12 items-center justify-between">
      <div className="flex flex-col">
        <span className="text-xs uppercase tracking-widest text-text-muted">Orders</span>
        <span className="font-mono text-lg text-text-primary">42</span>
      </div>
      <Separator orientation="vertical" />
      <div className="flex flex-col">
        <span className="text-xs uppercase tracking-widest text-text-muted">Sales</span>
        <span className="font-mono text-lg text-text-primary">Rp 3.860.000</span>
      </div>
      <Separator orientation="vertical" />
      <div className="flex flex-col">
        <span className="text-xs uppercase tracking-widest text-text-muted">Avg ticket</span>
        <span className="font-mono text-lg text-text-primary">Rp 92.000</span>
      </div>
    </div>
  </div>
);
