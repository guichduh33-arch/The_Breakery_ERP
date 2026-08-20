// apps/backoffice/src/features/reports/components/ExportMenu.tsx
//
// Lot B (campagne Reports 2026-08-15) — refonte d'ExportButtons sur la maquette
// 4c : UN bouton « Export » ouvrant un menu CSV / PDF, au lieu de deux boutons
// ghost divergents du reste du back-office.
//
// Il est SECONDAIRE, et ce n'est pas un détail (campagne design 2026-08-18).
// Il était encre, « le seul primaire du bandeau » — sauf que sur une page de
// rapport il ne l'est pas : la bande de KPI y pose une tuile héro encrée, et
// The One Ink Fill Rule n'en autorise qu'une par écran. Mesuré à 1280 px sur
// /reports/balance-sheet avant correction : DEUX aplats `rgb(32,29,25)` hors
// barre de navigation. Ce composant étant partagé par quarante-quatre pages,
// dont une vingtaine portent une bande de KPI, l'infraction était systémique.
//
// Et l'arbitrage de la règle est net pour ce cas : l'encre va « soit au bouton
// qui crée, soit à la tuile qui répond à la question qu'on pose en ouvrant la
// page ». Un rapport ne crée rien ; sa tuile EST la réponse. L'encre lui
// revient, l'export prend le cran secondaire — le même geste que sur le
// dashboard, dont le bouton Export a été dégradé pour la même raison.
//
// Différence de fond avec ExportButtons : sans la permission `reports.export`,
// le bouton ne DISPARAÎT plus en silence — il se désactive et dit pourquoi.
// Masquer un contrôle laisse l'utilisateur croire que la fonction n'existe pas ;
// le désactiver nomme la règle. Le CSV est construit localement (ce gate client
// est sa seule mesure) ; le PDF garde son verrou serveur dans l'EF generate-pdf.

import type { JSX } from 'react';
import { ChevronDown, Download, FileDown, FileText, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@breakery/ui';
import { buildCsv, downloadCsv, type CsvColumn } from '@breakery/domain';
import { useAuthStore } from '@/stores/authStore.js';
import { TOOLBAR_BTN_SECONDARY, TOOLBAR_ICON } from '@/components/toolbarButton.js';
import { useGeneratePdf, type GeneratePdfArgs, type PdfTemplate } from '../hooks/useGeneratePdf.js';
import { exportErrorDetail } from './ExportButtons.js';
import { useDismissablePanel } from './useDismissablePanel.js';

export interface ExportMenuProps<T> {
  csv?: {
    rows:     T[];
    columns:  CsvColumn<T>[];
    filename: string;
  };
  pdf?: {
    template:         PdfTemplate;
    data:             object;
    period?:          { start: string; end: string };
    filename:         string;
    comparePrevious?: { data: object };
  };
  /** Rien à exporter (période vide) — bouton visible mais désactivé. */
  disabled?: boolean;
}

// Un export qui échoue doit le DIRE. Les deux chemins partaient en silence : le
// PDF parce que `void handlePdf()` avale le rejet de mutateAsync (eslint ne voit
// rien — `void` est l'échappatoire documentée de no-floating-promises), le CSV
// parce qu'une exception dans un handler d'événement React ne remonte à aucune
// error boundary. On rend le message du serveur quand il y en a un.
//
// La traduction des codes de l'EF `generate-pdf` en phrases est IMPORTÉE et non
// recopiée : une table de messages dupliquée diverge au premier code ajouté
// côté serveur. Seule l'enveloppe du toast reste locale, le temps de la
// migration d'ExportButtons vers ce menu.
function toastExportError(label: 'CSV' | 'PDF', e: unknown): void {
  const detail = exportErrorDetail(e);
  toast.error(detail === ''
    ? `${label} export failed. Please try again.`
    : `${label} export failed: ${detail}`);
}

const ITEM_CLS = cn(
  'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-text-primary',
  'hover:bg-surface-4 disabled:cursor-not-allowed disabled:opacity-50',
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold',
);

export function ExportMenu<T>({ csv, pdf, disabled = false }: ExportMenuProps<T>): JSX.Element | null {
  const generatePdf = useGeneratePdf();
  const canExport = useAuthStore((s) => s.hasPermission('reports.export'));
  const { open, setOpen, rootRef, triggerRef } = useDismissablePanel<HTMLDivElement>();

  if (csv === undefined && pdf === undefined) return null;

  const blocked = !canExport || disabled;

  const handleCsv = (): void => {
    if (csv === undefined) return;
    try {
      const out = buildCsv(csv.rows, csv.columns);
      downloadCsv(out, csv.filename);
    } catch (e) {
      toastExportError('CSV', e);
      return;   // le menu reste ouvert : le toast dit pourquoi, le geste reste à portée
    }
    setOpen(false);
  };

  const handlePdf = async (): Promise<void> => {
    if (pdf === undefined) return;
    const args: GeneratePdfArgs = {
      template: pdf.template,
      data:     pdf.data,
      filename: pdf.filename,
    };
    if (pdf.period)          args.period = pdf.period;
    if (pdf.comparePrevious) args.comparePrevious = pdf.comparePrevious;
    try {
      const result = await generatePdf.mutateAsync(args);
      // Même dernier silence qu'ExportButtons : 200 sans URL signée.
      if (!result.signed_url) {
        toast.error('PDF export failed: the report came back without a download link.');
        return;
      }
      window.open(result.signed_url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      toastExportError('PDF', e);
      return;   // le menu reste ouvert : le toast dit pourquoi, le geste reste à portée
    }
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        className={TOOLBAR_BTN_SECONDARY}
        disabled={blocked}
        title={!canExport ? 'Requires the reports.export permission.' : undefined}
        aria-expanded={open}
        aria-haspopup="menu"
        data-testid="export-menu"
        onClick={() => setOpen(!open)}
      >
        <FileDown className={TOOLBAR_ICON} aria-hidden />
        Export
        <ChevronDown className="h-3 w-3 text-text-muted" aria-hidden />
      </button>

      {open && !blocked && (
        <div
          role="menu"
          aria-label="Export formats"
          data-testid="export-panel"
          className="absolute right-0 z-40 mt-1.5 w-44 rounded-xl border border-border-subtle bg-surface-3 p-1.5 shadow-xl"
        >
          {csv !== undefined && (
            <button type="button" role="menuitem" className={ITEM_CLS} data-testid="export-csv" onClick={handleCsv}>
              <Download className="h-3.5 w-3.5 text-text-muted" aria-hidden />
              CSV
            </button>
          )}
          {pdf !== undefined && (
            <button
              type="button"
              role="menuitem"
              className={ITEM_CLS}
              data-testid="export-pdf"
              disabled={generatePdf.isPending}
              onClick={() => { void handlePdf(); }}
            >
              {generatePdf.isPending
                ? <Loader2 className="h-3.5 w-3.5 animate-spin text-text-muted" aria-hidden />
                : <FileText className="h-3.5 w-3.5 text-text-muted" aria-hidden />}
              PDF
            </button>
          )}
        </div>
      )}
    </div>
  );
}
