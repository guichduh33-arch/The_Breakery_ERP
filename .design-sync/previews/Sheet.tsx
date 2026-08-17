import {
  Badge,
  Button,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@breakery/ui';

// Tiroir latéral canonique (side="right") — détail de commande façon ledger,
// l'usage d'origine du Sheet (panneaux de détail où la place verticale compte).
export const Right = () => (
  <div className="fixed inset-0 bg-bg-base">
    <Sheet open onOpenChange={() => {}}>
      <SheetContent side="right">
        <SheetHeader>
          <div className="flex items-center gap-2">
            <SheetTitle>Commande #1042</SheetTitle>
            <Badge variant="success">Payée</Badge>
          </div>
          <SheetDescription>Sur place — Table 4 · 14:32 · Caissier : Ayu</SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-6 py-2">
          <ul className="space-y-2 text-sm text-text-secondary">
            <li className="flex justify-between">
              <span>2 × Croissant beurre</span>
              <span className="font-mono tabular-nums">Rp 36,000</span>
            </li>
            <li className="flex justify-between">
              <span>1 × Pain au chocolat</span>
              <span className="font-mono tabular-nums">Rp 20,000</span>
            </li>
            <li className="flex justify-between">
              <span>1 × Latte — Oat milk</span>
              <span className="font-mono tabular-nums">Rp 42,000</span>
            </li>
            <li className="flex justify-between border-t border-border-subtle pt-2 text-text-primary">
              <span>Sous-total</span>
              <span className="font-mono tabular-nums">Rp 98,000</span>
            </li>
            <li className="flex justify-between">
              <span>Service &amp; PB1</span>
              <span className="font-mono tabular-nums">Rp 9,800</span>
            </li>
            <li className="flex justify-between font-semibold text-text-primary">
              <span>Total</span>
              <span className="font-mono tabular-nums">Rp 107,800</span>
            </li>
            <li className="flex justify-between pt-2">
              <span>QRIS</span>
              <span className="font-mono tabular-nums">Rp 107,800</span>
            </li>
          </ul>
        </div>
        <SheetFooter>
          <Button variant="secondary">Rembourser</Button>
          <Button variant="primary">Réimprimer le ticket</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  </div>
);
