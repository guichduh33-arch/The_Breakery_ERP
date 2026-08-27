// apps/backoffice/src/features/reports/components/ExportButtons.tsx
//
// S29 Wave 4.A.2 — pair of buttons (CSV local + PDF via EF). Generic <T>.

import { Button } from '@breakery/ui';
import { Download, FileText, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { buildCsv, downloadCsv, type CsvColumn } from '@breakery/domain';
import { useAuthStore } from '@/stores/authStore.js';
import { useGeneratePdf, type GeneratePdfArgs, type PdfTemplate } from '../hooks/useGeneratePdf.js';

// Un export qui échoue doit le DIRE. Les deux chemins partaient en silence :
// le PDF parce que `void handlePdf()` avale le rejet de mutateAsync (eslint ne
// voit rien — `void` est l'échappatoire documentée de no-floating-promises), le
// CSV parce qu'une exception dans un handler d'événement React ne remonte à
// aucune error boundary. On rend le message du serveur quand il y en a un.
//
// Ce que l'EF `generate-pdf` renvoie dans son champ `error` n'est JAMAIS une
// phrase : c'est un code machine, et `useGeneratePdf` le propage tel quel
// (`throw new Error(err.error ?? 'pdf_failed')`). Sans cette table, un manager
// sans droit sur un template lisait « PDF export failed: permission_denied ».
// Filtrer la seule sentinelle `pdf_failed` ne suffisait donc pas — elle n'est
// que le douzième de ces codes.
//
// La table est exportée et consommée par ExportMenu : les deux composants
// coexistent le temps de la migration vers le menu, mais une table de messages
// recopiée diverge au premier ajout de code côté EF.
export const PDF_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  permission_denied:       'you do not have permission to export this report.',
  permission_check_failed: 'your permissions could not be verified. Try again.',
  authorization_required:  'your session has expired. Sign in again.',
  invalid_auth:            'your session has expired. Sign in again.',
  generation_failed:       'the report could not be rendered.',
  upload_failed:           'the report was rendered but could not be stored.',
  sign_url_failed:         'the report was stored but its download link could not be issued.',
  invalid_template:        'this report has no PDF template.',
  invalid_filename:        'the file name was rejected.',
  invalid_body:            'the request was rejected.',
  invalid_json:            'the request was rejected.',
  method_not_allowed:      'the request was rejected.',
};

// Tout ce qui n'est ni une Error ni une string donne '' — jamais de
// « [object Object] » à l'écran. Un code connu devient sa phrase ; un code
// inconnu (snake_case sans espace) est tu plutôt que montré : mieux vaut le
// message générique qu'un jeton interne. Une vraie phrase venue d'ailleurs
// passe telle quelle.
export function exportErrorDetail(e: unknown): string {
  const raw = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
  const msg = raw.trim();
  if (msg === '' || msg === 'pdf_failed') return '';
  const known = PDF_ERROR_MESSAGES[msg];
  if (known !== undefined) return known;
  return /^[a-z0-9]+(_[a-z0-9]+)+$/.test(msg) ? '' : msg;
}

function toastExportError(label: 'CSV' | 'PDF', e: unknown): void {
  const detail = exportErrorDetail(e);
  toast.error(detail === ''
    ? `${label} export failed. Please try again.`
    : `${label} export failed: ${detail}`);
}

export interface ExportButtonsProps<T> {
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
  disabled?: boolean;
}

export function ExportButtons<T>({ csv, pdf, disabled }: ExportButtonsProps<T>): JSX.Element | null {
  const generatePdf = useGeneratePdf();
  // Audit Reports 2026-08-01, lot C / D3 — `reports.export` gouverne desormais
  // l'extraction. Cote client c'est le SEUL point de controle possible pour le
  // CSV, qui est construit localement a partir de donnees deja recues : masquer
  // les boutons est la mesure, l'EF generate-pdf porte le verrou serveur du PDF.
  const canExport = useAuthStore((s) => s.hasPermission('reports.export'));

  const handleCsv = (): void => {
    if (!csv) return;
    try {
      const out = buildCsv(csv.rows, csv.columns);
      downloadCsv(out, csv.filename);
    } catch (e) {
      toastExportError('CSV', e);
    }
  };

  const handlePdf = async (): Promise<void> => {
    if (!pdf) return;
    const args: GeneratePdfArgs = {
      template: pdf.template,
      data:     pdf.data,
      filename: pdf.filename,
    };
    if (pdf.period)          args.period = pdf.period;
    if (pdf.comparePrevious) args.comparePrevious = pdf.comparePrevious;
    try {
      const result = await generatePdf.mutateAsync(args);
      // La branche `else` était le dernier silence de ce chemin : une réponse
      // 200 sans URL signée ne produisait rien et ne le disait pas.
      if (!result.signed_url) {
        toast.error('PDF export failed: the report came back without a download link.');
        return;
      }
      window.open(result.signed_url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      toastExportError('PDF', e);
    }
  };

  if (!canExport) return null;

  return (
    <div className="flex items-center gap-2">
      {csv && (
        <Button
          variant="ghost"
          size="sm"
          onClick={handleCsv}
          disabled={disabled}
          data-testid="export-csv"
          aria-label="Export CSV"
        >
          <Download className="h-4 w-4 mr-1" /> CSV
        </Button>
      )}
      {pdf && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => { void handlePdf(); }}
          disabled={(disabled ?? false) || generatePdf.isPending}
          data-testid="export-pdf"
          aria-label="Export PDF"
        >
          {generatePdf.isPending
            ? <Loader2 className="h-4 w-4 mr-1 animate-spin motion-reduce:animate-none" />
            : <FileText className="h-4 w-4 mr-1" />} PDF
        </Button>
      )}
    </div>
  );
}
