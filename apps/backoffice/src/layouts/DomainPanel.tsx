// apps/backoffice/src/layouts/DomainPanel.tsx
//
// Refonte shell 2026-08-05 — le drop-panel d'un domaine de la top bar.
//
// Panneau plat, ancré sous son onglet, à LARGEUR VARIABLE : une colonne par
// groupe déclaré dans `nav.ts` (3 pour Stock, 5 pour Reports, 4 pour Admin).
// La largeur est calculée puis BORNÉE à la fenêtre, et le panneau se recale
// vers la gauche s'il déborderait à droite — sinon Admin sortirait de l'écran
// sur un 1440.
//
// Le composant ne gère ni l'ouverture ni la fermeture : la TopBar en est
// propriétaire (clic, Échap, clic extérieur, survol quand la barre est déjà
// ouverte). Ici on ne s'occupe que du rendu et de la navigation au clavier
// interne (Tab parcourt les liens, Échap remonte à la TopBar).

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { cn } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore.js';
import { useAlertsCount } from '@/features/inventory-alerts/hooks/useAlertsCount.js';
import type { NavColumn, NavDomain } from './nav.js';

/** Largeur cible d'une colonne — CONTENU seul, gouttières à part. */
const COLUMN_WIDTH = 172;
/** Gouttière entre colonnes (columnGap de la grille). */
const COLUMN_GAP = 22;
/** Padding horizontal du panneau (18px 20px dans le handoff). */
const PANEL_PADDING_X = 40;
/** Gouttière de page — le panneau ne colle jamais au bord de la fenêtre. */
const VIEWPORT_MARGIN = 22;

/**
 * Le compteur d'alertes affiché à côté du lien « Alerts » de la colonne Watch.
 * Isolé dans son propre composant pour que le hook ne soit monté que lorsque le
 * lien est réellement rendu — donc seulement pour un utilisateur qui a le droit.
 */
function AlertsLinkCount() {
  const { total } = useAlertsCount();
  if (total === 0) return null;
  return (
    <span className="font-data text-xs font-bold text-danger tabular-nums" aria-hidden>
      {total > 99 ? '99+' : total}
    </span>
  );
}

function PanelColumn({ column, onNavigate }: { column: NavColumn; onNavigate: () => void }) {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const showAlertsCount = hasPermission('inventory.read');

  return (
    <div className="min-w-0">
      <p className="mb-2.5 font-data text-xs uppercase tracking-widest text-text-muted">
        {column.label}
      </p>
      <ul className="flex flex-col gap-[7px]">
        {column.links.map((link) => (
          <li key={link.to}>
            <NavLink
              to={link.to}
              {...(link.end === true ? { end: true } : {})}
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  'flex items-center justify-between gap-2 rounded-sm text-sm leading-tight transition-colors',
                  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold',
                  isActive
                    ? 'font-medium text-gold'
                    : 'text-text-primary hover:text-gold',
                )
              }
            >
              {/* Pas de truncate : la largeur du panneau est calculée pour le
                  contenu ; si la fenêtre clampe le panneau, le libellé passe à
                  la ligne au lieu d'être coupé. */}
              <span className="min-w-0">{link.label}</span>
              {link.to.endsWith('/inventory/alerts') && showAlertsCount && <AlertsLinkCount />}
            </NavLink>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface DomainPanelProps {
  domain: NavDomain;
  /** Bord gauche de l'onglet déclencheur, en px depuis le bord de la fenêtre. */
  anchorLeft: number;
  /** Fermer — remonté à la TopBar (Échap, ou navigation vers un lien). */
  onClose: () => void;
  /** Id d'élément pour le lien aria-controls porté par l'onglet. */
  id: string;
}

export function DomainPanel({ domain, anchorLeft, onClose, id }: DomainPanelProps) {
  const ref = useRef<HTMLDivElement>(null);
  const columns = domain.columns ?? [];
  const [left, setLeft] = useState(anchorLeft);

  // Audit UX/UI 2026-08-13 (lot 2) : l'ancienne formule (n×172 + padding)
  // oubliait les gouttières inter-colonnes — la grille les prélevait donc sur
  // le contenu (~153 px réels par colonne) et `truncate` coupait les libellés
  // (« Expense thresho… »). Les gouttières comptent désormais dans la largeur.
  const width = Math.max(
    640,
    columns.length * COLUMN_WIDTH + (columns.length - 1) * COLUMN_GAP + PANEL_PADDING_X,
  );

  // Recalage : on part du bord de l'onglet, on rentre le panneau dans la
  // fenêtre s'il déborde à droite, sans jamais passer sous la gouttière gauche.
  useLayoutEffect(() => {
    const viewport = window.innerWidth;
    const maxLeft = viewport - width - VIEWPORT_MARGIN;
    setLeft(Math.max(VIEWPORT_MARGIN, Math.min(anchorLeft, maxLeft)));
  }, [anchorLeft, width]);

  // Le focus entre dans le panneau sur ↓ (géré par la TopBar, qui appelle
  // focus() sur le premier lien). Échap ferme depuis l'intérieur.
  useEffect(() => {
    const node = ref.current;
    if (node === null) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    node.addEventListener('keydown', onKeyDown);
    return () => { node.removeEventListener('keydown', onKeyDown); };
  }, [onClose]);

  return (
    <div
      ref={ref}
      id={id}
      data-testid={`domain-panel-${domain.id}`}
      className={cn(
        'absolute top-[52px] z-40 rounded-b-xl border border-border-strong bg-surface-3',
        'px-5 py-[18px] shadow-[0_18px_40px_rgba(28,23,18,0.20)]',
      )}
      style={{
        left,
        width,
        maxWidth: `calc(100vw - ${VIEWPORT_MARGIN * 2}px)`,
        display: 'grid',
        gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))`,
        columnGap: COLUMN_GAP,
      }}
    >
      {columns.map((column) => (
        <PanelColumn key={column.label} column={column} onNavigate={onClose} />
      ))}
    </div>
  );
}
