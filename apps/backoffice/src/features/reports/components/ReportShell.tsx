// apps/backoffice/src/features/reports/components/ReportShell.tsx
//
// Lot B (campagne Reports 2026-08-15) — l'ossature de l'archétype « Report »
// (DESIGN.md, maquette 4c). Remplace ReportPage, qui enfermait tout le contenu
// dans UNE Card : la bande de KPI, la rangée graphique et les ventilations se
// posent ici directement sur le papier gradué, chacune dans sa propre carte
// (PanelCard / KpiTile). ReportPage reste en place le temps de la migration
// par vagues, puis est supprimé (lot F).
//
// L'ossature commune : fil d'Ariane 12 px → bandeau (h1 23 px via PageHeader,
// actions 32 px TOOLBAR_BTN_*) → bannière d'erreur unifiée → bande KPI → corps.

import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { Card, EmptyState } from '@breakery/ui';
import type { EmptyStateProps } from '@breakery/ui';
import { PageHeader } from '@/components/PageHeader.js';

export interface ReportBreadcrumbItem {
  label: string;
  to?: string;
}

export interface ReportShellProps {
  title:    string;
  subtitle?: ReactNode;
  /**
   * Fil d'Ariane. Défaut : Reports → titre de la page. Le dernier segment est
   * la page courante et ne porte pas de lien.
   */
  breadcrumb?: ReportBreadcrumbItem[];
  /** Actions du bandeau, 32 px : PeriodControl, filtres, ExportMenu (le seul
   *  primaire encre). */
  toolbar?: ReactNode;
  /** Bande de KPI, posée sur le papier au-dessus du corps. */
  kpis?: ReactNode;
  /**
   * Échec de la requête principale : bannière `role="alert"` unifiée — les 31
   * pages réimplantaient chacune son `<p>` d'erreur. Le corps n'est pas rendu.
   */
  error?: Error | null;
  /** « Chargé, sans erreur, zéro ligne » — rend l'EmptyState à la place du corps. */
  isEmpty?: boolean;
  emptyState?: EmptyStateProps;
  children: ReactNode;
}

/** Traduit les erreurs de garde en langage humain — un code ne dit pas à un
 *  gérant ce qu'il doit en conclure. */
function errorText(error: Error): string {
  if (error.message === 'permission_denied' || error.message.includes('42501')) {
    return 'You do not have permission to view this report.';
  }
  return error.message !== '' ? error.message : 'Failed to load report.';
}

export function ReportShell({
  title,
  subtitle,
  breadcrumb,
  toolbar,
  kpis,
  error = null,
  isEmpty,
  emptyState,
  children,
}: ReportShellProps) {
  const crumbs: ReportBreadcrumbItem[] = breadcrumb
    ?? [{ label: 'Reports', to: '/backoffice/reports' }, { label: title }];
  const showEmpty = isEmpty === true && emptyState !== undefined;

  // Région live UNIQUE et toujours montée — patron `JournalEntriesPage`.
  //
  // LE DÉFAUT QU'ELLE FERME. Changer de période sur un rapport ne déplace pas
  // le focus : les tuiles, le graphe et les ventilations se réécrivent en
  // silence, et qui n'y voit pas n'a AUCUN moyen de savoir que les chiffres
  // sous ses doigts ne sont plus les mêmes (WCAG 4.1.3). Elle vit ici, dans
  // l'ossature, et pas dans les pages : montée HORS des branches erreur et
  // vide, elle survit à la bascule vers zéro ligne — le seul moment où
  // l'annonce sert vraiment. Une région qui se démonte n'annonce rien.
  //
  // Le texte doit CHANGER pour être annoncé : la ligne méta des rapports porte
  // la période, elle est donc ce qui fait la différence d'une fenêtre à
  // l'autre. Un `subtitle` en JSX n'a pas de texte lisible ici — on retombe
  // alors sur l'état seul, qui annonce au moins l'entrée dans le vide.
  //
  // Le vide se dit en GÉNÉRIQUE et ne recopie pas le titre de l'`EmptyState` :
  // celui-ci est du texte VISIBLE, déjà lisible là où il s'affiche, et le rôle
  // de la région est de signaler la bascule, pas de doubler la page.
  const periodNote = typeof subtitle === 'string' && subtitle !== '' ? subtitle : null;
  const liveMessage =
    // L'échec parle déjà dans sa propre bannière `role="alert"`, plus urgente.
    error !== null          ? ''
    : showEmpty             ? `${title} — no figures for this window.`
    : periodNote !== null    ? `${title} updated — ${periodNote}.`
    :                         `${title} updated.`;

  return (
    <div className="space-y-3.5">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs text-text-muted">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <span key={`${c.label}-${i}`} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="h-3 w-3 text-text-inert" aria-hidden />}
              {c.to !== undefined && !last ? (
                <Link
                  to={c.to}
                  className="hover:text-text-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
                >
                  {c.label}
                </Link>
              ) : (
                <span className={last ? 'text-text-secondary' : undefined} aria-current={last ? 'page' : undefined}>
                  {c.label}
                </span>
              )}
            </span>
          );
        })}
      </nav>

      <PageHeader title={title} subtitle={subtitle} actions={toolbar} />

      <span role="status" className="sr-only" data-testid="report-live">{liveMessage}</span>

      {error !== null && (
        <p
          role="alert"
          className="rounded border border-danger bg-danger-soft px-3 py-2 text-sm text-danger"
          data-testid="report-error"
        >
          {errorText(error)}
        </p>
      )}

      {error === null && kpis}

      {error === null && (
        showEmpty ? (
          <Card variant="default" padding="none" className="p-8 shadow-none">
            <EmptyState size="sm" {...emptyState} />
          </Card>
        ) : (
          children
        )
      )}
    </div>
  );
}
