import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from '@breakery/ui';

// État ouvert canonique — composition Radix complète (Content > Header >
// Title/Description > corps > Footer) sur le voile bg-backdrop, fond luxe-dark.
export const Open = () => (
  <div className="fixed inset-0 bg-bg-base">
    <Dialog open onOpenChange={() => {}}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Modifier le prix</DialogTitle>
          <DialogDescription>
            Croissant beurre — prix de vente affiché au POS.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label
              htmlFor="dlg-price"
              className="text-xs uppercase tracking-widest text-text-secondary"
            >
              Prix de vente (IDR)
            </label>
            <Input id="dlg-price" inputMode="numeric" value="36000" onChange={() => {}} />
          </div>
          <p className="text-xs text-text-muted">
            Dernier prix : <span className="font-mono tabular-nums">Rp 34,000</span> — modifié le 12 août.
          </p>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="secondary">Annuler</Button>
          <Button variant="primary">Enregistrer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
);
