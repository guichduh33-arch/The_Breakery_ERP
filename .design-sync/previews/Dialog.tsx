import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@breakery/ui';

// Radix portal renders to <body> — a fixed luxe-dark backdrop stands in for
// the app screen behind the modal so the overlay blur reads correctly.
const Backdrop = () => (
  <div aria-hidden="true" className="fixed inset-0 bg-bg-base" />
);

// Canonical confirm dialog — destructive action guarded by a secondary escape.
export const ConfirmVoid = () => (
  <>
    <Backdrop />
    <Dialog open>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Void order #A-0142?</DialogTitle>
          <DialogDescription>
            2× Croissant au beurre, 1× Es kopi susu — Rp 88.000. Voiding
            restores stock and requires a manager PIN. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="secondary">Keep order</Button>
          <Button variant="ghostDestructive">Void order</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>
);

// Small form dialog — header → fields → footer anatomy.
export const CustomerNote = () => (
  <>
    <Backdrop />
    <Dialog open>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Order note</DialogTitle>
          <DialogDescription>
            Shown on the kitchen ticket for table 4 — Pak Budi.
          </DialogDescription>
        </DialogHeader>
        <textarea
          className="h-24 w-full rounded-md border border-border-subtle bg-bg-input p-3 text-sm text-text-primary"
          defaultValue="Kouign-amann warmed up, no butter on the side."
        />
        <DialogFooter>
          <Button variant="secondary">Cancel</Button>
          <Button variant="gold">Save note</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>
);
