import {
  Badge,
  Button,
  Separator,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@breakery/ui';

// Radix portal renders to <body> — fixed luxe-dark backdrop stands in for
// the app screen so the overlay blur reads correctly.
const Backdrop = () => (
  <div aria-hidden="true" className="fixed inset-0 bg-bg-base" />
);

// Canonical right drawer — order detail ledger (the Sheet's home use-case).
export const OrderDetailRight = () => (
  <>
    <Backdrop />
    <Sheet open>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>Order #A-0139</SheetTitle>
          <SheetDescription>Take-out · paid 08:47 · cashier Ni Luh</SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-6 text-sm">
          <div className="flex items-center justify-between py-2">
            <span className="text-text-secondary">1× Kouign-amann</span>
            <span className="font-mono text-text-primary">Rp 35.000</span>
          </div>
          <Separator />
          <div className="flex items-center justify-between py-2">
            <span className="text-text-secondary">2× Pain au chocolat</span>
            <span className="font-mono text-text-primary">Rp 64.000</span>
          </div>
          <Separator />
          <div className="flex items-center justify-between py-3">
            <span className="font-medium text-text-primary">Total</span>
            <span className="font-mono font-semibold text-gold">Rp 99.000</span>
          </div>
          <Badge variant="success">Paid — QRIS</Badge>
        </div>
        <SheetFooter>
          <Button variant="secondary">Print receipt</Button>
          <Button variant="gold">Reorder</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  </>
);

// Left variant — navigation-style drawer.
export const FilterLeft = () => (
  <>
    <Backdrop />
    <Sheet open>
      <SheetContent side="left">
        <SheetHeader>
          <SheetTitle>Filters</SheetTitle>
          <SheetDescription>Narrow the order history view.</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-2 px-6 text-sm text-text-primary">
          <label className="flex items-center gap-2">
            <input type="checkbox" defaultChecked /> Dine-in
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" defaultChecked /> Take-out
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" /> Voided only
          </label>
        </div>
        <SheetFooter>
          <Button variant="secondary">Reset</Button>
          <Button>Apply</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  </>
);
