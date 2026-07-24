// apps/backoffice/src/features/settings/components/BrandLogoUploader.tsx
//
// Brand logo uploader for /settings/general (Identity section).
// Click-to-pick OR drag-and-drop a single PNG/JPEG (pdf-lib can only embed
// those two formats in PDF headers), uploaded to the public Storage bucket
// `branding` at logo/{timestamp}-{file}. On success it lifts the public URL
// via onChange into the page draft — the explicit page-level Save persists it
// through set_setting_v9('logo_url'), keeping the module's explicit-save
// invariant (an uploaded-but-unsaved file is just an orphan object).
//
// Writes are gated server-side by RLS (has_permission settings.update).

import { Loader2, ImagePlus, Trash2, UploadCloud } from 'lucide-react';
import { useId, useRef, useState, type DragEvent, type JSX } from 'react';
import { supabase } from '@/lib/supabase.js';

const BUCKET = 'branding';
const MAX_BYTES = 1 * 1024 * 1024;
const ACCEPTED = ['image/png', 'image/jpeg'];

interface Props {
  logoUrl: string | null;
  readOnly?: boolean;
  /** Called with the new public URL (or null when removed). */
  onChange?: (url: string | null) => void;
}

function sanitizeFilename(name: string): string {
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot).toLowerCase() : '';
  const base = (dot >= 0 ? name.slice(0, dot) : name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `${base || 'logo'}${ext}`;
}

export function BrandLogoUploader({ logoUrl, readOnly = false, onChange }: Props): JSX.Element {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  async function handleFile(file: File): Promise<void> {
    setError(null);
    if (!ACCEPTED.includes(file.type)) {
      setError('Unsupported format — use PNG or JPEG (PDF headers cannot embed other formats).');
      return;
    }
    if (file.size > MAX_BYTES) {
      setError('File too large — 1 MB max.');
      return;
    }
    setBusy(true);
    try {
      const path = `logo/${Date.now()}-${sanitizeFilename(file.name)}`;
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
      onChange?.(data.publicUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed.');
    } finally {
      setBusy(false);
    }
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
    // Reset so re-selecting the same file fires change again.
    e.target.value = '';
  }

  function onDrop(e: DragEvent<HTMLDivElement>): void {
    e.preventDefault();
    setDragOver(false);
    if (readOnly || busy) return;
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  }

  function openPicker(): void {
    if (readOnly || busy) return;
    inputRef.current?.click();
  }

  return (
    <div className="space-y-2" data-testid="brand-logo-uploader">
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={ACCEPTED.join(',')}
        className="sr-only"
        disabled={readOnly || busy}
        onChange={onInputChange}
      />

      <div
        role="button"
        tabIndex={readOnly ? -1 : 0}
        aria-label="Upload brand logo"
        aria-disabled={readOnly || busy}
        onClick={openPicker}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openPicker();
          }
        }}
        onDragOver={(e) => {
          if (readOnly || busy) return;
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
          setDragOver(false);
        }}
        onDrop={onDrop}
        className={`relative flex h-32 w-full max-w-xs items-center justify-center overflow-hidden rounded-lg border border-dashed bg-bg-overlay text-text-muted transition-colors ${
          dragOver ? 'border-gold bg-gold-soft' : 'border-border-subtle'
        } ${readOnly ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:border-gold'}`}
      >
        {logoUrl !== null && logoUrl !== '' ? (
          <img src={logoUrl} alt="Brand logo" className="h-full w-full object-contain p-2" />
        ) : (
          <div className="flex flex-col items-center gap-1.5 text-center">
            <ImagePlus className="h-8 w-8 text-gold" aria-hidden />
            <div className="text-xs uppercase tracking-widest">Drag and drop or click to upload</div>
          </div>
        )}

        {busy && (
          <div className="absolute inset-0 flex items-center justify-center bg-bg-overlay/70">
            <Loader2 className="h-6 w-6 animate-spin text-gold" aria-label="Uploading" />
          </div>
        )}
      </div>

      {!readOnly && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={openPicker}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md border border-border-subtle px-3 py-1.5 text-xs font-semibold uppercase tracking-widest text-text-secondary transition-colors hover:border-gold hover:text-gold disabled:cursor-not-allowed disabled:opacity-50"
          >
            <UploadCloud className="h-4 w-4" aria-hidden />
            {logoUrl ? 'Replace' : 'Upload'}
          </button>
          {logoUrl !== null && logoUrl !== '' && (
            <button
              type="button"
              onClick={() => {
                setError(null);
                onChange?.(null);
              }}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-md border border-border-subtle px-3 py-1.5 text-xs font-semibold uppercase tracking-widest text-text-secondary transition-colors hover:border-red-fg hover:text-red-fg disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" aria-hidden />
              Remove
            </button>
          )}
        </div>
      )}

      {error !== null && <p className="text-xs text-red-fg">{error}</p>}
    </div>
  );
}
