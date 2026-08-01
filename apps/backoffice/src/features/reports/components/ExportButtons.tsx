// apps/backoffice/src/features/reports/components/ExportButtons.tsx
//
// S29 Wave 4.A.2 — pair of buttons (CSV local + PDF via EF). Generic <T>.

import { Button } from '@breakery/ui';
import { Download, FileText, Loader2 } from 'lucide-react';
import { buildCsv, downloadCsv, type CsvColumn } from '@breakery/domain';
import { useAuthStore } from '@/stores/authStore.js';
import { useGeneratePdf, type GeneratePdfArgs, type PdfTemplate } from '../hooks/useGeneratePdf.js';

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
    const out = buildCsv(csv.rows, csv.columns);
    downloadCsv(out, csv.filename);
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
    const result = await generatePdf.mutateAsync(args);
    if (result.signed_url) window.open(result.signed_url, '_blank', 'noopener,noreferrer');
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
            ? <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            : <FileText className="h-4 w-4 mr-1" />} PDF
        </Button>
      )}
    </div>
  );
}
