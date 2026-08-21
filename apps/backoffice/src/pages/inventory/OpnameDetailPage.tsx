// apps/backoffice/src/pages/inventory/OpnameDetailPage.tsx
// Session 14 / Phase 4.C — opname workflow page, rewritten against the
// `stock opname.jpg` screenshot family.
//
// Header (back link + count number + status) → KPI tile row (section, items
// counted vs pending, total |variance|) → optional add-item form → items
// DataTable → action footer (Validate / Finalize / Cancel + error banner).
//
// Comptage à l'aveugle — l'inventaire se fait en deux temps :
//   1. COMPTAGE (draft, counting) — l'écran ne montre QUE ce qu'on saisit.
//      L'attendu, l'écart par ligne et le total des écarts sont masqués : les
//      afficher pendant qu'on compte invite à recopier l'attendu au lieu de
//      déclarer ce qu'on a vu sur l'étagère.
//   2. REVUE (review) — « Valider » révèle tout et FIGE la saisie.
// Le retour en arrière n'existe pas côté serveur : le seul recours après la
// révélation est d'annuler l'inventaire, d'où la confirmation sur Valider et le
// bouton Annuler qui reste offert en revue.

import { useMemo, useState, type JSX } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, ClipboardList, EyeOff, Layers, Sigma, X } from 'lucide-react';
import { Button, EmptyState, KpiTile } from '@breakery/ui';
import { formatQuantity } from '@breakery/utils';
import { QueryErrorBanner } from '@/components/QueryErrorBanner.js';
import { errorDetailText } from '@/components/errorDetailText.js';
import { DetailPageSkeleton } from '@/components/DetailPageSkeleton.js';
import { useAuthStore } from '@/stores/authStore.js';
import { useOpnameDetail } from '@/features/inventory-opname/hooks/useOpnameDetail.js';
import { OpnameStatusBadge } from '@/features/inventory-opname/components/OpnameStatusBadge.js';
import { CountItemRow } from '@/features/inventory-opname/components/CountItemRow.js';
import { AddItemForm } from '@/features/inventory-opname/components/AddItemForm.js';
import { ValidateOpnameDialog } from '@/features/inventory-opname/components/ValidateOpnameDialog.js';
import { FinalizeOpnameDialog } from '@/features/inventory-opname/components/FinalizeOpnameDialog.js';
import { CancelOpnameDialog } from '@/features/inventory-opname/components/CancelOpnameDialog.js';

export default function OpnameDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const detail = useOpnameDetail(id ?? null);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canFinalize = hasPermission('inventory.opname.finalize');
  const canCreate   = hasPermission('inventory.opname.create');

  const [showValidate, setShowValidate] = useState<boolean>(false);
  const [showFinalize, setShowFinalize] = useState<boolean>(false);
  const [showCancel,   setShowCancel  ] = useState<boolean>(false);

  // Compute even when data is undefined so hook order stays stable.
  const items    = detail.data?.items ?? [];
  const status   = detail.data?.status;
  /** Phase comptage : rien de l'attendu ne doit filtrer à l'écran. */
  const counting = status === 'draft' || status === 'counting';
  /** L'attendu et les écarts sont visibles (revue, finalisé, annulé). */
  const revealed = status !== undefined && !counting;
  /** Plus aucune saisie : la revue fige les chiffres comptés. */
  const locked   = revealed;
  /** Inventaire clos — plus rien à annuler. */
  const terminal = status === 'finalized' || status === 'cancelled';
  const stats     = useMemo(() => {
    let counted = 0;
    let pending = 0;
    let varianceTotal = 0;
    for (const i of items) {
      if (i.counted_qty === null) pending += 1;
      else counted += 1;
      varianceTotal += Math.abs(i.variance ?? 0);
    }
    return { counted, pending, varianceTotal };
  }, [items]);
  /**
   * Ce qui verrouille l'action terminale, en toutes lettres. `null` = rien ne
   * bloque. Un bouton désactivé muet fait chercher la ligne fautive à la main
   * sur un comptage de plusieurs dizaines de lignes.
   */
  const blockReason = useMemo<string | null>(() => {
    if (items.length === 0) return 'Add at least one line before validating.';
    if (stats.pending > 0) {
      return stats.pending === 1
        ? '1 line still uncounted — enter its quantity to continue.'
        : `${String(stats.pending)} lines still uncounted — enter their quantities to continue.`;
    }
    return null;
  }, [items.length, stats.pending]);
  if (detail.isLoading) {
    return <DetailPageSkeleton label="Loading stock count" data-testid="opname-detail-loading" />;
  }
  if (detail.error !== null) {
    return (
      <QueryErrorBanner
        detail={errorDetailText(detail.error)}
        onRetry={() => { void detail.refetch(); }}
        data-testid="opname-detail-error"
      >
        This stock count could not be loaded — nothing below is shown, so no
        figure here is a zero.
      </QueryErrorBanner>
    );
  }
  if (detail.data === null || detail.data === undefined) {
    return (
      <div className="space-y-4">
        <Link to="/backoffice/inventory/opname" className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary">
          <ArrowLeft className="h-4 w-4" aria-hidden /> Back to counts
        </Link>
        <EmptyState
          icon={ClipboardList}
          title="Count not found"
          description="This stock count may have been deleted or you do not have access."
          size="md"
        />
      </div>
    );
  }

  const d = detail.data;

  return (
    <div className="space-y-6">
      <header>
        <Link
          to="/backoffice/inventory/opname"
          className="inline-flex items-center gap-1 text-xs text-text-secondary transition-colors duration-fast hover:text-text-primary"
        >
          <ArrowLeft className="h-3 w-3" aria-hidden /> Back to counts
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-[23px] font-semibold leading-tight tracking-[-0.015em] text-text-primary font-mono">{d.count_number}</h1>
          <OpnameStatusBadge status={d.status} />
        </div>
      </header>

      <section
        className="grid grid-cols-1 gap-4 md:grid-cols-3"
        aria-label="Count progress"
      >
        {/* ADR-027 — le comptage est global. La tuile ne nomme plus qu'une
            section d'ÉPOQUE, pour les comptages sectionnés d'avant l'ADR. */}
        <KpiTile
          label="Section"
          value={d.section?.name ?? 'Global'}
          icon={Layers}
          footer={d.section?.code ?? undefined}
        />
        <KpiTile
          label="Items counted"
          value={stats.counted}
          icon={CheckCircle2}
          footer={`${stats.pending} pending of ${items.length}`}
        />
        {revealed ? (
          <KpiTile
            label="Total |variance|"
            value={formatQuantity(stats.varianceTotal, null)}
            icon={Sigma}
            footer="Sum of absolute deltas"
          />
        ) : (
          // Le total des écarts révélerait l'attendu par soustraction. La tuile
          // n'est pas retirée : sa place dit qu'il y a bien quelque chose à
          // voir, plus tard.
          <div
            className="rounded-lg border border-border-subtle bg-bg-elevated p-4"
            data-testid="blind-count-notice"
          >
            <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-text-muted">
              <EyeOff className="h-3.5 w-3.5" aria-hidden /> Blind count
            </div>
            <p className="mt-2 text-sm text-text-secondary">
              Expected quantities and variances stay hidden until you validate.
              Record what you actually see on the shelf.
            </p>
          </div>
        )}
      </section>

      {!locked && canCreate && (
        <AddItemForm countId={d.id} />
      )}

      {items.length === 0 ? (
        <div className="rounded-lg border border-border-subtle bg-bg-elevated">
          <EmptyState
            icon={ClipboardList}
            title="No items in this count"
            description={
              !locked && canCreate
                ? 'Add items above to begin recording counts.'
                : 'This count has no items recorded.'
            }
            size="md"
          />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm bg-bg-elevated rounded-lg border border-border-subtle overflow-hidden">
            <caption className="sr-only">Expected quantity, counted quantity, variance and notes per counted product</caption>
            <thead className="bg-surface-inert border-b border-border-subtle">
              <tr>
                <th scope="col" className="text-left py-3 px-4 text-xs uppercase tracking-widest text-text-muted">Product</th>
                {revealed && (
                  <th scope="col" className="text-right py-3 px-4 text-xs uppercase tracking-widest text-text-muted">Expected</th>
                )}
                <th scope="col" className="text-left py-3 px-4 text-xs uppercase tracking-widest text-text-muted">Counted</th>
                {revealed && (
                  <th scope="col" className="text-right py-3 px-4 text-xs uppercase tracking-widest text-text-muted">Variance</th>
                )}
                <th scope="col" className="text-left py-3 px-4 text-xs uppercase tracking-widest text-text-muted">Notes</th>
                {!locked && <th scope="col"><span className="sr-only">Actions</span></th>}
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <CountItemRow key={it.id} countId={d.id} item={it} revealed={revealed} locked={locked} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* La raison d'un bouton verrouillé est portée par la page, pas par le
          bouton : un bouton désactivé n'est pas focalisable, donc ni le clavier
          ni le lecteur d'écran n'atteindraient un `title`. Le texte est visible
          ET référencé par `aria-describedby`. */}
      <footer className="flex flex-col gap-3 md:flex-row md:items-center md:justify-end">
        {blockReason !== null && (
          <p id="opname-block-reason" className="text-sm text-text-secondary md:mr-auto">
            {blockReason}
          </p>
        )}
        {counting && canCreate && (
          <Button
            variant="ghost"
            onClick={() => { setShowValidate(true); }}
            disabled={blockReason !== null}
            {...(blockReason !== null ? { 'aria-describedby': 'opname-block-reason' } : {})}
          >
            <CheckCircle2 className="h-4 w-4" aria-hidden />
            Validate &amp; reveal variances
          </Button>
        )}
        {/* `review` UNIQUEMENT. Offrir Finaliser pendant le comptage rendait la
            révélation facultative : on postait le JE définitif sans avoir vu les
            écarts. Le serveur refuse désormais aussi (finalize_opname_v3). */}
        {d.status === 'review' && canFinalize && (
          <Button
            variant="ink"
            onClick={() => { setShowFinalize(true); }}
            disabled={blockReason !== null}
            {...(blockReason !== null ? { 'aria-describedby': 'opname-block-reason' } : {})}
          >
            Finalize and post JE
          </Button>
        )}
        {/* Annuler reste offert en revue : c'est le SEUL recours si la
            révélation découvre une faute de frappe. */}
        {!terminal && canCreate && (
          <Button variant="ghost" onClick={() => { setShowCancel(true); }}>
            <X className="h-4 w-4" aria-hidden /> Cancel
          </Button>
        )}
      </footer>

      {d.status === 'cancelled' && d.cancel_reason !== null && (
        <div className="border-l border-danger bg-bg-elevated px-3 py-2 text-sm text-text-secondary">
          <span className="font-semibold text-text-primary">Cancelled:</span> {d.cancel_reason}
        </div>
      )}

      {showValidate && (
        <ValidateOpnameDialog
          countId={d.id}
          countedItems={stats.counted}
          onClose={() => { setShowValidate(false); }}
        />
      )}
      {showFinalize && (
        <FinalizeOpnameDialog
          countId={d.id}
          items={d.items}
          onClose={() => { setShowFinalize(false); }}
        />
      )}
      {showCancel && (
        <CancelOpnameDialog
          countId={d.id}
          onClose={() => { setShowCancel(false); }}
        />
      )}
    </div>
  );
}
