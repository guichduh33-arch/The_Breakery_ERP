// apps/backoffice/src/features/inventory-production/components/RevertProductionAction.tsx
//
// L'AFFORDANCE DE CONTRE-ÉCRITURE d'une ligne du journal de production.
//
// POURQUOI ELLE EXISTE (2026-08-21). Tout était construit — la RPC
// `revert_production_v2`, le hook `useRevertProduction`, le dialogue
// `RevertProductionDialog` avec ses messages de blocage — et RIEN n'était
// branché : le seul composant qui montait le dialogue,
// `ProductionRecordList.tsx`, n'a aucun importeur dans `apps/backoffice/src`,
// et l'écran réellement atteignable (`ProductionTodayPanel`) ne rendait aucune
// action de ligne. Concrètement : le responsable production saisissait 200
// croissants au lieu de 20, le stock était déduit, l'écriture comptable passée,
// et AUCUN écran du back-office n'offrait de correctif.
//
// C'est le Product Principle 5 de `apps/backoffice/PRODUCT.md` — « rien ne se
// corrige, tout se compense » — qui exige cette affordance : l'interface doit
// proposer l'écriture corrective. Le journal reste append-only ; annuler une
// fournée pose une CONTRE-ÉCRITURE (stock restitué, JE de contrepassation), ce
// n'est pas une gomme.
//
// LA GATE — `inventory.production.delete` (ADR-008 D8 : la permission suffit,
// pas de PIN ; le serveur la revérifie de toute façon). Le bouton se rend
// DÉSACTIVÉ AVEC SA RAISON, jamais masqué : c'est le motif déjà en place sur le
// bandeau du catalogue produits (`features/products/components/ProductsHeader`),
// et il vaut la peine d'être tenu — une action absente ne s'explique pas, une
// action grisée qui porte son motif s'explique seule.
//
// ADR-008 D7 — le serveur refuse dès que le stock produit est ressorti
// (`already_consumed`) et renvoie la liste des sorties qui bloquent. Ce refus
// n'est PAS anticipé ici : il dépend de mouvements que le panneau ne lit pas, et
// un bouton masqué « au cas où » redonnerait le défaut qu'on corrige. C'est
// `RevertProductionDialog` qui nomme l'issue (un ajustement de stock) et liste
// les sorties — il le fait déjà, on ne le réécrit pas.
//
// Ce composant est monté par `ProductionTodayPanel` (l'écran atteignable) ET par
// `ProductionRecordList` (l'orphelin), pour que l'affordance n'existe qu'en un
// exemplaire le jour où le second retrouve un appelant.

import { useId, useState, type JSX } from 'react';
import { Undo2 } from 'lucide-react';
import { cn } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore.js';
import { FOCUS_RING } from '@/components/focusRing.js';
import { RevertProductionDialog } from './RevertProductionDialog.js';

/** La raison, en toutes lettres — elle est lue par la souris ET par le lecteur d'écran. */
export const REVERT_NO_PERMISSION_REASON =
  'Reverting a batch requires the "Revert production" permission (admin).';

export interface RevertProductionActionProps {
  productionId: string;
  productionNumber: string;
  className?: string;
}

// Le bouton d'action de ligne : secondaire, bordé `border-strong` (le seul trait
// qui le délimite, donc les 3:1 de WCAG 1.4.11), 3 px de rayon. DÉSACTIVÉ, il
// NEUTRALISE sa couleur au lieu de la faner — DESIGN.md § Boutons.
const ROW_ACTION =
  'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-sm border border-border-strong ' +
  'bg-bg-elevated px-2 text-xs font-medium text-text-primary transition-colors hover:bg-surface-4 ' +
  'disabled:cursor-not-allowed disabled:border-border-subtle disabled:bg-surface-4 ' +
  'disabled:text-text-muted disabled:opacity-100';

export function RevertProductionAction({
  productionId, productionNumber, className,
}: RevertProductionActionProps): JSX.Element {
  const canRevert = useAuthStore((s) => s.hasPermission)('inventory.production.delete');
  const [open, setOpen] = useState(false);
  const reasonId = useId();

  return (
    <>
      <button
        type="button"
        onClick={() => { setOpen(true); }}
        disabled={!canRevert}
        data-testid={`revert-production-${productionNumber}`}
        {...(canRevert ? {} : { title: REVERT_NO_PERMISSION_REASON, 'aria-describedby': reasonId })}
        className={cn(ROW_ACTION, FOCUS_RING, className)}
      >
        <Undo2 className="h-3.5 w-3.5 text-text-muted" aria-hidden />
        Revert
      </button>
      {!canRevert && <span id={reasonId} className="sr-only">{REVERT_NO_PERMISSION_REASON}</span>}
      {open && (
        <RevertProductionDialog
          productionId={productionId}
          productionNumber={productionNumber}
          onClose={() => { setOpen(false); }}
        />
      )}
    </>
  );
}
