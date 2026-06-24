// apps/backoffice/src/features/data-import/components/ImportEntityModal.tsx
// 3-step import flow inside a Dialog: idle → parsed → previewed → done.
// Fresh idempotency key on new file AND after a successful commit.

import { useRef, useState, type JSX } from 'react';
import { toast } from 'sonner';
import {
  Badge, Button, Dialog, DialogContent, DialogDescription, DialogTitle,
} from '@breakery/ui';
import { ImportDropzone } from '@/features/catalog-import/components/ImportDropzone.js';
import { ImportErrorsTable } from '@/features/catalog-import/components/ImportErrorsTable.js';
import { EntitySummaryGrid } from './EntitySummaryGrid.js';
import { useImportEntity } from '../hooks/useImportEntity.js';
import { parseEntityWorkbook } from '../parseEntityWorkbook.js';
import type {
  EntityImportDef, EntityRow, ImportError, ImportReport, StructureError,
} from '../entityImportDef.js';

interface Props {
  open: boolean;
  onClose: () => void;
  def: EntityImportDef;
  title: string;
  description: string;
}

type Stage =
  | { step: 'idle' }
  | { step: 'parsed'; payload: EntityRow[]; structureErrors: StructureError[]; filename: string; rowMap: number[] }
  | { step: 'previewed'; payload: EntityRow[]; report: ImportReport; filename: string; rowMap: number[] }
  | { step: 'done'; report: ImportReport };

function toExcelRows(errors: ImportError[], rowMap: number[]): ImportError[] {
  return errors.map((err) => {
    const excelRow = rowMap[err.row - 1];
    return excelRow === undefined ? err : { ...err, row: excelRow };
  });
}

export function ImportEntityModal({ open, onClose, def, title, description }: Props): JSX.Element {
  const [stage, setStage] = useState<Stage>({ step: 'idle' });
  const importMutation = useImportEntity(def);
  const idemKeyRef = useRef<string>(crypto.randomUUID());

  function reset(): void {
    idemKeyRef.current = crypto.randomUUID();
    setStage({ step: 'idle' });
    importMutation.reset();
  }

  function handleClose(): void {
    reset();
    onClose();
  }

  async function handleFile(buf: ArrayBuffer, filename: string): Promise<void> {
    idemKeyRef.current = crypto.randomUUID();
    const { rows, structureErrors, rowMap } = parseEntityWorkbook(buf, def);
    setStage({ step: 'parsed', payload: rows, structureErrors, filename, rowMap });
    if (structureErrors.length === 0 && rows.length > 0) {
      try {
        const report = await importMutation.mutateAsync({ payload: rows, dryRun: true });
        setStage({ step: 'previewed', payload: rows, report, filename, rowMap });
      } catch (e) {
        setStage({ step: 'idle' });
        toast.error(`Validation failed: ${(e as Error).message}`);
      }
    }
  }

  async function handleConfirm(): Promise<void> {
    if (stage.step !== 'previewed') return;
    try {
      const report = await importMutation.mutateAsync({
        payload: stage.payload, dryRun: false, idempotencyKey: idemKeyRef.current,
      });
      if (!report.valid) {
        setStage({ ...stage, report });
        toast.error('Validation failed at import time — review the errors below');
        return;
      }
      idemKeyRef.current = crypto.randomUUID();
      setStage({ step: 'done', report });
      toast.success(`${title} imported successfully`);
    } catch (e) {
      toast.error(`Import failed: ${(e as Error).message}`);
    }
  }

  const importTotal =
    stage.step === 'previewed'
      ? Object.values(stage.report.summary).reduce(
          (sum, section) => sum + (section['create'] ?? 0) + (section['update'] ?? 0), 0)
      : 0;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>

        <div className="space-y-4 py-2">
          {(stage.step === 'idle' ||
            (stage.step === 'parsed' && (stage.payload.length === 0 || stage.structureErrors.length > 0))) && (
            <>
              <ImportDropzone onFile={(buf, name) => void handleFile(buf, name)} disabled={importMutation.isPending} />
              {stage.step === 'parsed' && stage.structureErrors.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-danger">
                    {stage.structureErrors.length} structure error
                    {stage.structureErrors.length !== 1 ? 's' : ''} in{' '}
                    <span className="font-mono">{stage.filename}</span>. Fix and re-upload.
                  </p>
                  <ImportErrorsTable structureErrors={stage.structureErrors} />
                </div>
              )}
            </>
          )}

          {stage.step === 'parsed' && stage.payload.length > 0 &&
            stage.structureErrors.length === 0 && importMutation.isPending && (
              <p className="text-sm text-text-muted">Validating {stage.filename}…</p>
          )}

          {stage.step === 'previewed' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <p className="text-sm text-text-secondary">
                  Ready to import <span className="font-mono font-medium">{stage.filename}</span>
                </p>
                {stage.report.valid
                  ? <Badge variant="default">Valid</Badge>
                  : <Badge variant="destructive">{stage.report.errors.length} error{stage.report.errors.length !== 1 ? 's' : ''}</Badge>}
              </div>
              <EntitySummaryGrid summary={stage.report.summary} />
              {stage.report.errors.length > 0 && (
                <ImportErrorsTable errors={toExcelRows(stage.report.errors, stage.rowMap)} />
              )}
              <div className="flex items-center gap-3">
                <Button data-testid="confirm-import" onClick={() => void handleConfirm()}
                  disabled={!stage.report.valid || importMutation.isPending}>
                  {importMutation.isPending ? 'Importing…'
                    : importTotal > 0 ? `Import ${importTotal} row${importTotal !== 1 ? 's' : ''}` : 'Import'}
                </Button>
                <Button variant="secondary" onClick={reset}>Cancel</Button>
              </div>
            </div>
          )}

          {stage.step === 'done' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Badge variant="default">Import complete</Badge>
                {stage.report.idempotent_replay && <Badge variant="secondary">Idempotent replay</Badge>}
              </div>
              <EntitySummaryGrid summary={stage.report.summary} />
              <div className="flex items-center gap-3">
                <Button variant="secondary" onClick={reset}>Import another file</Button>
                <Button variant="primary" onClick={handleClose}>Done</Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
