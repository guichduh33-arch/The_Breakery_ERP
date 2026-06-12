// apps/backoffice/src/features/catalog-import/components/ImportDropzone.tsx
// S41 — file dropzone: native <input type="file"> + drag-and-drop overlay.
// Calls onFile(arrayBuffer, filename) when the user picks or drops a .xlsx file.

import { useRef, useState, type JSX, type DragEvent, type ChangeEvent } from 'react';
import { toast } from 'sonner';
import { cn } from '@breakery/ui';

interface Props {
  onFile: (buf: ArrayBuffer, filename: string) => void;
  disabled?: boolean;
}

export function ImportDropzone({ onFile, disabled = false }: Props): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  async function processFile(file: File): Promise<void> {
    const buf = await file.arrayBuffer();
    onFile(buf, file.name);
  }

  function handleChange(e: ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    if (file !== undefined) {
      void processFile(file);
    }
    // reset so the same file can be re-dropped
    e.target.value = '';
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>): void {
    e.preventDefault();
    if (!disabled) setIsDragOver(true);
  }

  function handleDragLeave(e: DragEvent<HTMLDivElement>): void {
    // dragleave also fires when the cursor moves onto a child — ignore those.
    if (e.relatedTarget !== null && e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragOver(false);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>): void {
    e.preventDefault();
    setIsDragOver(false);
    if (disabled) return;
    const file = e.dataTransfer.files[0];
    if (file === undefined) return;
    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      toast.error('Only .xlsx files are supported');
      return;
    }
    void processFile(file);
  }

  return (
    <div
      data-testid="import-dropzone"
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label="Upload .xlsx file"
      className={cn(
        'flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 text-center transition-colors cursor-pointer',
        isDragOver
          ? 'border-gold bg-gold-soft'
          : 'border-border-subtle hover:border-border-strong',
        disabled && 'opacity-50 pointer-events-none',
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={() => { if (!disabled) inputRef.current?.click(); }}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && !disabled) {
          inputRef.current?.click();
        }
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx"
        className="sr-only"
        onChange={handleChange}
        disabled={disabled}
        tabIndex={-1}
        aria-hidden
      />
      <svg
        className="h-10 w-10 text-text-muted"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        aria-hidden
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M12 16v-8m0 0-3 3m3-3 3 3M6.5 19h11a2.5 2.5 0 0 0 0-5H16a4 4 0 1 0-7.93-.75A2.5 2.5 0 0 0 6.5 19Z" />
      </svg>
      <p className="text-sm text-text-secondary">
        Drop your <span className="font-medium">.xlsx</span> file here, or{' '}
        <span className="text-gold underline">browse</span>
      </p>
      <p className="text-xs text-text-muted">Use the template below to structure your data</p>
    </div>
  );
}
