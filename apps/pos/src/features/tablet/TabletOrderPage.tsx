// apps/pos/src/features/tablet/TabletOrderPage.tsx
//
// Session 14 / Phase 3.C — Tablet (waiter) order entry page rewrite.
//
// Visual refs:
//   - docs/Design/backoffice/plan de table.jpg (sectioned floor plan)
//   - docs/Design/caissapp/40-floor-plan-no-selection.jpg (floor preview)
//   - docs/Design/caissapp/41-floor-plan-table-t12-selected.jpg
//
// This is the feature-level surface for the waiter tablet's order-entry
// flow. It composes:
//   - A tactile header with: back-to-floor-plan affordance, the active
//     table chip, dine-in / take-out toggle, and live cart total.
//   - The shared `TabletMenuView` (category sidebar + product grid) on
//     the left and `TabletCartPanel` on the right.
//   - A persistent "Send to Kitchen" CTA in the cart panel which goes
//     through `useCreateTabletOrder` → `create_tablet_order` RPC.
//   - An optional `<FloorPlanView>` overlay shown when the waiter taps
//     the table chip (mode === 'floor-plan').
//
// Touch-spacing strategy:
//   - Header: h ≥ touch-comfy (56px), gap-4, tap-targets ≥ 44px (min-h-11).
//   - Order-type tabs: each pill h-11 (44px) min, px-5.
//   - Floor plan overlay: full-bleed, no modal chrome — waiter swipes back.
//   - Generous gaps between sections (gap-6 / gap-8 in canvas).
//
// IO contract:
//   - Reads tables via `useRestaurantTables` and occupancy via
//     `useTableOccupancy` (both StrictMode-safe with per-mount channel
//     names — see CLAUDE.md note).
//   - Cart state lives in `tabletCartStore` (zustand).
//   - Order writes go through `useCreateTabletOrder` which wraps the
//     `create_tablet_order` RPC with `buildSubmitPayload` from
//     `@breakery/domain` — never raw inserts. After success, the cart
//     is cleared and the host typically navigates to `/tablet/orders`.

import { useState, useCallback, useEffect, useMemo, useRef, type JSX } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeft, CheckCircle2, MapPin, Send } from 'lucide-react';
import type { RestaurantTable } from '@breakery/domain';
import { Button, Currency } from '@breakery/ui';
import { calculatePreview } from '@breakery/domain';
import { useTaxConfig } from '@/features/settings/hooks/useTaxConfig';
import { useTabletCartStore } from '@/stores/tabletCartStore';
import { useAuthStore } from '@/stores/authStore';
import { useRestaurantTables } from '@/features/tables/hooks/useRestaurantTables';
import { useTableOccupancy } from '@/features/tables/hooks/useTableOccupancy';
import { useTableOrders } from '@/features/tables/hooks/useTableOrders';
import { TabletMenuView } from './components/TabletMenuView';
import { TabletCartPanel } from './components/TabletCartPanel';
import { OrderTypeToggle } from './components/OrderTypeToggle';
import { useTabletConnectionState } from './hooks/useTabletConnectionState';
import { useCreateTabletOrder } from './hooks/useCreateTabletOrder';
import { FloorPlanView } from './FloorPlanView';

type ViewMode = 'menu' | 'floor-plan';

export interface TabletOrderPageProps {
  /**
   * Optional injected dependencies — used by tests to bypass network IO.
   * Production callers can omit these entirely.
   */
  tablesOverride?: RestaurantTable[];
  occupancyOverride?: Record<string, boolean>;
  /** Where to navigate after a successful "send to kitchen". */
  redirectAfterSend?: string;
  /** Optional override for the create-order mutation (test seam). */
  onSendOverride?: (waiterId: string) => Promise<void>;
}

export function TabletOrderPage({
  tablesOverride,
  occupancyOverride,
  redirectAfterSend = '/tablet/orders',
  onSendOverride,
}: TabletOrderPageProps = {}): JSX.Element {
  const items = useTabletCartStore((s) => s.items);
  const tableNumber = useTabletCartStore((s) => s.tableNumber);
  // Critique 2026-08-24 (P1) — l'ordre de l'écran suit l'ordre du métier : la
  // première question du serveur est « quelle table ? ». Panier vide et sans
  // table (l'état par défaut, invalide à l'envoi pour un dine-in), on ouvre
  // sur le plan de salle ; « Back » mène au menu pour un take-out.
  // L'initialiseur (exécuté UNE fois) est fiable parce que BootGate (App.tsx)
  // monte les routes après l'hydratation du persist zustand — laquelle passe
  // par une microtâche, jamais vraiment en synchrone. Si BootGate saute un
  // jour, cet initialiseur lirait l'état pré-hydratation.
  const [view, setView] = useState<ViewMode>(() =>
    items.length === 0 && tableNumber === null ? 'floor-plan' : 'menu',
  );
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);

  const setTableNumber = useTabletCartStore((s) => s.setTableNumber);
  const orderType = useTabletCartStore((s) => s.orderType);
  const setOrderType = useTabletCartStore((s) => s.setOrderType);
  const notes = useTabletCartStore((s) => s.notes);
  const clearCart = useTabletCartStore((s) => s.clearCart);
  const appendToOrderId = useTabletCartStore((s) => s.appendToOrderId);
  const appendToOrderNumber = useTabletCartStore((s) => s.appendToOrderNumber);
  const setAppendTarget = useTabletCartStore((s) => s.setAppendTarget);
  const userId = useAuthStore((s) => s.user?.id);
  const navigate = useNavigate();

  const tablesQuery = useRestaurantTables();
  const liveOccupancy = useTableOccupancy();
  const tables = tablesOverride ?? tablesQuery.data ?? [];
  const occupancy = occupancyOverride ?? liveOccupancy;

  // Carte table → commande de salle encore complétable (2ᵉ tournée).
  const tableOrdersQuery = useTableOrders();
  const appendableByTable = useMemo(() => {
    const out: Record<string, { id: string; order_number: string }> = {};
    for (const [name, ref] of Object.entries(tableOrdersQuery.data ?? {})) {
      if (ref.appendable) out[name] = { id: ref.id, order_number: ref.order_number };
    }
    return out;
  }, [tableOrdersQuery.data]);

  const connection = useTabletConnectionState();
  const mutation = useCreateTabletOrder();
  const clientUuidRef = useRef<string>(crypto.randomUUID());

  // Critique 2026-08-25 (P1) — un envoi HORS-LIGNE ne laissait qu'un toast de 4 s ;
  // la preuve d'envoi disparaissait juste au moment où la serveuse doute le plus
  // que la commande soit partie, l'invitant à ré-envoyer un doublon. En ligne, la
  // grande bannière (page Orders) porte cette preuve ; hors-ligne, la commande
  // n'existe pas au cloud, donc on la porte EN PLACE, en bande persistante — jusqu'à
  // ce que la serveuse compose la commande suivante (1er article) ou la ferme.
  const [offlineSent, setOfflineSent] = useState<{
    localNumber: string;
    tableNumber: string | null;
    orderType: 'dine_in' | 'take_out';
  } | null>(null);
  useEffect(() => {
    if (items.length > 0) setOfflineSent(null);
  }, [items.length]);

  // Server tax config (rate + inclusive mode) — the header total must match
  // the amount the money-path will charge (mirror of _pb1_split_v1).
  const { taxRate, taxInclusive } = useTaxConfig();
  const preview = calculatePreview({ items, tableNumber, orderType }, taxRate, taxInclusive);
  const isEmpty = items.length === 0;
  const isSending = mutation.isPending;

  const isAppendMode = appendToOrderId !== null;
  // Critique 2026-08-24 (P1) — le refus « table requise » arrivait au dernier
  // tap. L'état est marqué AVANT : bouton table en ambre, CTA désactivé avec
  // le motif en libellé. La garde de handleSend reste (défense en profondeur).
  const tableMissing = !isAppendMode && orderType === 'dine_in' && !tableNumber?.trim();
  // Critique 2026-08-24 (P0) — `canSendOrders` était calculé et consommé nulle
  // part : en no_network le CTA restait actif et lançait un RPC sur un réseau
  // mort. Le bandeau explique, le bouton dit pourquoi il refuse.
  const sendDisabled = isEmpty || isSending || !connection.canSendOrders || tableMissing;
  const sendLabel = isSending
    ? 'Sending…'
    : !connection.canSendOrders
      ? 'Cannot send — no network'
      : tableMissing
        ? 'Select a table first'
        : isAppendMode
          ? 'Add to order'
          : 'Send to Kitchen';

  const handleTableSelect = useCallback(
    (name: string) => {
      // Choisir une table LIBRE sort du mode ajout : c'est une commande neuve.
      setAppendTarget(null);
      setTableNumber(name);
      setOrderType('dine_in');
      setView('menu');
      // Nouvelle commande : la confirmation hors-ligne précédente n'a plus lieu.
      setOfflineSent(null);
    },
    [setAppendTarget, setTableNumber, setOrderType],
  );

  const handleAppendSelect = useCallback(
    (name: string, order: { id: string; order_number: string }) => {
      setAppendTarget({ id: order.id, orderNumber: order.order_number, tableNumber: name });
      setView('menu');
      setOfflineSent(null);
    },
    [setAppendTarget],
  );

  const handleSend = useCallback(async () => {
    if (!userId || isEmpty) return;
    // Un nouvel envoi remplace la confirmation hors-ligne précédente.
    setOfflineSent(null);
    // S72 audit P1: a dine-in order needs a table (owner rule 2026-07-07). The
    // counter path enforces this (useDineInTableGuard + fire_counter_order
    // P0011); the tablet path did not, so a waiter could fire a dine-in order
    // with an empty table_number — no table on the KOT + a phantom occupancy.
    // En ajout, la table vient de la commande visée — pas de garde ici.
    if (!isAppendMode && orderType === 'dine_in' && !tableNumber?.trim()) {
      toast.error('Select a table for a dine-in order');
      setView('floor-plan');
      return;
    }
    try {
      let justSentOrderId: string | null = null;
      let offlineLocalNumber: string | null = null;
      if (onSendOverride) {
        await onSendOverride(userId);
      } else {
        const result = await mutation.mutateAsync({
          cart: { items, tableNumber, orderType, notes },
          waiterId: userId,
          clientUuid: clientUuidRef.current,
          ...(appendToOrderId !== null ? { appendToOrderId } : {}),
        });
        justSentOrderId = result.orderId;
        offlineLocalNumber = result.localNumber;
      }
      const appendedTo = appendToOrderNumber;
      clearCart();
      clientUuidRef.current = crypto.randomUUID();
      // Spec 006x lot 4 — envoi parti par le bus LAN : pas de commande cloud
      // à afficher dans la liste, on reste sur la prise de commande.
      if (offlineLocalNumber !== null) {
        toast.success(`Order ${offlineLocalNumber} sent to kitchen (offline)`);
        // Le toast disparaît en 4 s ; la bande, elle, reste comme preuve d'envoi
        // jusqu'à la commande suivante — pas de doute, donc pas de doublon.
        setOfflineSent({ localNumber: offlineLocalNumber, tableNumber, orderType });
        return;
      }
      if (appendedTo !== null) {
        // On reste sur la prise de commande : la serveuse enchaîne souvent une
        // autre table, et la commande complétée vit déjà dans son historique.
        toast.success(`Added to order ${appendedTo}`);
        return;
      }
      toast.success('Order sent to kitchen');
      void navigate(redirectAfterSend, { state: { justSentOrderId } });
    } catch (err) {
      const raw = err instanceof Error ? err.message : 'Failed to send order';
      // Critique 2026-08-24 (heuristique 9) — le message serveur brut était
      // servi tel quel à la serveuse, debout devant le client. Les causes
      // réseau (abort/timeout du RPC compris) parlent en clair ; le reste est
      // préfixé d'une phrase lisible, le détail reste pour le diagnostic.
      const isNetworkError = /abort|timed?\s?out|failed to fetch|network/i.test(raw);
      toast.error(
        raw === 'append_unavailable_offline'
          ? 'Append unavailable offline — start a new order'
          : raw === 'table_required_for_dine_in'
            ? 'Select a table for a dine-in order'
            : isNetworkError
              ? 'Network problem — the order was NOT sent. Check the connection and try again.'
              : `Could not send the order (${raw})`,
      );
    }
  }, [
    userId,
    isEmpty,
    isAppendMode,
    onSendOverride,
    mutation,
    items,
    tableNumber,
    orderType,
    notes,
    appendToOrderId,
    appendToOrderNumber,
    clearCart,
    navigate,
    redirectAfterSend,
    setView,
  ]);

  // ── Floor plan overlay ──────────────────────────────────────────────
  if (view === 'floor-plan') {
    return (
      <div className="flex flex-col h-full">
        <div className="px-6 py-3 border-b border-border-subtle bg-bg-elevated flex items-center gap-4">
          <Button
            variant="ghost"
            size="md"
            className="min-h-11 gap-2"
            onClick={() => setView('menu')}
            aria-label="Back to menu"
          >
            <ArrowLeft className="h-5 w-5" aria-hidden />
            Back
          </Button>
        </div>
        <div className="flex-1 overflow-hidden">
          <FloorPlanView
            tables={tables}
            occupancy={occupancy}
            loading={tablesOverride === undefined && tablesQuery.isLoading}
            selectedTable={tableNumber}
            onTableSelect={handleTableSelect}
            appendableByTable={appendableByTable}
            onAppendSelect={handleAppendSelect}
          />
        </div>
      </div>
    );
  }

  // ── Menu view ───────────────────────────────────────────────────────
  const toolbar = (
    <div
      className="px-6 py-4 flex items-center gap-4 border-b border-border-subtle bg-bg-elevated"
      data-testid="tablet-order-toolbar"
    >
      <Button
        variant="secondary"
        size="md"
        className={
          tableMissing
            ? 'min-h-11 gap-2 border-amber-warn text-amber-warn'
            : 'min-h-11 gap-2'
        }
        onClick={() => setView('floor-plan')}
        data-testid="tablet-order-pick-table"
      >
        <MapPin className="h-5 w-5 shrink-0" aria-hidden />
        {tableNumber ? `Table ${tableNumber}` : tableMissing ? 'Table required' : 'Pick a table'}
      </Button>

      {/* En ajout, le type est celui de la commande visée — le proposer ici
          laisserait croire qu'on peut le changer pour la 2ᵉ tournée. */}
      {!isAppendMode && <OrderTypeToggle value={orderType} onChange={setOrderType} />}

      <div className="ml-auto flex items-center gap-3" aria-label="Cart total">
        <span className="text-xs uppercase tracking-widest text-text-muted">Total</span>
        <Currency amount={preview.total} emphasis="gold" className="text-xl" />
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-full" data-testid="tablet-order-page">
      {/* Critique 2026-08-25 (P1) — preuve d'envoi PERSISTANTE en coupure. Le
          ticket est parti à la cuisine par le réseau local ; il se synchronisera
          au retour du cloud. La bande reste jusqu'à la commande suivante. */}
      {offlineSent && (
        <div
          className="px-6 py-2 flex items-center justify-between gap-4 bg-success-soft text-success border-b border-success"
          role="status"
          aria-live="polite"
          data-testid="tablet-offline-confirmation"
        >
          <span className="flex items-center gap-2 min-w-0 text-sm font-semibold">
            <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden />
            <span className="min-w-0">
              Order {offlineSent.localNumber} sent to the kitchen offline
              {offlineSent.tableNumber ? ` · Table ${offlineSent.tableNumber}` : ''} — syncs
              when you are back online.
            </span>
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="min-h-11 shrink-0"
            onClick={() => setOfflineSent(null)}
            data-testid="tablet-offline-confirmation-dismiss"
          >
            Dismiss
          </Button>
        </div>
      )}
      {/* Bandeau permanent : sans lui, rien ne distingue une 2ᵉ tournée d'une
          commande neuve, et la serveuse enverrait un doublon à la table. */}
      {isAppendMode && (
        <div
          className="px-6 py-2 flex items-center justify-between gap-4 bg-gold-soft text-gold border-b border-gold"
          role="status"
          data-testid="tablet-append-banner"
        >
          <span className="text-sm font-semibold">
            Adding to order {appendToOrderNumber}
            {tableNumber ? ` · Table ${tableNumber}` : ''}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="min-h-11"
            onClick={() => setAppendTarget(null)}
            data-testid="tablet-append-cancel"
          >
            Cancel
          </Button>
        </div>
      )}
      <div className="flex flex-1 overflow-hidden">
        <TabletMenuView
          selectedSlug={selectedSlug}
          onSelectCategory={setSelectedSlug}
          toolbar={toolbar}
        />
        {/* Le panneau porte sa propre largeur et son repli en portrait — pas de
            conteneur de largeur fixe par-dessus, sinon le repli se retrouve
            enfermé dans une colonne qui ne bouge pas. */}
        <TabletCartPanel
          footer={
            <Button
              variant="primary"
              size="lg"
              className="w-full"
              disabled={sendDisabled}
              onClick={() => {
                void handleSend();
              }}
              data-testid="tablet-order-send"
            >
              {sendLabel}
            </Button>
          }
          compactAction={
            <Button
              variant="primary"
              size="icon"
              className="w-full"
              disabled={sendDisabled}
              onClick={() => {
                void handleSend();
              }}
              aria-label={sendLabel}
              data-testid="tablet-order-send-compact"
            >
              <Send className="h-5 w-5" aria-hidden />
            </Button>
          }
        />
      </div>
    </div>
  );
}

export default TabletOrderPage;
