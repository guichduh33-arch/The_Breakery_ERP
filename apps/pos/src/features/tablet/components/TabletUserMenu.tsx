import { useRef, useState } from 'react';
import { UserRound } from 'lucide-react';
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore';
import { useTabletCartStore } from '@/stores/tabletCartStore';

export function TabletUserMenu() {
  const user = useAuthStore((s) => s.user);
  const blocked = useTabletCartStore((s) => s.items.length > 0 || s.pendingSend !== null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const switching = useRef(false);

  async function switchUser() {
    // Relire au clic : un envoi peut avoir commencé depuis l'ouverture.
    const cart = useTabletCartStore.getState();
    if (switching.current || cart.items.length > 0 || cart.pendingSend) return;
    switching.current = true;
    setBusy(true);
    // Le dialogue reste modal pendant la déconnexion : aucune nouvelle saisie.
    cart.clearCart();
    try {
      await useAuthStore.getState().logout();
    } finally {
      switching.current = false;
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={`Switch user: ${user?.full_name ?? 'Waiter'}`}
        className="min-w-0 min-h-10 sm:min-h-12 flex items-center gap-2 rounded-md px-2 font-semibold text-base sm:text-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold">
        <UserRound className="h-5 w-5 shrink-0" aria-hidden />
        <span className="truncate">{user?.full_name ?? 'Waiter'}</span>
      </button>
      <Dialog open={open} onOpenChange={(next) => { if (!switching.current) setOpen(next); }}>
        <DialogContent>
          <DialogTitle>Switch user</DialogTitle>
          <DialogDescription>
            {blocked
              ? 'Finish or clear the current cart before switching users. If an order is awaiting confirmation, resolve it first.'
              : 'Sign out and select another staff member to sign in with their PIN.'}
          </DialogDescription>
          <DialogFooter>
            <Button variant="secondary" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={blocked || busy} onClick={() => { void switchUser(); }}>
              {busy ? 'Signing out…' : 'Switch user'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
