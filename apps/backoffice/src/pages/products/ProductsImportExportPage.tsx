// apps/backoffice/src/pages/products/ProductsImportExportPage.tsx
// S41 — Import / Export tab: template download, full export, 3-step import.
// State machine: idle → parsed → previewed → done.
// Idempotency key: useRef<string>(crypto.randomUUID()), reset after commit.

import { useRef, useState, type JSX } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Button, Card, CardContent, CardHeader, CardTitle, CardDescription, Badge } from '@breakery/ui';
import { ProductsPageTabs } from '@/features/products/components/ProductsPageTabs.js';
import { ImportDropzone } from '@/features/catalog-import/components/ImportDropzone.js';
import { ImportSummaryCards } from '@/features/catalog-import/components/ImportSummaryCards.js';
import { ImportErrorsTable } from '@/features/catalog-import/components/ImportErrorsTable.js';
import {
  useImportCatalog,
  type ImportReport,
} from '@/features/catalog-import/hooks/useImportCatalog.js';
import { useExportCatalog } from '@/features/catalog-import/hooks/useExportCatalog.js';
import type { CatalogPayload, StructureError } from '@/features/catalog-import/parseCatalogWorkbook.js';

type Stage =
  | { step: 'idle' }
  | {
      step: 'parsed';
      payload: CatalogPayload | null;
      structureErrors: StructureError[];
      filename: string;
    }
  | {
      step: 'previewed';
      payload: CatalogPayload;
      report: ImportReport;
      filename: string;
    }
  | { step: 'done'; report: ImportReport };

export default function ProductsImportExportPage(): JSX.Element {
  const [stage, setStage] = useState<Stage>({ step: 'idle' });
  const importMutation = useImportCatalog();
  const exportMutation = useExportCatalog();
  const idemKeyRef = useRef<string>(crypto.randomUUID());

  async function handleDownloadTemplate(): Promise<void> {
    const { buildTemplateWorkbook, downloadWorkbook } = await import(
      '@/features/catalog-import/buildTemplateWorkbook.js'
    );
    downloadWorkbook(buildTemplateWorkbook(), 'breakery-catalog-template.xlsx');
  }

  async function handleExport(): Promise<void> {
    try {
      const payload = await exportMutation.mutateAsync();
      const [{ buildExportWorkbook }, { downloadWorkbook }] = await Promise.all([
        import('@/features/catalog-import/buildExportWorkbook.js'),
        import('@/features/catalog-import/buildTemplateWorkbook.js'),
      ]);
      downloadWorkbook(
        buildExportWorkbook(payload),
        `breakery-catalog-export-${new Date().toISOString().slice(0, 10)}.xlsx`,
      );
    } catch (e) {
      toast.error(`Export failed: ${(e as Error).message}`);
    }
  }

  async function handleFile(buf: ArrayBuffer, filename: string): Promise<void> {
    const { parseCatalogWorkbook } = await import(
      '@/features/catalog-import/parseCatalogWorkbook.js'
    );
    const { payload, errors } = parseCatalogWorkbook(buf);
    setStage({ step: 'parsed', payload, structureErrors: errors, filename });
    if (payload !== null && errors.length === 0) {
      try {
        const report = await importMutation.mutateAsync({ payload, dryRun: true });
        setStage({ step: 'previewed', payload, report, filename });
      } catch (e) {
        toast.error(`Validation failed: ${(e as Error).message}`);
      }
    }
  }

  async function handleConfirmImport(): Promise<void> {
    if (stage.step !== 'previewed') return;
    try {
      const report = await importMutation.mutateAsync({
        payload: stage.payload,
        dryRun: false,
        idempotencyKey: idemKeyRef.current,
      });
      idemKeyRef.current = crypto.randomUUID();
      setStage({ step: 'done', report });
      toast.success('Catalog imported successfully');
    } catch (e) {
      toast.error(`Import failed: ${(e as Error).message}`);
    }
  }

  function handleReset(): void {
    setStage({ step: 'idle' });
    importMutation.reset();
  }

  // Compute total items to import for the button label
  const importTotal =
    stage.step === 'previewed'
      ? Object.values(stage.report.summary)
          .flatMap((section) => Object.values(section))
          .reduce((sum, n) => sum + n, 0)
      : 0;

  return (
    <div className="space-y-6">
      <ProductsPageTabs />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ── Card 1: Template ── */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold uppercase tracking-widest">
              Template
            </CardTitle>
            <CardDescription>
              Download the empty 6-sheet Excel template. Fill it in and upload below.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="secondary" onClick={() => void handleDownloadTemplate()}>
              Download empty template
            </Button>
          </CardContent>
        </Card>

        {/* ── Card 2: Export ── */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold uppercase tracking-widest">
              Export current catalog
            </CardTitle>
            <CardDescription>
              Export all active products, recipes, variants and units in the import template shape
              (round-trip compatible).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="secondary"
              onClick={() => void handleExport()}
              disabled={exportMutation.isPending}
            >
              {exportMutation.isPending ? 'Exporting…' : 'Export full catalog'}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* ── Card 3: Import ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold uppercase tracking-widest">
            Import catalog
          </CardTitle>
          <CardDescription>
            Upload a filled template. The file is validated before any writes are made.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Step idle or parsed-with-errors → show dropzone */}
          {(stage.step === 'idle' ||
            (stage.step === 'parsed' &&
              (stage.payload === null || stage.structureErrors.length > 0))) && (
            <>
              <ImportDropzone
                onFile={(buf, name) => void handleFile(buf, name)}
                disabled={importMutation.isPending}
              />
              {stage.step === 'parsed' && stage.structureErrors.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-danger">
                    {stage.structureErrors.length} structure error
                    {stage.structureErrors.length !== 1 ? 's' : ''} found in{' '}
                    <span className="font-mono">{stage.filename}</span>
                    . Fix and re-upload.
                  </p>
                  <ImportErrorsTable structureErrors={stage.structureErrors} />
                </div>
              )}
            </>
          )}

          {/* Parsed, no structure errors — running dry-run */}
          {stage.step === 'parsed' &&
            stage.payload !== null &&
            stage.structureErrors.length === 0 &&
            importMutation.isPending && (
              <p className="text-sm text-text-muted">Validating {stage.filename}…</p>
            )}

          {/* Previewed — show dry-run results */}
          {stage.step === 'previewed' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <p className="text-sm text-text-secondary">
                  Ready to import{' '}
                  <span className="font-mono font-medium">{stage.filename}</span>
                </p>
                {stage.report.valid ? (
                  <Badge variant="default">Valid</Badge>
                ) : (
                  <Badge variant="destructive">
                    {stage.report.errors.length} error
                    {stage.report.errors.length !== 1 ? 's' : ''}
                  </Badge>
                )}
              </div>

              <ImportSummaryCards summary={stage.report.summary} />

              {stage.report.errors.length > 0 && (
                <ImportErrorsTable errors={stage.report.errors} />
              )}

              <div className="flex items-center gap-3">
                <Button
                  data-testid="confirm-import"
                  onClick={() => void handleConfirmImport()}
                  disabled={!stage.report.valid || importMutation.isPending}
                >
                  {importMutation.isPending
                    ? 'Importing…'
                    : `Import ${importTotal > 0 ? importTotal + ' items' : 'catalog'}`}
                </Button>
                <Button variant="secondary" onClick={handleReset}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {/* Done */}
          {stage.step === 'done' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Badge variant="default">Import complete</Badge>
                {stage.report.idempotent_replay && (
                  <Badge variant="secondary">Idempotent replay</Badge>
                )}
              </div>
              <ImportSummaryCards summary={stage.report.summary} />
              <div className="flex items-center gap-3">
                <Link
                  to="/backoffice/products"
                  className="text-sm font-medium text-gold underline"
                >
                  View products
                </Link>
                <Button variant="secondary" onClick={handleReset}>
                  Import another file
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
